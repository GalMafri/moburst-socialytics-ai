// The replay harness: starts a shadow competitive run for a past
// competitive_reports row from its saved snapshots only (replay.ts), and
// compares n8n's stored report with the in-app result, both as a screen
// shows them, with the groundwork's compareResults.
//
// Reached through run-scheduled-jobs (operational secret only):
//   {"mode":"replay_competitive","report_id":"<id>"}            starts a replay
//   {"mode":"replay_competitive","report_id":"<id>","reuse_analysis":true}
//                                                               figures only, no paid call
//   {"mode":"shadow_now","kind":"competitive","report_id":"<id>"}
//                                                               a live shadow of a past report:
//                                                               every provider called now
//   {"mode":"compare_pipeline","run_id":"<run id>"}             the comparison

import { clientFiguresFromStoredPosts } from "../../competitive/storedFigures.ts";
import { withCompetitiveEvidenceLimits } from "../../competitive/reportEvidence.ts";
import { normalizedCompetitiveMetrics } from "../../competitive/reportMetrics.ts";
import { buildCompetitivePayload } from "../../reports/payloads.ts";
import { compareResults, formatComparison, type CompareOptions, type Comparison } from "../compare.ts";
import { loadShadowPair, startPipelineRun } from "../store.ts";
import type { PipelineDefinition } from "../types.ts";
import { replayAttempt, sameInstant, type ReplayInput } from "./replay.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

/** The report as a screen shows it: the client's figures as stored posts give them now, the current metric rules, the evidence limits. */
export function shownCompetitiveReport(reportData: Any, postsSnapshot: Any): Any {
  if (!reportData || typeof reportData !== "object") return reportData;
  const counted = clientFiguresFromStoredPosts(reportData, postsSnapshot).report_data;
  return withCompetitiveEvidenceLimits(normalizedCompetitiveMetrics(counted));
}

/**
 * The figures a person reads off a competitive report, per company: the
 * period counts, the comparison figures (current and previous), the post
 * sample's counts per channel, the top posts and hashtags. A short form for
 * a test fixture or a quick look; compareCompetitive compares everything.
 */
export function competitiveFigures(shown: Any): Any {
  const pair = (m: Any) => (m ? { current: m.current ?? null, previous: m.previous ?? null } : null);
  const companies: Record<string, Any> = {};
  for (const c of shown?.aggregates?.companies ?? []) {
    const m = c.comparison_metrics ?? {};
    companies[String(c.company_id)] = {
      name: c.name,
      is_client: c.is_client,
      in_confirmed_top3: c.in_confirmed_top3,
      post_count: c.post_count,
      observed_post_count: c.observed_post_count,
      cadence_per_week: c.cadence_per_week,
      engagement_rate_avg: c.engagement_rate_avg ?? null,
      metrics: {
        audience: pair(m.audience), engagement: pair(m.engagement), posts: pair(m.posts),
        impressions: pair(m.impressions), engagement_rate: pair(m.engagement_rate),
      },
      by_channel: Object.fromEntries(Object.entries(c.by_channel ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, b]: [string, Any]) => [k, { post_count: b.post_count, observed_post_count: b.observed_post_count ?? null }])),
      top_posts: (c.top_posts ?? []).map((p: Any) => p.url ?? null),
      top_hashtags: c.top_hashtags ?? [],
    };
  }
  return { period: shown?.period ?? null, total_posts_analyzed: shown?.aggregates?.total_posts_analyzed ?? null, metrics_available: shown?.aggregates?.metrics_available ?? null, companies };
}

/** How two competitive reports are lined up: lists matched by what they list, the generation time left out. */
export const COMPETITIVE_COMPARE_OPTIONS: CompareOptions = {
  ignore: ["generated_at", "duration_minutes"],
  keyBy: {
    "landscape.companies": "id",
    "aggregates.companies": "company_id",
    "aggregates.example_post_pool": "url",
    "aggregates.companies.*.top_posts": "url",
    "aggregates.companies.*.by_channel.*.top_posts": "url",
    "aggregates.companies.*.top_hashtags": "key",
    "aggregates.companies.*.by_channel.*.top_hashtags": "key",
    "aggregates.companies.*.media_type_mix": "key",
    "aggregates.companies.*.by_channel.*.media_type_mix": "key",
    "aggregates.companies.*.channel_mix": "key",
    "aggregates.companies.*.rivaliq_metrics.daily": "date",
    "aggregates.companies.*.comparison_metrics.daily": "date",
    "aggregates.companies.*.owned_metrics.by_network.*.profiles": "id",
    "aggregates.companies.*.comparison_metrics.owned_profile_scope": "id",
    "ai_analysis.competitor_breakdowns": "name",
    "ai_analysis.winner_teardown": "competitor",
    "ai_analysis.benchmark_scorecard.dimensions": "dimension",
  },
};

/** n8n's stored report and the in-app result, both as a screen shows them. */
export function compareCompetitive(real: Any, shadow: Any, postsSnapshot: Any): Comparison {
  return compareResults(shownCompetitiveReport(real, postsSnapshot), shownCompetitiveReport(shadow, postsSnapshot), COMPETITIVE_COMPARE_OPTIONS);
}

/** A shadow competitive run next to the report it shadows, for a developer: the comparison and its plain text. */
export async function compareCompetitiveRun(db: Db, runId: string): Promise<{ run_id: string; real_id: string | null; comparison: Comparison; text: string } | null> {
  const pair = await loadShadowPair(db, runId);
  if (!pair) return null;
  if (pair.run.kind !== "competitive") throw new Error("Only a competitive run is compared here.");
  if (pair.shadow == null) throw new Error("The run has no shadow result yet.");
  const realId = pair.run.real_id;
  let postsSnapshot: Any = null;
  if (realId) {
    const replay = (pair.run.input as { replay?: ReplayInput })?.replay;
    const { data: report } = await db.from("competitive_reports").select("created_at").eq("id", realId).maybeSingle();
    const attempt = replay ? replay.attempt_started_at : report?.created_at ?? null;
    const { data } = await db.from("rivaliq_snapshots").select("endpoint, payload, fetched_at, attempt_started_at").eq("report_id", realId).eq("endpoint", "socialposts");
    const rows = (data ?? []).filter((r: Any) => sameInstant(r.attempt_started_at, attempt)).sort((a: Any, b: Any) => String(b.fetched_at ?? "").localeCompare(String(a.fetched_at ?? "")));
    postsSnapshot = rows[0]?.payload ?? null;
  }
  const comparison = compareCompetitive(pair.real, pair.shadow, postsSnapshot);
  return { run_id: runId, real_id: realId, comparison, text: formatComparison(comparison) };
}

/**
 * Starts a shadow competitive run for a past competitive_reports row, from
 * its saved snapshots only. A replay that asks Claude is a paid run, so it
 * starts only for a client whose competitive switch is on shadow (paid
 * shadow runs are switched on per client: Moburst, owner's decision of 20
 * Oct 2026); one with reuse_analysis makes no paid call and starts for any.
 */
/** A past report, its client and set, and the request n8n got for it, built again from the set as it is now. */
async function pastCompetitiveReport(db: Db, reportId: string, paid: { what: string; free: string } | null) {
  const { data: report, error } = await db.from("competitive_reports")
    .select("id, client_id, set_id, status, date_range_start, date_range_end, created_at, report_data").eq("id", reportId).maybeSingle();
  if (error) throw new Error(`The report could not be read: ${error.message}`);
  if (!report) throw new Error("No competitive report has that id.");
  if (!report.report_data?.aggregates) throw new Error("The report holds no finished analysis to compare with.");
  if (!report.date_range_start || !report.date_range_end) throw new Error("The report has no reporting period.");
  if (paid) {
    const { data: engines } = await db.from("report_engines").select("kind, client_id, engine").eq("kind", "competitive");
    const own = (engines ?? []).find((r: Any) => r.client_id === report.client_id);
    if (own?.engine !== "shadow" && own?.engine !== "app") {
      throw new Error(`${paid.what} runs only for a client whose competitive switch is on shadow${paid.free}.`);
    }
  }
  const { data: client } = await db.from("clients").select("*").eq("id", report.client_id).maybeSingle();
  if (!client) throw new Error("The report's client is gone.");
  const { data: set } = await db.from("competitor_sets").select("id, rivaliq_landscape_id").eq("id", report.set_id).maybeSingle();
  if (!set) throw new Error("The report's competitor set is gone.");
  const range = { start: String(report.date_range_start).slice(0, 10), end: String(report.date_range_end).slice(0, 10) };
  const request = await buildCompetitivePayload({ supabase: db, client, reportId: report.id, attemptStartedAt: report.created_at, set, range });
  return { report, set, range, request };
}

/**
 * Starts a live shadow competitive run for a past competitive_reports row:
 * the run n8n made, made again now with every provider called (RivalIQ,
 * Apify, Sprout, Claude), so the in-app pipeline is proven live without
 * waiting for a schedule. Like every shadow it writes only shadow tables.
 * It is paid, so it starts only for a client whose competitive switch is on
 * shadow or app. Figures that move with time (engagement still counting,
 * followers) can differ from what n8n read on its day.
 */
export async function startCompetitiveShadow(db: Db, pipeline: PipelineDefinition, reportId: string, opts: { now?: () => Date } = {}): Promise<{ run_id: string; started: boolean; attempt_started_at: string }> {
  if (pipeline.kind !== "competitive") throw new Error(`Pipeline ${pipeline.name} is not a competitive pipeline.`);
  const now = (opts.now ?? (() => new Date()))();
  const { report, set, range, request } = await pastCompetitiveReport(db, reportId, { what: "A live shadow", free: "" });
  const started = await startPipelineRun(db, {
    mode: "shadow",
    pipeline,
    clientId: report.client_id,
    realTable: "competitive_reports",
    realId: report.id,
    input: { range, set_id: set.id, request },
    dedupe: `live:competitive:${report.id}:${now.toISOString()}`,
  });
  return { ...started, attempt_started_at: report.created_at };
}

export async function startCompetitiveReplay(db: Db, pipeline: PipelineDefinition, reportId: string, opts: { reuseAnalysis?: boolean; now?: () => Date } = {}): Promise<{ run_id: string; started: boolean; attempt_started_at: string | null }> {
  if (pipeline.kind !== "competitive") throw new Error(`Pipeline ${pipeline.name} is not a competitive pipeline.`);
  const now = (opts.now ?? (() => new Date()))();
  const { report, set, range, request } = await pastCompetitiveReport(db, reportId,
    opts.reuseAnalysis ? null : { what: "A replay that asks Claude", free: "; replay with reuse_analysis to compare the figures at no cost" });
  const { data: rows, error: snapError } = await db.from("rivaliq_snapshots").select("endpoint, attempt_started_at").eq("report_id", reportId);
  if (snapError) throw new Error(`The saved RivalIQ answers could not be read: ${snapError.message}`);
  const attempt = replayAttempt(rows ?? [], report.created_at);
  const stored = report.report_data.landscape ?? {};
  const replay: ReplayInput = {
    report_id: report.id,
    attempt_started_at: attempt,
    landscape: { id: stored.id ?? null, name: stored.name ?? null, focus_company_id: stored.focus_company_id ?? null, matched_by: stored.matched_by ?? null },
    ...(opts.reuseAnalysis ? { reuse_analysis: true } : {}),
  };
  const started = await startPipelineRun(db, {
    mode: "shadow",
    pipeline,
    clientId: report.client_id,
    realTable: "competitive_reports",
    realId: report.id,
    input: { range, set_id: set.id, request, replay },
    dedupe: `replay:competitive:${report.id}:${now.toISOString()}`,
  });
  return { ...started, attempt_started_at: attempt };
}
