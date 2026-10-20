// @vitest-environment node
// The replay harness on a real stored report: Moburst's September 2026
// competitive report (6d9f301c, made by n8n on 7 Oct), its saved RivalIQ
// snapshots and its request inputs, trimmed (fixtures/competitive-replay-
// moburst-2026-09.json says how). The in-app pipeline runs on the saved
// answers only, through the real step runner and stores, and its result is
// read the way a screen reads a report: the figures must be the ones the
// stored n8n report shows. Nothing leaves the test.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareResults } from "../compare";
import { competitivePipeline } from "../definitions/competitive";
import { makeRegistry } from "../registry";
import { drivePipeline, pipelineDb, testClock } from "../testDriver";
import { ANALYSIS_MODEL } from "./analysis";
import { ANALYSIS_SYSTEM_PROMPT } from "./prompt";
import { compareCompetitive, compareCompetitiveRun, competitiveFigures, shownCompetitiveReport, startCompetitiveReplay, startCompetitiveShadow } from "./harness";
import { pickReplaySnapshots, replayAttempt } from "./replay";

const here = dirname(fileURLToPath(import.meta.url));
// deno-lint-ignore no-explicit-any
const FX: any = JSON.parse(readFileSync(join(here, "..", "fixtures", "competitive-replay-moburst-2026-09.json"), "utf8"));
const MOBURST = FX.report.client_id;
const REPORT = FX.report.id;
// deno-lint-ignore no-explicit-any
const postsSnapshot = () => FX.snapshots.find((s: any) => s.endpoint === "socialposts").payload;

/** The stored rows the replay reads, and the ones it must never write. */
function tables(extra: Record<string, unknown[]> = {}) {
  return {
    competitive_reports: [{ ...FX.report, report_data: { landscape: FX.real_landscape, ai_analysis: FX.real_analysis, aggregates: { companies: [] }, period: { start: FX.report.date_range_start, end: FX.report.date_range_end } } }],
    // deno-lint-ignore no-explicit-any
    rivaliq_snapshots: FX.snapshots.map((s: any, i: number) => ({ id: `snap-${i}`, report_id: REPORT, client_id: MOBURST, ...s })),
    clients: [FX.client],
    competitor_sets: [FX.set],
    competitors: FX.competitors,
    sprout_profiles: FX.sprout_profiles,
    competitive_insight_feedback: [],
    competitive_learnings: [],
    report_engines: [{ kind: "competitive", client_id: null, engine: "n8n" }],
    ...extra,
  } as Record<string, Array<Record<string, unknown>>>;
}

/** Message Batches API stand-in: every batch ends at once with the given answer text. */
function claudeBatches(answers: string[]) {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/messages/batches") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body.requests[0]);
      return new Response(JSON.stringify({ id: `batch-${requests.length}` }));
    }
    const results = url.match(/\/results\/(batch-\d+)$/);
    if (results) {
      const n = Number(results[1].split("-")[1]);
      const req = requests[n - 1];
      const line = { custom_id: req.custom_id, result: { type: "succeeded", message: { content: [{ type: "text", text: answers[Math.min(n, answers.length) - 1] }], stop_reason: "end_turn" } } };
      return new Response(JSON.stringify(line) + "\n");
    }
    const batch = url.match(/\/batches\/(batch-\d+)$/);
    if (batch) return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/results/${batch[1]}` }));
    throw new Error(`unexpected ${url}`);
  };
  return { requests, fetchImpl };
}

async function replay(o: { reuse: boolean; answers?: string[]; engines?: Array<Record<string, unknown>> }) {
  const clock = testClock("2026-10-20T09:00:00Z");
  const db = pipelineDb(tables(o.engines ? { report_engines: o.engines } : {}), clock.now);
  const before = JSON.stringify({ reports: db.tables.competitive_reports, snapshots: db.tables.rivaliq_snapshots });
  const claude = claudeBatches(o.answers ?? []);
  const calls: string[] = [];
  const pipeline = competitivePipeline({
    claudeFetch: claude.fetchImpl,
    rivaliq: () => async (path) => { calls.push(`rivaliq ${path}`); throw new Error("no RivalIQ in a replay"); },
    apify: () => { calls.push("apify"); throw new Error("no Apify in a replay"); },
    owned: async () => { calls.push("sprout"); throw new Error("no Sprout in a replay"); },
  });
  const started = await startCompetitiveReplay(db, pipeline, REPORT, { reuseAnalysis: o.reuse, now: clock.now });
  const env = (n: string) => (n === "ANTHROPIC_API_KEY" ? "test-key" : undefined);
  const result = await drivePipeline(db, makeRegistry([pipeline]), started.run_id, { clock, env });
  return { db, started, result, claude, calls, unchanged: () => JSON.stringify({ reports: db.tables.competitive_reports, snapshots: db.tables.rivaliq_snapshots }) === before };
}

describe("replay of a past competitive report from its saved snapshots", () => {
  it("picks the report's own attempt, or the snapshots saved before attempts were recorded", () => {
    const rows = ["status", "companies", "metrics", "socialposts"].map((endpoint) => ({ endpoint, attempt_started_at: "2026-10-07T07:15:04.906+00:00" }));
    expect(replayAttempt(rows, "2026-10-07T07:15:04.906Z")).toBe("2026-10-07T07:15:04.906Z");
    expect(replayAttempt(rows.map((r) => ({ ...r, attempt_started_at: null })), "2026-10-07T07:15:04.906Z")).toBeNull();
    expect(() => replayAttempt(rows.slice(1), "2026-10-07T07:15:04.906Z")).toThrow("incomplete");
    expect(() => pickReplaySnapshots([], null)).toThrow("no saved status answer");
  });

  it("with the real analysis: no provider is called, only shadow storage is written, and the figures are the stored report's", async () => {
    const r = await replay({ reuse: true });
    expect(r.result.outcome.status).toBe("done");
    expect(r.calls).toEqual([]);
    expect(r.claude.requests).toEqual([]);
    expect(r.unchanged()).toBe(true);
    expect(r.db.tables.calendar_posts ?? []).toEqual([]);
    expect(r.result.calls.map((c) => c.step)).toEqual(["start", "replay_sources", "aggregate", "assemble", "write"]);
    const run = r.db.tables.report_pipeline_runs[0];
    expect(run).toMatchObject({ kind: "competitive", mode: "shadow", status: "done", real_table: "competitive_reports", real_id: REPORT, app_capable: true });
    expect(run.input.replay).toMatchObject({ report_id: REPORT, reuse_analysis: true, landscape: { id: FX.real_landscape.id, matched_by: "explicit id" } });
    expect(run.input.request).toMatchObject({ report_id: REPORT, client_id: MOBURST, set_id: FX.set.id, date_range_start: "2026-09-01", date_range_end: "2026-09-30", owned_source: "sprout" });
    const shadow = r.db.tables.shadow_competitive_reports;
    expect(shadow).toHaveLength(1);
    expect(shadow[0]).toMatchObject({ run_id: run.id, client_id: MOBURST, real_report_id: REPORT, set_id: FX.set.id, date_range_start: "2026-09-01", date_range_end: "2026-09-30" });
    const figures = competitiveFigures(shownCompetitiveReport(shadow[0].report_data, postsSnapshot()));
    const c = compareResults(FX.expected, figures);
    expect(c.numbers.differences).toEqual([]);
    expect(c.text.filter((t) => !t.same)).toEqual([]);
    expect(c.onlyReal).toEqual([]);
    expect(c.onlyShadow).toEqual([]);
    expect(c.numbers.compared).toBeGreaterThan(100);
    expect(shadow[0].report_data.ai_analysis.executive_summary).toBeTruthy();
    expect(shadow[0].report_data.aggregates.metric_semantics_version).toBe(4);
  });

  it("with Claude: one batch request on Opus 5.5 with the ported prompt, its answer parsed and stored", async () => {
    const r = await replay({ reuse: false, answers: [JSON.stringify(FX.real_analysis)], engines: [{ kind: "competitive", client_id: MOBURST, engine: "shadow" }] });
    expect(r.result.outcome.status).toBe("done");
    expect(r.calls).toEqual([]);
    expect(r.unchanged()).toBe(true);
    expect(r.result.calls.map((c) => c.step)).toEqual(["start", "replay_sources", "aggregate", "analysis", "analysis", "parse", "assemble", "write"]);
    expect(r.claude.requests).toHaveLength(1);
    // deno-lint-ignore no-explicit-any
    const params = r.claude.requests[0].params as any;
    expect(params).toMatchObject({ model: ANALYSIS_MODEL, system: ANALYSIS_SYSTEM_PROMPT, output_config: { effort: "high" } });
    expect(params).not.toHaveProperty("temperature");
    expect(params.messages[0].content).toContain("\"client_name\":\"Moburst\"");
    const shadow = r.db.tables.shadow_competitive_reports[0].report_data;
    expect(shadow.ai_analysis.gaps_for_client.length).toBeGreaterThan(0);
    expect(competitiveFigures(shownCompetitiveReport(shadow, postsSnapshot()))).toEqual(FX.expected);
  });

  it("repairs an answer that does not match its format with the parser's repair prompt", async () => {
    // deno-lint-ignore no-explicit-any
    const broken: any = { ...FX.real_analysis, gaps_for_client: FX.real_analysis.gaps_for_client.map((g: any) => ({ ...g, platform: "Instagram Reels" })) };
    const r = await replay({ reuse: false, answers: ["Here is the analysis:\n" + JSON.stringify(broken), JSON.stringify(FX.real_analysis)], engines: [{ kind: "competitive", client_id: MOBURST, engine: "shadow" }] });
    expect(r.result.outcome.status).toBe("done");
    expect(r.claude.requests).toHaveLength(2);
    // deno-lint-ignore no-explicit-any
    const repair = (r.claude.requests[1].params as any).messages[0].content as string;
    expect(repair.startsWith("Repair only the JSON structure to match the schema.")).toBe(true);
    expect(repair).toContain("Validation error: gaps_for_client[0].platform must be one of");
    expect(r.result.calls.map((c) => c.step)).toContain("parse_repair");
  });

  it("asks Claude only for a client whose competitive switch is on shadow; reuse_analysis replays any client at no cost", async () => {
    const clock = testClock("2026-10-20T09:00:00Z");
    const db = pipelineDb(tables(), clock.now);
    await expect(startCompetitiveReplay(db, competitivePipeline(), REPORT, { now: clock.now })).rejects.toThrow("only for a client whose competitive switch is on shadow");
    expect(db.rpcCalls).toEqual([]);
    const free = await startCompetitiveReplay(db, competitivePipeline(), REPORT, { reuseAnalysis: true, now: clock.now });
    expect(free).toMatchObject({ started: true, attempt_started_at: FX.report.created_at });
    await expect(startCompetitiveReplay(db, competitivePipeline(), "missing", { reuseAnalysis: true })).rejects.toThrow("No competitive report has that id");
  });

  it("a live shadow of a past report runs only on shadow, carries no replay and n8n's request, and goes to the live steps", async () => {
    const clock = testClock("2026-10-20T09:00:00Z");
    const db = pipelineDb(tables(), clock.now);
    await expect(startCompetitiveShadow(db, competitivePipeline(), REPORT, { now: clock.now })).rejects.toThrow("A live shadow runs only for a client whose competitive switch is on shadow.");
    const shadowDb = pipelineDb(tables({ report_engines: [{ kind: "competitive", client_id: MOBURST, engine: "shadow" }] }), clock.now);
    const started = await startCompetitiveShadow(shadowDb, competitivePipeline(), REPORT, { now: clock.now });
    expect(started).toMatchObject({ started: true, attempt_started_at: FX.report.created_at });
    const run = shadowDb.tables.report_pipeline_runs.find((r) => r.id === started.run_id) as Record<string, any>;
    expect(run).toMatchObject({ mode: "shadow", kind: "competitive", real_table: "competitive_reports", real_id: REPORT });
    expect(run.input.replay).toBeUndefined();
    expect(run.input.request).toMatchObject({ report_id: REPORT });
    expect(String(run.dedupe_key)).toMatch(/^live:competitive:/);
  });

  it("compares as a screen shows both reports, listing each number that differs", async () => {
    const r = await replay({ reuse: true });
    const shadow = r.db.tables.shadow_competitive_reports[0].report_data;
    const real = structuredClone(shadow);
    real.aggregates.companies[0].rivaliq_metrics.posts.current += 1;
    real.generated_at = "2026-10-07T07:28:00.000Z";
    const c = compareCompetitive(real, shadow, postsSnapshot());
    const paths = c.numbers.differences.map((d) => d.path);
    expect(paths).toContain(`aggregates.companies.company_id=${shadow.aggregates.companies[0].company_id}.rivaliq_metrics.posts.current`);
    expect(paths.some((p) => p.includes("generated_at"))).toBe(false);
    expect(compareCompetitive(shadow, structuredClone(shadow), postsSnapshot()).numbers.differences).toEqual([]);
  });

  it("compares a finished run with the report it shadows, through the stores", async () => {
    const r = await replay({ reuse: true });
    const run = r.db.tables.report_pipeline_runs[0];
    // The real row stands in with the shadow's own data: nothing differs.
    r.db.tables.competitive_reports[0].report_data = structuredClone(r.db.tables.shadow_competitive_reports[0].report_data);
    const out = await compareCompetitiveRun(r.db, run.id);
    expect(out?.real_id).toBe(REPORT);
    expect(out?.comparison.numbers.differences).toEqual([]);
    expect(out?.text).toContain("Numbers:");
  });
});
