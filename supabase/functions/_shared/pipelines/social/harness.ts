// The social replay harness: starts a replay of an in-app social run (from
// the provider answers it kept, social/replay.ts) and compares a real report
// with its shadow, both as a screen shows them.
//
// Reached through run-scheduled-jobs (operational secret only):
//   {"mode":"replay_social","report_id":"<id>"}                 a replay of the newest finished in-app run of that report
//   {"mode":"replay_social","run_id":"<run id>"}                a replay of that run
//   ... "reuse_analysis":true                                   figures only, no paid call
//   {"mode":"compare_pipeline","run_id":"<run id>"}             the comparison

import { socialFigures } from "../../reports/reportText.ts";
import { compareResults, formatComparison, type CompareOptions, type Comparison } from "../compare.ts";
import { loadShadowPair, startPipelineRun } from "../store.ts";
import type { PipelineDefinition } from "../types.ts";
import { KEPT, type SocialReplay } from "./replay.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

/** How two social reports are lined up: lists matched by what they list, the run's own times left out. */
export const SOCIAL_COMPARE_OPTIONS: CompareOptions = {
  ignore: ["started_at", "completed_at", "duration_minutes", "report_date", "sprout_performance.collected_at"],
  keyBy: {
    "sprout_performance.profiles": "id",
    "sprout_performance.platform_breakdown": "network",
    "sprout_performance.top_posts": "url",
    "sprout_performance.top_posts_by_platform.*": "url",
    "tiktok_trends.posts": "url",
    "instagram_trends.posts": "url",
    "tiktok_trends.patterns.top_hashtags": "tag",
    "instagram_trends.patterns.top_hashtags": "tag",
    "ai_analysis.sprout_performance_analysis.platform_breakdown": "platform",
  },
};

export interface FigureDifference { key: string; label: string; real: number[]; shadow: number[] }
export interface FiguresComparison {
  /** Figures a screen shows, by key, in both reports. */
  compared: number;
  differences: FigureDifference[];
  onlyReal: string[];
  onlyShadow: string[];
}

/** Every figure a person reads off a social report (reportText.ts socialFigures, the screens' own definitions), real against shadow. */
export function compareSocialFigures(real: Any, shadow: Any): FiguresComparison {
  const byKey = (rd: Any) => {
    const m = new Map<string, { label: string; values: number[] }>();
    for (const f of socialFigures(rd)) {
      const e = m.get(f.key) ?? { label: f.label, values: [] };
      e.values.push(f.value);
      m.set(f.key, e);
    }
    return m;
  };
  const a = byKey(real);
  const b = byKey(shadow);
  const out: FiguresComparison = { compared: 0, differences: [], onlyReal: [], onlyShadow: [] };
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const r = a.get(key);
    const s = b.get(key);
    if (!s) { out.onlyReal.push(key); continue; }
    if (!r) { out.onlyShadow.push(key); continue; }
    out.compared += 1;
    if (JSON.stringify([...r.values].sort((x, y) => x - y)) !== JSON.stringify([...s.values].sort((x, y) => x - y))) {
      out.differences.push({ key, label: r.label, real: r.values, shadow: s.values });
    }
  }
  return out;
}

/** n8n's stored report and the in-app result: the figures a screen shows, then everything else side by side. */
export function compareSocial(real: Any, shadow: Any): { figures: FiguresComparison; comparison: Comparison } {
  return { figures: compareSocialFigures(real, shadow), comparison: compareResults(real, shadow, SOCIAL_COMPARE_OPTIONS) };
}

/** The comparison as plain lines. */
export function formatSocialComparison(c: { figures: FiguresComparison; comparison: Comparison }): string {
  const lines = [`Figures a screen shows: ${c.figures.compared} compared, ${c.figures.differences.length} different.`];
  for (const d of c.figures.differences) lines.push(`  ${d.label}: real ${d.real.join(", ")}, shadow ${d.shadow.join(", ")}`);
  if (c.figures.onlyReal.length) lines.push(`  Only in the real report: ${c.figures.onlyReal.join(", ")}`);
  if (c.figures.onlyShadow.length) lines.push(`  Only in the shadow: ${c.figures.onlyShadow.join(", ")}`);
  lines.push(formatComparison(c.comparison));
  return lines.join("\n");
}

/** A shadow social run next to the report it shadows, for a developer. */
export async function compareSocialRun(db: Db, runId: string): Promise<{ run_id: string; real_id: string | null; figures: FiguresComparison; comparison: Comparison; text: string } | null> {
  const pair = await loadShadowPair(db, runId);
  if (!pair) return null;
  if (pair.run.kind !== "social") throw new Error("Only a social run is compared here.");
  if (pair.shadow == null) throw new Error("The run has no shadow result yet.");
  if (pair.real == null) throw new Error("The report it shadows is gone.");
  const c = compareSocial(pair.real, pair.shadow);
  return { run_id: runId, real_id: pair.run.real_id, ...c, text: formatSocialComparison(c) };
}

/**
 * Starts a replay: a shadow run made again from what an earlier in-app social
 * run of the report read. A replay that asks Claude is a paid run, so it
 * starts only for a client whose social switch is on shadow or app; one with
 * reuse_analysis makes no paid call and starts for any.
 */
export async function startSocialReplay(db: Db, pipeline: PipelineDefinition, o: { reportId?: string; runId?: string; reuseAnalysis?: boolean; now?: () => Date }): Promise<{ run_id: string; started: boolean; from_run: string; report_id: string }> {
  if (pipeline.kind !== "social") throw new Error(`Pipeline ${pipeline.name} is not a social pipeline.`);
  if (!o.reportId && !o.runId) throw new Error("A replay names a report or a run.");
  const now = (o.now ?? (() => new Date()))();
  let q = db.from("report_pipeline_runs").select("id, kind, pipeline, client_id, real_id, input, status, started_at").eq("kind", "social").eq("pipeline", pipeline.name).eq("status", "done");
  q = o.runId ? q.eq("id", o.runId) : q.eq("real_id", o.reportId);
  const { data: runs, error } = await q.order("started_at", { ascending: false }).limit(5);
  if (error) throw new Error(`The runs could not be read: ${error.message}`);
  const candidates = ((runs ?? []) as Any[]).filter((r) => !(r.input && r.input.replay));
  let source: Any = null;
  for (const r of candidates) {
    const { data: kept } = await db.from("pipeline_payloads").select("key").eq("run_id", r.id).eq("key", KEPT.analysis).maybeSingle();
    if (kept) { source = r; break; }
  }
  if (!source) throw new Error("No finished in-app social run of this report kept its answers, so it cannot be replayed.");
  const reportId = String(o.reportId ?? source.real_id ?? "");
  const { data: report } = await db.from("reports").select("id, client_id, report_data").eq("id", reportId).maybeSingle();
  if (!report?.report_data) throw new Error("The report holds no finished analysis to compare with.");
  if (!o.reuseAnalysis) {
    const { data: engines } = await db.from("report_engines").select("kind, client_id, engine").eq("kind", "social");
    const own = (engines ?? []).find((r: Any) => r.client_id === source.client_id);
    if (own?.engine !== "shadow" && own?.engine !== "app") {
      throw new Error("A replay that asks Claude runs only for a client whose social switch is on shadow; replay with reuse_analysis to compare the figures at no cost.");
    }
  }
  const replay: SocialReplay = { from_run: source.id, report_id: reportId, ...(o.reuseAnalysis ? { reuse_analysis: true } : {}) };
  const started = await startPipelineRun(db, {
    mode: "shadow",
    pipeline,
    clientId: source.client_id,
    realTable: "reports",
    realId: reportId,
    input: { range: source.input?.range ?? null, request: source.input?.request ?? {}, replay },
    dedupe: `replay:social:${source.id}:${now.toISOString()}`,
  });
  return { ...started, from_run: source.id, report_id: reportId };
}
