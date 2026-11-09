// The social report pipeline (kind social): the in-app port of n8n
// "Socialytics - AI Social Media Trend Analysis + Insights Agent"
// (SZbRTV7yOdXTNHHf, live version 5f8d3abc). The nodes are in
// social/nodes.ts; every step stays inside a queued step's time limit, and
// waiting is always a poll (the step is called back), never a sleep.
//
//   start        Stagger scheduled runs: waits stagger_seconds once (none in
//                a replay). Workflow Configuration, Prepare Brief Text.
//   brief        Analyze Client Brief Context, as a Claude message batch,
//                when there is a brief. An analysis that cannot be had after
//                two tries leaves the raw brief and a warning, as in n8n.
//   combine      Combine Brief Context with Client Data, Code in JavaScript
//                (the Sprout setup).
//   sprout       The four Sprout reads, one per call (Get Sprout Social
//                Analytics Data, Post Analytics, Previous Month Analytics and
//                Post Analytics), then Aggregate Sprout Social Data and Attach
//                Post Thumbnails; Skip Sprout Analytics for a brand with no
//                profile.
//   stored_trends  The period's industry trends: the themes and kept posts
//                the weekly trend collection stored for the weeks that start
//                in the report's period (social/storedTrends.ts), in place
//                of n8n's TikTok and Instagram scrapers (Trends plan, Task
//                16): no Apify call. None stored, or a stored request that
//                asked for no trends: none, and the report goes on.
//   normalize    Merge All Data Sources, Build Normalized Client Object,
//                Attach Competitive Context.
//   synthesis    AI Synthesis Agent, as a Claude message batch.
//   parse        Structured JSON Output Parser: parse and check the answer.
//   repair       the parser's autofix: its repair prompt, as a batch.
//   parse_repair the repaired answer, parsed and checked; else one fresh
//                analysis.
//   insights     The report's insights, worded with the report_insights
//                job's code and input from the report data the run will
//                write (social/runInsights.ts), checked before any call
//                (go-live, the report's attempt); stored for the real report
//                in app mode only. A failed first try is tried again with
//                the answer it kept; after that, the deck uses the analysis
//                and the report goes on.
//   deck         Build Presentation Content from the analysis as the report
//                shows it (its insights in place of the model-written
//                fields), Create Gamma Presentation, then Fetch Gamma Result
//                and Check Gamma State every 30 s.
//   summary      Generate Run Summary.
//   write        App: the real report, through the writer update-report uses
//                (writers.ts), fenced to the report's attempt and only while it
//                is running. Shadow: shadow_social_reports only.
//
// Every provider answer the run reads is kept as long as the run
// (social/replay.ts KEPT), so the run can be replayed from what it really read.

import { claudeBatchStep } from "../claude.ts";
import { ANTHROPIC_API_KEY, GAMMA_API_KEY, SPROUT_CLIENT_ID, SPROUT_CLIENT_SECRET } from "../secrets.ts";
import type { PipelineDefinition, StepContext, StepResult } from "../types.ts";
import { briefAnswer, briefRequest, parseAnswer, repairRequest, synthesisProblems, synthesisRequest } from "../social/analysis.ts";
import {
  aggregateSprout, attachCompetitiveContext, attachPostThumbnails, buildNormalizedClient, buildPresentationContent, checkGammaState, combineBrief,
  generateRunSummary, hasSproutProfiles, prepareBriefText, readsTrends, skipSproutAnalytics, sproutSetup, workflowConfiguration,
} from "../social/nodes.ts";
import { gammaClient, GAMMA_POLL_SECONDS, sproutReader, sproutRequests, SPROUT_READS, type GammaClient, type SproutReader } from "../social/providers.ts";
import { KEEP, KEPT, keptAnswer, replayOf } from "../social/replay.ts";
import { runInsights } from "../social/runInsights.ts";
import { readStoredTrends, type IndustryTrends } from "../social/storedTrends.ts";
import { FALLBACK_SPROUT_CUSTOMER_ID } from "../../sprout/customer.ts";
import { anthropicMessages } from "../../anthropic.ts";
import type { InsightsDeps, InsightsHistory, InsightsRow } from "../../reports/insights.ts";
import { shownSocial } from "../../reports/shownFields.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const SOCIAL_PIPELINE = "social_v1";
/** Tries of the brief analysis before the report goes on with the raw brief. */
export const BRIEF_TRIES = 2;
/** Fresh analyses asked for after a repaired answer still did not match its format. */
export const ANALYSIS_ROUNDS = 1;
/** Time the insights step keeps for itself after its model call must have ended, inside the step's own limit. */
export const INSIGHTS_MARGIN_MS = 15_000;
/** Tries of the insights step before the deck goes on with the analysis. */
export const INSIGHTS_TRIES = 2;
/** The client's earlier reports' changes, read once per run (runInsights.ts). */
const INSIGHTS_HISTORY = "insights.history";
/** The run's own insights answer, for a try after the one that paid for it. */
const INSIGHTS_ANSWER = "insights.answer";

export interface SocialDeps {
  sprout?: (ctx: StepContext) => SproutReader;
  gamma?: (ctx: StepContext) => GammaClient;
  /** For the Message Batches API calls. */
  claudeFetch?: Fetch;
  /** The insights' one Messages API call (left out: anthropic.ts, ended before the step's time is up). */
  insights?: (ctx: StepContext) => InsightsDeps["complete"];
}

/** What the stored_trends step keeps (KEPT.trends): the trends it read, null for none. */
interface KeptTrends { trends: IndustryTrends | null }

const requestOf = (ctx: StepContext): Any => ((ctx.run.input ?? {}) as { request?: Any }).request ?? {};

async function need<T = Any>(ctx: StepContext, key: string): Promise<T> {
  const value = await ctx.payloads.get<T>(key);
  if (value == null) throw new Error(`The run's ${key} is missing.`);
  return value;
}

/** The step's own reader of the account every client's profiles live under. */
const customerOf = (ctx: StepContext) => String(ctx.env("SPROUT_CUSTOMER_ID") || FALLBACK_SPROUT_CUSTOMER_ID);

/** Reuse of the earlier run's analyses: a replay that asked for it. */
const reusing = (ctx: StepContext) => !!replayOf(ctx)?.reuse_analysis;

export function socialPipeline(deps: SocialDeps = {}): PipelineDefinition {
  const sprout = (ctx: StepContext) => (deps.sprout ?? ((c) => sproutReader({ customerId: customerOf(c), signal: c.signal })))(ctx);
  const gamma = (ctx: StepContext) => (deps.gamma ?? ((c) => gammaClient({ apiKey: String(c.env(GAMMA_API_KEY) ?? ""), signal: c.signal })))(ctx);
  /** The insights call, as the job makes it (anthropic.ts), ended in time for the step to go on to the deck without them. */
  const insightsCall = (ctx: StepContext): InsightsDeps["complete"] => deps.insights?.(ctx) ?? (async (body) => {
    const stop = new AbortController();
    const end = () => stop.abort(new Error("The insights call ran out of time."));
    const timer = setTimeout(end, Math.max(1_000, ctx.deadline.getTime() - ctx.now().getTime() - INSIGHTS_MARGIN_MS));
    ctx.signal.addEventListener("abort", end, { once: true });
    try {
      return await anthropicMessages({ apiKey: String(ctx.env(ANTHROPIC_API_KEY) ?? ""), body, signal: stop.signal });
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", end);
    }
  });

  /**
   * Generate Run Summary: the report data the run writes. Without a deck, the
   * report data the insights are worked out from (the facts read no field of
   * the deck).
   */
  const runSummary = async (ctx: StepContext, deck: { gamma: Any; presentation: Any } | null) => {
    const [config, combined, prepared, normalized, aggregate, analysis, kept] = await Promise.all([
      need(ctx, "config"), need(ctx, "combined"), need(ctx, "prepared"), need(ctx, "normalized"), need(ctx, "sprout.aggregate"), need(ctx, KEPT.analysis),
      ctx.payloads.get<KeptTrends>(KEPT.trends),
    ]);
    return generateRunSummary({
      gamma: deck?.gamma ?? {}, presentation: deck?.presentation ?? {}, clientData: normalized, combined, config,
      sprout: aggregate.skipped ? null : aggregate, ai: analysis, prepared, industryTrends: kept?.trends ?? null,
      startedAt: new Date(ctx.run.started_at), now: ctx.now(),
    });
  };

  const briefBatch = claudeBatchStep({
    async build(ctx) {
      const prepared = await need(ctx, "prepared");
      return { apiKey: String(ctx.env(ANTHROPIC_API_KEY) ?? ""), body: briefRequest(prepared.brief_text) };
    },
    saveAs: KEPT.brief,
    keepDays: KEEP.keepDays,
    next: "combine",
    fetchImpl: deps.claudeFetch,
  });

  /** The accepted analysis, kept, then the insights and the deck. */
  const accept = async (ctx: StepContext, analysis: Any, detail: Record<string, unknown>): Promise<StepResult> => {
    await ctx.payloads.put(KEPT.analysis, analysis, KEEP);
    return { type: "next", step: "insights", detail };
  };

  return {
    name: SOCIAL_PIPELINE,
    kind: "social",
    modes: ["shadow", "app"],
    appCapable: true,
    secrets: [ANTHROPIC_API_KEY, SPROUT_CLIENT_ID, SPROUT_CLIENT_SECRET, GAMMA_API_KEY],
    first: "start",
    steps: {
      async start(ctx) {
        if (!replayOf(ctx)) {
          // The whole stagger, even past the longest single wait a poll may ask for.
          const stagger = Number(requestOf(ctx).stagger_seconds) || 0;
          const waited = ctx.poll ? Math.floor((ctx.now().getTime() - Date.parse(ctx.poll.since)) / 1000) : 0;
          if (stagger > 0 && waited < stagger) return { type: "poll", waitSeconds: stagger - waited, handle: { stagger_seconds: stagger }, detail: { stagger_seconds: stagger, waited_seconds: waited } };
        }
        const config = workflowConfiguration(requestOf(ctx), ctx.now());
        const prepared = prepareBriefText(config);
        await ctx.payloads.put("config", config);
        await ctx.payloads.put("prepared", prepared);
        return { type: "next", step: "brief", detail: { brief_source: prepared.brief_source, period: `${config.current_month_start}..${config.current_month_end}`, ...(replayOf(ctx) ? { replay_of: replayOf(ctx)!.from_run } : {}) } };
      },

      async brief(ctx) {
        const prepared = await need(ctx, "prepared");
        if (!prepared.brief_text) return { type: "next", step: "combine", detail: { brief: "none" } };
        if (reusing(ctx)) {
          const kept = await keptAnswer(ctx, KEPT.brief);
          if (kept) await ctx.payloads.put(KEPT.brief, kept, KEEP);
          return { type: "next", step: "combine", detail: { brief: kept ? "replayed" : "none kept" } };
        }
        try {
          return await briefBatch(ctx);
        } catch (e) {
          // As n8n's agent continues on its error: the raw brief, and a warning.
          if (ctx.attempt < BRIEF_TRIES) throw e;
          return { type: "next", step: "combine", detail: { brief: "not analyzed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } };
        }
      },

      async combine(ctx) {
        const [config, prepared] = await Promise.all([need(ctx, "config"), need(ctx, "prepared")]);
        const answer = prepared.brief_text ? await ctx.payloads.get<{ text?: string }>(KEPT.brief) : null;
        const briefIn = prepared.brief_text ? briefAnswer(answer?.text) : prepared;
        const combined = combineBrief(briefIn, config, prepared);
        const setup = sproutSetup(combined, config, customerOf(ctx));
        await ctx.payloads.put("combined", combined);
        await ctx.payloads.put("setup", setup);
        return { type: "next", step: "sprout", detail: { brief_analyzed: !briefIn.error && !!briefIn.output, profiles: setup.profile_ids.length, trends: readsTrends(combined) ? "stored" : "skipped" } };
      },

      async sprout(ctx) {
        const [combined, config, setup] = await Promise.all([need(ctx, "combined"), need(ctx, "config"), need(ctx, "setup")]);
        if (!hasSproutProfiles(setup)) {
          await ctx.payloads.put("sprout.item", skipSproutAnalytics(setup));
          await ctx.payloads.put("sprout.aggregate", { skipped: true });
          return { type: "next", step: "stored_trends", detail: { sprout: "no profiles" } };
        }
        const done = Number(ctx.state.sprout_reads ?? 0);
        if (done < SPROUT_READS.length) {
          const read = SPROUT_READS[done];
          const pages = replayOf(ctx)
            ? await keptAnswer<Any[]>(ctx, KEPT.sprout(read))
            : await sprout(ctx).pages(sproutRequests(setup, combined)[read].path, sproutRequests(setup, combined)[read].body);
          if (!Array.isArray(pages)) throw new Error(`The replayed run kept no Sprout ${read} read.`);
          await ctx.payloads.put(KEPT.sprout(read), pages, KEEP);
          return { type: "next", step: "sprout", state: { ...ctx.state, sprout_reads: done + 1 }, detail: { read, pages: pages.length, rows: pages.reduce((s, p) => s + (Array.isArray(p?.data) ? p.data.length : 0), 0) } };
        }
        const [current, posts, previous, previousPosts] = await Promise.all(SPROUT_READS.map((r) => need<Any[]>(ctx, KEPT.sprout(r))));
        const aggregate = aggregateSprout({ pages: { current, posts, previous, previous_posts: previousPosts }, combined, config, setup });
        const item = attachPostThumbnails(aggregate, [...posts, ...previousPosts]);
        await ctx.payloads.put("sprout.aggregate", aggregate);
        await ctx.payloads.put("sprout.item", item);
        return { type: "next", step: "stored_trends", state: { ...ctx.state, sprout_reads: 0 }, detail: { platforms: aggregate.platform_breakdown.length, top_posts: aggregate.top_posts.length } };
      },

      async stored_trends(ctx) {
        const [config, combined] = await Promise.all([need(ctx, "config"), need(ctx, "combined")]);
        let kept: KeptTrends;
        let detail: Record<string, unknown>;
        if (!readsTrends(combined)) {
          kept = { trends: null };
          detail = { trends: "skipped" };
        } else if (replayOf(ctx)) {
          // What the earlier run read, never the tables as they are now. A run from before stored trends read none.
          kept = (await keptAnswer<KeptTrends>(ctx, KEPT.trends)) ?? { trends: null };
          detail = { trends: "replayed" };
        } else {
          kept = { trends: await readStoredTrends(ctx.db, ctx.run.client_id, String(combined.date_ranges?.current_month?.start || config.current_month_start), String(combined.date_ranges?.current_month?.end || config.current_month_end)) };
          detail = { trends: kept.trends ? "stored" : "none" };
        }
        await ctx.payloads.put(KEPT.trends, kept, KEEP);
        return { type: "next", step: "normalize", detail: { ...detail, themes: kept.trends?.themes.length ?? 0, posts: kept.trends?.posts.length ?? 0 } };
      },

      async normalize(ctx) {
        const [config, combined, sproutItem, kept] = await Promise.all([need(ctx, "config"), need(ctx, "combined"), need(ctx, "sprout.item"), need<KeptTrends>(ctx, KEPT.trends)]);
        const normalized = attachCompetitiveContext(buildNormalizedClient([sproutItem], config, combined, ctx.now(), kept.trends), config);
        await ctx.payloads.put("normalized", normalized);
        if (reusing(ctx)) {
          const kept = await keptAnswer(ctx, KEPT.analysis);
          if (!kept) throw new Error("The replayed run kept no analysis.");
          return accept(ctx, kept, { replayed_analysis: true });
        }
        return { type: "next", step: "synthesis", detail: { industry_themes: normalized._meta.industry_themes, industry_posts: normalized._meta.industry_posts, competitive_context: !!normalized.competitive_context } };
      },

      synthesis: claudeBatchStep({
        async build(ctx) {
          return { apiKey: String(ctx.env(ANTHROPIC_API_KEY) ?? ""), body: synthesisRequest(await need(ctx, "normalized")) };
        },
        saveAs: "synthesis.answer",
        next: "parse",
        fetchImpl: deps.claudeFetch,
      }),

      async parse(ctx) {
        const answer = await need<{ text: string; stop_reason: string }>(ctx, "synthesis.answer");
        const parsed = parseAnswer(answer.text);
        const problems = "value" in parsed ? synthesisProblems(parsed.value) : [parsed.error];
        if (!problems.length && "value" in parsed) return accept(ctx, parsed.value, { stop_reason: answer.stop_reason });
        return { type: "next", step: "repair", state: { ...ctx.state, repair_error: problems.join("; ").slice(0, 4000) }, detail: { stop_reason: answer.stop_reason, problems: problems.slice(0, 10) } };
      },

      repair: claudeBatchStep({
        async build(ctx) {
          const answer = await need<{ text: string }>(ctx, "synthesis.answer");
          return { apiKey: String(ctx.env(ANTHROPIC_API_KEY) ?? ""), body: repairRequest(answer.text, String(ctx.state.repair_error ?? "")) };
        },
        saveAs: "synthesis.repaired",
        next: "parse_repair",
        fetchImpl: deps.claudeFetch,
      }),

      async parse_repair(ctx) {
        const answer = await need<{ text: string }>(ctx, "synthesis.repaired");
        const parsed = parseAnswer(answer.text);
        const problems = "value" in parsed ? synthesisProblems(parsed.value) : [parsed.error];
        if (!problems.length && "value" in parsed) return accept(ctx, parsed.value, { repaired: true });
        const rounds = Number(ctx.state.analysis_rounds ?? 0);
        if (rounds < ANALYSIS_ROUNDS) {
          return { type: "next", step: "synthesis", state: { ...ctx.state, analysis_rounds: rounds + 1, repair_error: null }, detail: { problems: problems.slice(0, 10), fresh_analysis: true } };
        }
        throw new Error(`The analysis did not match its format after a repair and a fresh analysis: ${problems.slice(0, 5).join("; ")}`);
      },

      async insights(ctx) {
        const go = async (row: InsightsRow | null, detail: Record<string, unknown>): Promise<StepResult> => {
          await ctx.payloads.put("insights", { row });
          return { type: "next", step: "deck", detail };
        };
        if (replayOf(ctx)) {
          // A replay asks no model: the earlier run's insights stand in.
          const kept = await keptAnswer<InsightsRow>(ctx, KEPT.insights);
          if (kept) await ctx.payloads.put(KEPT.insights, kept, KEEP);
          return go(kept, { insights: kept ? "replayed" : "none kept" });
        }
        const app = ctx.run.mode === "app";
        try {
          const got = await runInsights({
            db: ctx.db, reportId: ctx.run.real_id, reportData: await runSummary(ctx, null),
            ...(app ? { attemptStartedAt: ((ctx.run.input ?? {}) as { attempt_started_at?: string | null }).attempt_started_at ?? null } : {}),
            history: await ctx.payloads.get<InsightsHistory>(INSIGHTS_HISTORY),
            onHistory: async (history) => { await ctx.payloads.put(INSIGHTS_HISTORY, history); },
            answered: await ctx.payloads.get<InsightsRow>(INSIGHTS_ANSWER),
            complete: insightsCall(ctx), now: () => ctx.now(),
          });
          if (!got.row) return go(null, { insights: "none", reason: got.reason ?? null });
          // The answer, for a try after this one: it pays for nothing again.
          if (got.from === "model") await ctx.payloads.put(INSIGHTS_ANSWER, got.row);
          // The real report's row, in app mode only; a shadow stores nothing. A row met again is stored already.
          if (app && got.from !== "stored") await ctx.output.write("insights", got.row as unknown as Record<string, unknown>);
          // Kept with the run's provider answers once it is the report's (stored, or a shadow's own), so a replay never puts
          // insights on a deck the run never had.
          await ctx.payloads.put(KEPT.insights, got.row, KEEP);
          return go(got.row, { insights: got.from, source: got.row.source, facts: got.row.facts.length });
        } catch (e) {
          // The first try's error is the step's: tried again, with the answer already kept.
          if (ctx.attempt < INSIGHTS_TRIES) throw e;
          // As a report whose insights are not worded yet: the deck says what the analysis says, and the report goes on.
          return go(null, { insights: "not had", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
        }
      },

      async deck(ctx) {
        let presentation = await ctx.payloads.get<Any>("presentation");
        if (!presentation) {
          const [normalized, analysis, insights, kept] = await Promise.all([
            need(ctx, "normalized"), need(ctx, KEPT.analysis), ctx.payloads.get<{ row: InsightsRow | null }>("insights"), ctx.payloads.get<KeptTrends>(KEPT.trends),
          ]);
          // The analysis as the screens, the API and the planner show it: the insights' fields where the report has them.
          const shown = shownSocial(analysis, insights?.row ?? null).analysis ?? analysis;
          presentation = buildPresentationContent(normalized, shown, ctx.now(), kept?.trends ?? null);
          await ctx.payloads.put("presentation", presentation);
        }
        const finish = async (result: Any, detail: Record<string, unknown>): Promise<StepResult> => {
          await ctx.payloads.put(KEPT.gamma, result, KEEP);
          return { type: "next", step: "summary", detail };
        };
        if (replayOf(ctx)) {
          // A replay makes no deck: the earlier run's stands in.
          const kept = await keptAnswer(ctx, KEPT.gamma);
          return finish(kept ?? { error: { message: "The replayed run kept no deck." } }, { deck: "replayed" });
        }
        const created = await ctx.payloads.get<Any>("gamma.created");
        if (!created) {
          // A request whose answer was lost may already be making a deck: never a second one.
          if (await ctx.payloads.get("gamma.posting")) return finish({ error: { message: "The deck request was not answered." } }, { deck: "request unanswered" });
          await ctx.payloads.put("gamma.posting", { at: ctx.now().toISOString() });
          let answer: Any;
          try {
            answer = await gamma(ctx).create(presentation.presentation_content);
          } catch (e) {
            return finish({ error: { message: e instanceof Error ? e.message : String(e) } }, { deck: "refused" });
          }
          await ctx.payloads.put("gamma.created", answer ?? {});
          const id = answer?.id || answer?.generationId;
          if (!id) return finish({ ...(answer ?? {}), error: { message: "Gamma answered without a generation id." } }, { deck: "no generation id" });
          return { type: "poll", waitSeconds: GAMMA_POLL_SECONDS, handle: { gamma_generation: id }, state: { ...ctx.state, gamma_checks: 0 }, detail: { gamma_generation: id, prompt_chars: presentation.presentation_content.length } };
        }
        const id = created.id || created.generationId;
        const checks = Number(ctx.state.gamma_checks ?? 0) + 1;
        const state = checkGammaState(await gamma(ctx).read(String(id)), checks);
        if (state._gamma_poll_again) return { type: "poll", waitSeconds: GAMMA_POLL_SECONDS, handle: { gamma_generation: id }, state: { ...ctx.state, gamma_checks: checks }, detail: { status: state.status ?? null, checks } };
        return finish(state, { status: state.status ?? null, checks, timed_out: state._gamma_timeout, credits: state.credits ?? null });
      },

      async summary(ctx) {
        const [presentation, gammaResult] = await Promise.all([need(ctx, "presentation"), need(ctx, KEPT.gamma)]);
        const report = await runSummary(ctx, { gamma: gammaResult, presentation });
        await ctx.payloads.put("report", report);
        return { type: "next", step: "write", detail: { status: report.status, gamma_status: report.gamma_status, warnings: report.warnings.length } };
      },

      async write(ctx) {
        const report = await need(ctx, "report");
        if (ctx.run.mode === "app") {
          // A report is never written as failed: the run is tried again quietly instead.
          if (report.status !== "success") throw new Error("The analysis has none of the sections a report needs.");
          await ctx.output.write("report", { status: "completed", report_data: report, gamma_url: report.gamma_url || "", duration_minutes: report.duration_minutes || 0 });
          return { type: "done", detail: { wrote: "reports" } };
        }
        await ctx.output.write("report", report);
        return { type: "done", detail: { wrote: "shadow_social_reports", status: report.status } };
      },
    },
  };
}
