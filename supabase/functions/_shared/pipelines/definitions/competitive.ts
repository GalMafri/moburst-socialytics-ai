// The competitive analysis pipeline (kind competitive): the in-app port of
// n8n "Socialytics - Competitive Analysis (RivalIQ) - v1" (EBiAwSay3H2R8krv,
// live version 079ef9fd). Every step stays inside a queued step's time
// limit; waiting is always a poll (the step is called back), never a sleep.
//
//   start          Stagger scheduled runs: waits stagger_seconds once.
//                  A replay goes to replay_sources instead.
//   landscape      List RivalIQ Landscapes, Resolve Landscape.
//   readiness      Landscape Status, Check RivalIQ Readiness: looks once a
//                  minute while RivalIQ is still collecting, 30 times.
//                  Cache Status Snapshot.
//   companies      Landscape Companies, Cache Companies Snapshot.
//   metrics        Landscape Metrics Summary, Summary Previous, Timeseries,
//                  Audience Snapshot: one read per call. The first three
//                  continue without an answer after their last try, as the
//                  n8n nodes continue on an error; the audience read does
//                  not. Cache Metrics Snapshot.
//   posts          Build Post Windows, Landscape Social Posts: one window
//                  per call, 125 s apart (the n8n node's batch interval),
//                  then Merge Post Pages.
//   linkedin       Prepare LinkedIn Sources, Collect LinkedIn Posts (the
//                  Apify actor, through apifyStep.ts), Merge LinkedIn Posts.
//   owned          Collect Owned Client Data (the competitive-owned-source
//                  logic, collectOwnedCompetitive, in-process), Merge Owned
//                  Posts, Cache Posts Snapshot.
//   aggregate      Aggregate Competitive Data (aggregate.ts).
//   analysis       Competitive Analysis Agent, as a Claude message batch.
//   parse          Competitive Output Parser: parse and check the answer.
//   repair         the parser's autoFix: the repair prompt, as a batch.
//   parse_repair   the repaired answer, parsed and checked.
//   assemble       Assemble Report Data.
//   write          Mark Report Complete. App: the real report, through the
//                  writer update-competitive-report uses, only while the
//                  report is running. Shadow: shadow_competitive_reports
//                  only, as that writer would store it.
//
// Snapshots: in app mode written to rivaliq_snapshots for the report's
// attempt, exactly as n8n writes them; in shadow mode kept with the run.
// A shadow never writes competitive_reports, rivaliq_snapshots or any
// calendar table.
//
// Replay (input.replay): replay_sources builds what the live steps up to
// Merge Owned Posts would have from the report's saved snapshots
// (competitive/replay.ts), then aggregate onward run as above; with
// reuse_analysis the real report's analysis stands in for Claude's.

import { runActorStep, type ApifyFactory } from "../apifyStep.ts";
import { claudeBatchStep } from "../claude.ts";
import { MAX_STEP_ATTEMPTS } from "../runner.ts";
import { ANTHROPIC_API_KEY, APIFY_API_TOKEN, RIVALIQ_API_KEY } from "../secrets.ts";
import type { PipelineDefinition, StepContext, StepResult } from "../types.ts";
import { LINKEDIN_ACTOR, mergeLinkedInPosts, prepareCompetitiveLinkedInSources, verifyLinkedInRows } from "../linkedin/sources.ts";
import { aggregateCompetitive } from "../competitive/aggregate.ts";
import { analysisProblems, analysisRequest, parseAnswer, repairRequest } from "../competitive/analysis.ts";
import { assembleReportData, audienceDayOf, buildPostWindows, checkReadiness, mergeOwnedPosts, mergePostPages, previousPeriodOf, resolveLandscape, runConfig, type RunConfig } from "../competitive/nodes.ts";
import { loadReplaySnapshots, replaySources, type ReplayInput } from "../competitive/replay.ts";
import { RivalIqBusy, rivalIqReader, type RivalIqRead } from "../competitive/rivaliq.ts";
import { collectOwnedCompetitive } from "../../competitive/ownedSource.ts";
import { clientFiguresFromStoredPosts } from "../../competitive/storedFigures.ts";
import { completedCompetitiveReport } from "../../competitive/reportWriter.ts";
import { withCompetitiveEvidenceLimits } from "../../competitive/reportEvidence.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const COMPETITIVE_PIPELINE = "competitive_v1";
/** The wait between two weekly post windows (Landscape Social Posts' batch interval, 125 000 ms). */
export const POST_WINDOW_SPACING_SECONDS = 125;
/** The wait before RivalIQ's readiness is looked at again (Wait for RivalIQ Data). */
export const READINESS_POLL_SECONDS = 60;
/** Fresh analyses asked for after a repaired answer still did not match its format. */
export const ANALYSIS_ROUNDS = 1;

export interface CompetitiveDeps {
  rivaliq?: (apiKey: string) => RivalIqRead;
  apify?: ApifyFactory;
  /** collectOwnedCompetitive (the competitive-owned-source logic). */
  owned?: (db: Any, client: Any, period: { start: string; end: string }) => Promise<Any>;
  /** For the Message Batches API calls. */
  claudeFetch?: Fetch;
}

const input = (ctx: StepContext) => (ctx.run.input ?? {}) as { request?: Any; replay?: ReplayInput; range?: { start: string; end: string } };
const requestOf = (ctx: StepContext): Any => input(ctx).request ?? {};
const cfgOf = (ctx: StepContext): RunConfig => runConfig(requestOf(ctx), new Date(ctx.run.started_at));

async function need<T = Any>(ctx: StepContext, key: string): Promise<T> {
  const value = await ctx.payloads.get<T>(key);
  if (value == null) throw new Error(`The run's ${key} is missing.`);
  return value;
}

/** A RivalIQ read, or the poll that waits while the connection is busy or the hourly budget is spent. */
async function rivaliqRead(ctx: StepContext, deps: CompetitiveDeps, path: string, query: Record<string, string>): Promise<{ answer: Any } | { wait: StepResult }> {
  const read = (deps.rivaliq ?? rivalIqReader)(String(ctx.env(RIVALIQ_API_KEY) ?? ""));
  try {
    return { answer: await read(path, query, ctx.signal) };
  } catch (e) {
    if (e instanceof RivalIqBusy) {
      return { wait: { type: "poll", waitSeconds: Math.max(15, Math.min(1800, e.retryAfterSeconds)), handle: { rivaliq_busy: path }, detail: { waiting_for: "RivalIQ", path, note: e.message.slice(0, 300) } } };
    }
    throw e;
  }
}

/** A snapshot n8n caches through update-competitive-report: real in app mode, kept with the run in shadow. */
const snapshot = (ctx: StepContext, endpoint: string, landscapeId: Any, payload: Any) =>
  ctx.output.write(`snapshot.${endpoint}`, { landscape_id: landscapeId, payload });

const METRIC_PARTS = ["summary", "previous", "timeseries", "audience"] as const;

export function competitivePipeline(deps: CompetitiveDeps = {}): PipelineDefinition {
  return {
    name: COMPETITIVE_PIPELINE,
    kind: "competitive",
    modes: ["shadow", "app"],
    appCapable: true,
    secrets: [RIVALIQ_API_KEY, ANTHROPIC_API_KEY],
    awaitedSecrets: [APIFY_API_TOKEN],
    first: "start",
    steps: {
      async start(ctx) {
        if (input(ctx).replay) return { type: "next", step: "replay_sources", detail: { replay: input(ctx).replay!.report_id } };
        const stagger = Number(requestOf(ctx).stagger_seconds) || 0;
        if (stagger > 0 && !ctx.poll) return { type: "poll", waitSeconds: stagger, handle: { stagger_seconds: stagger }, detail: { stagger_seconds: stagger } };
        return { type: "next", step: "landscape" };
      },

      async landscape(ctx) {
        const r = await rivaliqRead(ctx, deps, "/v3/landscapes", {});
        if ("wait" in r) return r.wait;
        const landscape = resolveLandscape(cfgOf(ctx), requestOf(ctx), r.answer);
        await ctx.payloads.put("landscape", landscape);
        return { type: "next", step: "readiness", state: { ...ctx.state, landscape_id: landscape.landscape_id }, detail: { landscape_id: landscape.landscape_id, matched_by: landscape.matched_by } };
      },

      async readiness(ctx) {
        const landscapeId = ctx.state.landscape_id;
        const checks = Number(ctx.state.readiness_checks ?? 0);
        const r = await rivaliqRead(ctx, deps, `/v3/landscapes/${landscapeId}/status`, {});
        if ("wait" in r) return r.wait;
        const status = checkReadiness(r.answer?.status, checks);
        if (!status.ready) {
          return { type: "poll", waitSeconds: READINESS_POLL_SECONDS, handle: { readiness: landscapeId }, state: { ...ctx.state, readiness_checks: checks + 1 }, detail: { status: status.status, checks: status.checks } };
        }
        await snapshot(ctx, "status", landscapeId, status);
        return { type: "next", step: "companies", detail: { checks: status.checks } };
      },

      async companies(ctx) {
        const landscapeId = ctx.state.landscape_id;
        const r = await rivaliqRead(ctx, deps, `/v3/landscapes/${landscapeId}/companies`, {});
        if ("wait" in r) return r.wait;
        await ctx.payloads.put("rivaliq.companies", r.answer);
        await snapshot(ctx, "companies", landscapeId, r.answer);
        return { type: "next", step: "metrics", detail: { companies: Array.isArray(r.answer?.companies) ? r.answer.companies.length : null } };
      },

      async metrics(ctx) {
        const landscapeId = ctx.state.landscape_id;
        const cfg = cfgOf(ctx);
        const done = Number(ctx.state.metrics_done ?? 0);
        if (done >= METRIC_PARTS.length) {
          const [summary, summary_previous, timeseries, audience_snapshot] = await Promise.all(METRIC_PARTS.map((p) => need(ctx, `rivaliq.metrics.${p}`)));
          await snapshot(ctx, "metrics", landscapeId, { summary, summary_previous, timeseries, audience_snapshot });
          return { type: "next", step: "posts" };
        }
        const part = METRIC_PARTS[done];
        const previous = previousPeriodOf(cfg);
        const audienceDay = audienceDayOf(cfg);
        const ask: Record<(typeof METRIC_PARTS)[number], [string, Record<string, string>]> = {
          summary: [`/v3/landscapes/${landscapeId}/metrics/summary`, { mainPeriodStart: cfg.range_start, mainPeriodEnd: cfg.range_end }],
          previous: [`/v3/landscapes/${landscapeId}/metrics/summary`, { mainPeriodStart: previous.start, mainPeriodEnd: previous.end }],
          timeseries: [`/v3/landscapes/${landscapeId}/metrics/timeseries`, { mainPeriodStart: cfg.range_start, mainPeriodEnd: cfg.range_end }],
          audience: [`/v3/landscapes/${landscapeId}/metrics/summary`, { mainPeriodStart: audienceDay, mainPeriodEnd: audienceDay }],
        };
        let answer: Any;
        try {
          const r = await rivaliqRead(ctx, deps, ...ask[part]);
          if ("wait" in r) return r.wait;
          answer = r.answer;
        } catch (e) {
          // The three period reads continue without an answer on their last try, as their n8n nodes do (continueRegularOutput).
          if (part === "audience" || ctx.attempt < MAX_STEP_ATTEMPTS) throw e;
          answer = { error: { message: e instanceof Error ? e.message : String(e) } };
        }
        await ctx.payloads.put(`rivaliq.metrics.${part}`, answer);
        return { type: "next", step: "metrics", state: { ...ctx.state, metrics_done: done + 1 }, detail: { read: part, ...(answer?.error ? { error: true } : {}) } };
      },

      async posts(ctx) {
        const landscapeId = ctx.state.landscape_id;
        const windows = buildPostWindows(cfgOf(ctx), landscapeId);
        const next = Number(ctx.state.posts_next ?? 0);
        if (next < windows.length) {
          const w = windows[next];
          const r = await rivaliqRead(ctx, deps, `/v3/landscapes/${landscapeId}/socialposts`, { mainPeriodStart: w.mainPeriodStart, mainPeriodEnd: w.mainPeriodEnd, limit: "500" });
          if ("wait" in r) return r.wait;
          await ctx.payloads.put(`rivaliq.posts.${next}`, r.answer);
          const count = Array.isArray(r.answer?.socialPosts) ? r.answer.socialPosts.length : null;
          if (next + 1 < windows.length) {
            return { type: "poll", waitSeconds: POST_WINDOW_SPACING_SECONDS, handle: { posts_windows: windows.length }, state: { ...ctx.state, posts_next: next + 1 }, detail: { window: next + 1, of: windows.length, posts: count } };
          }
        }
        const pages = [];
        for (let i = 0; i < windows.length; i++) pages.push(await need(ctx, `rivaliq.posts.${i}`));
        const merged = mergePostPages(pages, windows.length);
        await ctx.payloads.put("rivaliq.socialposts", merged);
        return { type: "next", step: "linkedin", state: { ...ctx.state, posts_next: windows.length }, detail: { windows: windows.length, posts: merged.socialPosts.length, truncated_pages: merged.truncated_pages } };
      },

      async linkedin(ctx) {
        const cfg = cfgOf(ctx);
        const landscape = await need(ctx, "landscape");
        const rival = await need(ctx, "rivaliq.socialposts");
        const plan = prepareCompetitiveLinkedInSources(cfg, requestOf(ctx), landscape);
        const today = ctx.now().toISOString().slice(0, 10);
        let rows: unknown[] = [];
        let runId: string | null = null;
        if (plan.has_sources) {
          const actor = await runActorStep(ctx, { actor: LINKEDIN_ACTOR, input: plan.input, datasetKey: "apify.dataset", apify: deps.apify });
          if (actor.type === "wait") return actor.result;
          rows = actor.rows;
          runId = actor.runId;
        }
        const verified = verifyLinkedInRows(rows, plan, { previous: plan.previous_period, audience: true, today });
        const merged = mergeLinkedInPosts(rival, plan, verified);
        await ctx.payloads.put("linkedin.merged", merged);
        return { type: "next", step: "owned", detail: { sources: plan.sources.length, posts: merged.linkedin_posts, ...(runId ? { apify_run_id: runId, items: rows.length } : {}) } };
      },

      async owned(ctx) {
        const cfg = cfgOf(ctx);
        const landscape = await need(ctx, "landscape");
        const linkedin = await need(ctx, "linkedin.merged");
        const { data: client, error } = await ctx.db.from("clients").select("id,name,sprout_customer_id").eq("id", cfg.client_id).maybeSingle();
        if (error) throw new Error(`The client could not be read: ${error.message}`);
        if (!client) throw new Error("Client not found");
        const owned = await (deps.owned ?? collectOwnedCompetitive)(ctx.db, client, { start: cfg.range_start, end: cfg.range_end });
        // What competitive-owned-source answers n8n: the client id, then the collection.
        const collected = { client_id: cfg.client_id, ...owned };
        await ctx.payloads.put("owned.collected", collected);
        const merged = mergeOwnedPosts(cfg, landscape, collected, linkedin);
        await ctx.payloads.put("posts.merged", merged);
        await snapshot(ctx, "socialposts", landscape.landscape_id, merged);
        return { type: "next", step: "aggregate", detail: { coverage: collected.coverage, owned_posts: Array.isArray(owned?.posts) ? owned.posts.length : 0, posts: merged.socialPosts.length } };
      },

      async replay_sources(ctx) {
        const replay = input(ctx).replay!;
        const cfg = cfgOf(ctx);
        const snaps = await loadReplaySnapshots(ctx.db, replay);
        const s = replaySources(cfg, requestOf(ctx), snaps, replay);
        await ctx.payloads.put("landscape", s.landscape);
        await ctx.payloads.put("rivaliq.companies", s.companies);
        await ctx.payloads.put("rivaliq.metrics.summary", s.metrics.summary ?? {});
        await ctx.payloads.put("rivaliq.metrics.previous", s.metrics.previous ?? {});
        await ctx.payloads.put("rivaliq.metrics.timeseries", s.metrics.timeseries ?? {});
        await ctx.payloads.put("rivaliq.metrics.audience", s.metrics.audience ?? {});
        await ctx.payloads.put("rivaliq.socialposts", s.rival);
        await ctx.payloads.put("linkedin.merged", s.linkedin);
        await ctx.payloads.put("owned.collected", s.collected);
        await ctx.payloads.put("posts.merged", s.merged);
        // The saved posts, for the client's figures as the app counts them now (storedFigures.ts).
        await ctx.payloads.put("replay.socialposts", snaps.socialposts);
        if (replay.reuse_analysis) {
          const { data: report, error } = await ctx.db.from("competitive_reports").select("report_data").eq("id", replay.report_id).maybeSingle();
          if (error || !report?.report_data?.ai_analysis) throw new Error("The real report's analysis could not be read.");
          await ctx.payloads.put("analysis.parsed", report.report_data.ai_analysis);
        }
        return { type: "next", step: "aggregate", state: { ...ctx.state, landscape_id: s.landscape.landscape_id }, detail: { attempt: replay.attempt_started_at, posts: s.merged.socialPosts.length, linkedin_posts: s.linkedin.linkedin_posts, owned: s.collected.coverage } };
      },

      async aggregate(ctx) {
        const [landscape, companiesResp, postsResp, metricsResp, metricsPrevResp, seriesResp, audienceResp] = await Promise.all([
          need(ctx, "landscape"), need(ctx, "rivaliq.companies"), need(ctx, "posts.merged"),
          need(ctx, "rivaliq.metrics.summary"), need(ctx, "rivaliq.metrics.previous"), need(ctx, "rivaliq.metrics.timeseries"), need(ctx, "rivaliq.metrics.audience"),
        ]);
        let aggregates = aggregateCompetitive({ cfg: cfgOf(ctx), landscape, companiesResp, postsResp, metricsResp, metricsPrevResp, seriesResp, audienceResp, body: requestOf(ctx) });
        const replay = input(ctx).replay;
        if (replay) {
          // Saved Sprout figures counted under earlier rules are counted again from the saved posts, as the app does for stored reports.
          const counted = clientFiguresFromStoredPosts({ period: aggregates.period, aggregates }, await need(ctx, "replay.socialposts"));
          aggregates = counted.report_data.aggregates;
        }
        await ctx.payloads.put("aggregates", aggregates);
        const next = replay?.reuse_analysis ? "assemble" : "analysis";
        return { type: "next", step: next, detail: { companies: aggregates.companies?.length ?? 0, posts: aggregates.total_posts_analyzed, metrics_available: aggregates.metrics_available } };
      },

      analysis: claudeBatchStep({
        async build(ctx) {
          return { apiKey: String(ctx.env(ANTHROPIC_API_KEY) ?? ""), body: analysisRequest(await need(ctx, "aggregates"), requestOf(ctx).team_preferences) };
        },
        saveAs: "analysis.answer",
        next: "parse",
        fetchImpl: deps.claudeFetch,
      }),

      async parse(ctx) {
        const answer = await need<{ text: string; stop_reason: string }>(ctx, "analysis.answer");
        const parsed = parseAnswer(answer.text);
        const problems = "value" in parsed ? analysisProblems(parsed.value) : [parsed.error];
        if (!problems.length && "value" in parsed) {
          await ctx.payloads.put("analysis.parsed", parsed.value);
          return { type: "next", step: "assemble", detail: { stop_reason: answer.stop_reason } };
        }
        return { type: "next", step: "repair", state: { ...ctx.state, repair_error: problems.join("; ").slice(0, 4000) }, detail: { stop_reason: answer.stop_reason, problems: problems.slice(0, 10) } };
      },

      repair: claudeBatchStep({
        async build(ctx) {
          const answer = await need<{ text: string }>(ctx, "analysis.answer");
          return { apiKey: String(ctx.env(ANTHROPIC_API_KEY) ?? ""), body: repairRequest(answer.text, String(ctx.state.repair_error ?? "")) };
        },
        saveAs: "analysis.repaired",
        next: "parse_repair",
        fetchImpl: deps.claudeFetch,
      }),

      async parse_repair(ctx) {
        const answer = await need<{ text: string; stop_reason: string }>(ctx, "analysis.repaired");
        const parsed = parseAnswer(answer.text);
        const problems = "value" in parsed ? analysisProblems(parsed.value) : [parsed.error];
        if (!problems.length && "value" in parsed) {
          await ctx.payloads.put("analysis.parsed", parsed.value);
          return { type: "next", step: "assemble", detail: { repaired: true } };
        }
        const rounds = Number(ctx.state.analysis_rounds ?? 0);
        if (rounds < ANALYSIS_ROUNDS) {
          // A fresh analysis, once: its batch is submitted anew.
          return { type: "next", step: "analysis", state: { ...ctx.state, analysis_rounds: rounds + 1, repair_error: null }, detail: { problems: problems.slice(0, 10), fresh_analysis: true } };
        }
        throw new Error(`The analysis did not match its format after a repair and a fresh analysis: ${problems.slice(0, 5).join("; ")}`);
      },

      async assemble(ctx) {
        const cfg = cfgOf(ctx);
        const [landscape, aggregates, analysis, rival] = await Promise.all([need(ctx, "landscape"), need(ctx, "aggregates"), need(ctx, "analysis.parsed"), need(ctx, "rivaliq.socialposts")]);
        const assembled = assembleReportData({ landscape, aggregates, pages: Number(rival.pages) || 0, analysis, startedAt: cfg.started_at, now: ctx.now() });
        await ctx.payloads.put("report", assembled);
        return { type: "next", step: "write", detail: { duration_minutes: assembled.duration_minutes } };
      },

      async write(ctx) {
        const assembled = await need<{ report_data: Any; duration_minutes: number }>(ctx, "report");
        if (ctx.run.mode === "app") {
          // Mark Report Complete: the writer update-competitive-report uses (writers.ts).
          await ctx.output.write("report", { status: "complete", report_data: assembled.report_data, duration_minutes: assembled.duration_minutes });
          return { type: "done", detail: { wrote: "competitive_reports" } };
        }
        // As the writer would store it: the evidence limits, the coverage notes, the quality check.
        const posts = await need(ctx, "posts.merged");
        const stored = completedCompetitiveReport(withCompetitiveEvidenceLimits(assembled.report_data), posts);
        await ctx.output.write("report", stored.report_data);
        return { type: "done", detail: { wrote: "shadow_competitive_reports", would_be: stored.status } };
      },
    },
  };
}
