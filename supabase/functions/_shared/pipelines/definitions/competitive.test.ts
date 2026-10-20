// @vitest-environment node
// The in-app competitive pipeline end to end, live (not a replay), through the
// real step runner and stores. RivalIQ, the Apify actor, Sprout and Claude
// are stand-ins that answer with what the providers answered for Moburst's
// September 2026 report (the replay fixture): RivalIQ's companies, metrics
// and posts, the LinkedIn rows the actor returned (rebuilt from the verified
// posts and the LinkedIn figures n8n saved), the client's Sprout collection,
// and the stored analysis. So the figures must come out as the stored n8n
// report shows them, and every write must land where its mode allows.
import { describe, expect, it } from "vitest";
import type { ApifyClient } from "../../apify/client";
import { buildCompetitivePayload } from "../../reports/payloads";
import { competitiveFigures, shownCompetitiveReport } from "../competitive/harness";
import { RivalIqBusy } from "../competitive/rivaliq";
import { makeRegistry } from "../registry";
import { startPipelineRun } from "../store";
import { drivePipeline, pipelineDb, testClock } from "../testDriver";
import { competitivePipeline, POST_WINDOW_SPACING_SECONDS, type CompetitiveDeps } from "./competitive";
import { FX, linkedInRows, owned, POSTS, snap } from "../fixtures/moburst";

// deno-lint-ignore no-explicit-any
type Any = any;

const LANDSCAPE = Number(FX.real_landscape.id);

/** RivalIQ as it answered: the landscape, readiness (collecting once), companies, the four metrics reads and the weekly posts. */
function rivaliq(o: { calls: string[]; busyOnce?: boolean; failSummary?: boolean }) {
  let statusReads = 0;
  let busy = o.busyOnce;
  const rival = POSTS.socialPosts.filter((p: Any) => p.source !== "apify/harvestapi" && p.source !== "sprout");
  return () => async (path: string, query: Record<string, string>) => {
    o.calls.push(`${path}${query.mainPeriodStart ? ` ${query.mainPeriodStart}..${query.mainPeriodEnd}` : ""}`);
    if (path === "/v3/landscapes") return [{ id: LANDSCAPE, name: FX.real_landscape.name, focusCompanyId: FX.real_landscape.focus_company_id, companies: snap("companies").companies }];
    if (path.endsWith("/status")) return { status: statusReads++ === 0 ? 2 : 1 };
    if (path.endsWith("/companies")) return snap("companies");
    if (path.endsWith("/metrics/timeseries")) return snap("metrics").timeseries;
    if (path.endsWith("/metrics/summary")) {
      if (query.mainPeriodStart === "2026-09-01") {
        if (o.failSummary) throw new Error("RivalIQ /metrics/summary answered 500");
        return snap("metrics").summary;
      }
      if (query.mainPeriodStart === "2026-08-02") return snap("metrics").summary_previous;
      return snap("metrics").audience_snapshot;
    }
    if (path.endsWith("/socialposts")) {
      if (busy) { busy = false; throw new RivalIqBusy("RivalIQ /socialposts is busy: ConnectionBusy", 30); }
      const inWindow = (p: Any, i: number) => {
        const day = String(p.publishedAt || "").slice(0, 10);
        return day ? day >= query.mainPeriodStart && day <= query.mainPeriodEnd : query.mainPeriodStart === "2026-09-01" && i >= 0;
      };
      return { socialPosts: rival.filter(inWindow) };
    }
    throw new Error(`unexpected RivalIQ read ${path}`);
  };
}

function apify(o: { calls: string[] }) {
  let reads = 0;
  const client: ApifyClient = {
    async startRun(actorId, input, opts) { o.calls.push(`start ${actorId} ${JSON.stringify(input)} ${opts.timeoutSecs}s ${opts.memoryMbytes}MB`); return { id: "apify-run-1", status: "RUNNING", defaultDatasetId: "ds-1" }; },
    async getRun(runId) { o.calls.push(`look ${runId}`); return { id: runId, status: reads++ === 0 ? "RUNNING" : "SUCCEEDED", defaultDatasetId: "ds-1" }; },
    async datasetPage() { return []; },
    async datasetItems() { o.calls.push("dataset"); return linkedInRows(); },
  };
  return () => client;
}

function claude(answer: string, requests: Any[]) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { requests.push(JSON.parse(String(init.body)).requests[0]); return new Response(JSON.stringify({ id: "batch-1" })); }
    if (url.endsWith("/results")) return new Response(JSON.stringify({ custom_id: requests[0].custom_id, result: { type: "succeeded", message: { content: [{ type: "text", text: answer }], stop_reason: "end_turn" } } }) + "\n");
    return new Response(JSON.stringify({ processing_status: "ended", results_url: `${url}/results` }));
  };
}

const ENV_ALL = (n: string) => ({ RIVALIQ_API_KEY: "rq", ANTHROPIC_API_KEY: "ak", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];

async function run(o: { mode: "shadow" | "app"; env?: (n: string) => string | undefined; deps?: Partial<CompetitiveDeps>; failSummary?: boolean; busyOnce?: boolean; staggerSeconds?: number; reportStatus?: string; onClock?: (c: ReturnType<typeof testClock>) => void }) {
  const clock = testClock("2026-10-07T07:15:04.906Z");
  o.onClock?.(clock);
  const reportId = "report-live-1";
  const createdAt = clock.now().toISOString();
  const db = pipelineDb({
    competitive_reports: [{ id: reportId, client_id: FX.report.client_id, set_id: FX.set.id, status: o.reportStatus ?? "running", created_at: createdAt, date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: {} }],
    rivaliq_snapshots: [],
    clients: [FX.client],
    competitor_sets: [{ ...FX.set, status: "analyzing" }],
    competitors: FX.competitors,
    sprout_profiles: FX.sprout_profiles,
    competitive_insight_feedback: [],
    competitive_learnings: [{ client_id: FX.report.client_id, kind: "prefer", text: "Lead with LinkedIn ideas.", created_at: "2026-10-01T00:00:00Z" }],
  }, clock.now);
  const request = await buildCompetitivePayload({ supabase: db, client: FX.client, reportId, attemptStartedAt: createdAt, set: FX.set, range: { start: "2026-09-01", end: "2026-09-30" }, ...(o.staggerSeconds ? { staggerSeconds: o.staggerSeconds } : {}) });
  const calls = { rivaliq: [] as string[], apify: [] as string[], sprout: 0 };
  const requests: Any[] = [];
  const pipeline = competitivePipeline({
    rivaliq: rivaliq({ calls: calls.rivaliq, failSummary: o.failSummary, busyOnce: o.busyOnce }),
    apify: apify({ calls: calls.apify }),
    owned: async () => { calls.sprout += 1; return owned(); },
    claudeFetch: claude(JSON.stringify(FX.real_analysis), requests),
    ...o.deps,
  });
  const { run_id } = await startPipelineRun(db, { mode: o.mode, pipeline, clientId: FX.report.client_id, realTable: "competitive_reports", realId: reportId, input: { range: { start: "2026-09-01", end: "2026-09-30" }, set_id: FX.set.id, request }, dedupe: `${o.mode}:competitive:${reportId}` });
  const result = await drivePipeline(db, makeRegistry([pipeline]), run_id, { clock, env: o.env ?? ENV_ALL });
  return { db, result, calls, requests, request, reportId, createdAt, clock };
}

const steps = (r: Awaited<ReturnType<typeof run>>) => r.result.calls.map((c) => c.step);

describe("the in-app competitive pipeline, live", () => {
  it("shadow: reads every source as n8n does, writes only shadow storage, and its figures are the stored report's", async () => {
    const r = await run({ mode: "shadow" });
    expect(r.result.outcome.status).toBe("done");
    expect(steps(r)).toEqual([
      "start", "landscape", "readiness", "readiness", "companies", "metrics", "metrics", "metrics", "metrics", "metrics",
      "posts", "posts", "posts", "posts", "posts", "linkedin", "linkedin", "linkedin", "owned", "aggregate", "analysis", "analysis", "parse", "assemble", "write",
    ]);
    // The same reads, in the same order: landscapes, status twice (collecting once), companies, three period reads, the audience day, five weekly windows.
    expect(r.calls.rivaliq).toEqual([
      "/v3/landscapes", `/v3/landscapes/${LANDSCAPE}/status`, `/v3/landscapes/${LANDSCAPE}/status`, `/v3/landscapes/${LANDSCAPE}/companies`,
      `/v3/landscapes/${LANDSCAPE}/metrics/summary 2026-09-01..2026-09-30`, `/v3/landscapes/${LANDSCAPE}/metrics/summary 2026-08-02..2026-08-31`,
      `/v3/landscapes/${LANDSCAPE}/metrics/timeseries 2026-09-01..2026-09-30`, `/v3/landscapes/${LANDSCAPE}/metrics/summary 2026-10-06..2026-10-06`,
      `/v3/landscapes/${LANDSCAPE}/socialposts 2026-09-01..2026-09-07`, `/v3/landscapes/${LANDSCAPE}/socialposts 2026-09-08..2026-09-14`,
      `/v3/landscapes/${LANDSCAPE}/socialposts 2026-09-15..2026-09-21`, `/v3/landscapes/${LANDSCAPE}/socialposts 2026-09-22..2026-09-28`,
      `/v3/landscapes/${LANDSCAPE}/socialposts 2026-09-29..2026-09-30`,
    ]);
    // The actor with n8n's input: the reviewed pages from the previous period's first day, 150 posts, no reposts; 240 s and 512 MB.
    expect(r.calls.apify[0]).toBe(`start WI0tj4Ieb5Kq458gB ${JSON.stringify({ targetUrls: POSTS.linkedin_sources.map((s: Any) => s.profile_url), maxPosts: 150, postedLimitDate: "2026-08-02", scrapeComments: false, scrapeReactions: false, includeReposts: false, includeQuotePosts: true })} 240s 512MB`);
    expect(r.calls.sprout).toBe(1);
    // Untouched: the real report, the real snapshots, the set.
    expect(r.db.tables.competitive_reports[0]).toMatchObject({ status: "running", report_data: {} });
    expect(r.db.tables.rivaliq_snapshots).toEqual([]);
    expect(r.db.tables.competitor_sets[0].status).toBe("analyzing");
    const payloadKeys = r.db.tables.pipeline_payloads.map((p) => p.key);
    expect(payloadKeys).toEqual(expect.arrayContaining(["output.snapshot.status", "output.snapshot.companies", "output.snapshot.metrics", "output.snapshot.socialposts", "apify.dataset"]));
    const shadow = r.db.tables.shadow_competitive_reports[0];
    expect(shadow).toMatchObject({ real_report_id: r.reportId, date_range_start: "2026-09-01", date_range_end: "2026-09-30" });
    expect(competitiveFigures(shownCompetitiveReport(shadow.report_data, POSTS))).toEqual(FX.expected);
    expect(r.db.tables.report_pipeline_steps.at(-1)).toMatchObject({ step: "write", outcome: "done", detail: { wrote: "shadow_competitive_reports", would_be: "complete" } });
  });

  it("waits 125 s between weekly windows and 60 s between readiness looks, as polls", async () => {
    const r = await run({ mode: "shadow" });
    const polls = r.result.calls.filter((c) => c.outcome.reason?.includes("looks again"));
    const waits = (step: string) => polls.filter((c) => c.step === step).map((c) => c.outcome.reason);
    expect(waits("posts")).toEqual(Array(4).fill(`Step posts looks again in ${POST_WINDOW_SPACING_SECONDS} s.`));
    expect(waits("readiness")).toEqual(["Step readiness looks again in 60 s."]);
    // Looking again is never a failed try.
    expect(polls.every((c) => c.outcome.deferred === true)).toBe(true);
  });

  it("sends the team's learned preferences with the analysis, as the live n8n node does", async () => {
    const r = await run({ mode: "shadow" });
    const text = r.requests[0].params.messages[0].content as string;
    expect(text).toContain("Follow every one when you write gaps_for_client:\n- Prefer: Lead with LinkedIn ideas.");
    expect(r.request.team_preferences).toEqual(["Prefer: Lead with LinkedIn ideas."]);
  });

  it("waits quietly while RivalIQ is busy and staggers a scheduled run first, neither counting as a failed try", async () => {
    const r = await run({ mode: "shadow", busyOnce: true, staggerSeconds: 240 });
    expect(r.result.outcome.status).toBe("done");
    expect(r.result.calls[0].outcome.reason).toBe("Step start looks again in 240 s.");
    expect(r.result.calls.some((c) => c.step === "posts" && c.outcome.reason === "Step posts looks again in 30 s.")).toBe(true);
    expect(r.result.calls.every((c) => !c.outcome.reason?.includes("tried again"))).toBe(true);
  });

  it("staggers a scheduled run for its whole stagger, past the longest single wait", async () => {
    const r = await run({ mode: "shadow", staggerSeconds: 2700 });
    expect(r.result.outcome.status).toBe("done");
    expect(r.result.calls.slice(0, 3).map((c) => c.outcome.reason)).toEqual(["Step start looks again in 1800 s.", "Step start looks again in 900 s.", "Step start done; landscape is next."]);
  });

  it("waits for the Apify token, saying so in its step log, and goes on once it is set", async () => {
    // The token arrives half an hour after the run starts.
    const start = Date.parse("2026-10-07T07:15:04.906Z");
    let now = () => start;
    const r = await run({ mode: "shadow", env: (n) => (n === "APIFY_API_TOKEN" ? (now() >= start + 30 * 60_000 ? "ap" : undefined) : ENV_ALL(n)), onClock: (c) => { now = () => c.now().getTime(); } });
    expect(r.result.outcome.status).toBe("done");
    const waits = r.db.tables.report_pipeline_steps.filter((s) => s.step === "linkedin" && s.detail?.waiting_for === "APIFY_API_TOKEN");
    expect(waits.length).toBeGreaterThan(0);
    expect(waits[0]).toMatchObject({ outcome: "poll", detail: { note: "APIFY_API_TOKEN is not set yet; the step looks again in 10 minutes." } });
    expect(competitiveFigures(shownCompetitiveReport(r.db.tables.shadow_competitive_reports[0].report_data, POSTS))).toEqual(FX.expected);
  });

  it("continues without a period metrics answer on its last try, as n8n's node does, and the result is held by the quality check", async () => {
    const r = await run({ mode: "shadow", failSummary: true });
    expect(r.result.outcome.status).toBe("done");
    const summaryTries = r.result.calls.filter((c) => c.step === "metrics").map((c) => c.outcome.reason);
    expect(summaryTries.filter((x) => x?.includes("tried again"))).toHaveLength(4);
    const shadow = r.db.tables.shadow_competitive_reports[0].report_data;
    expect(shadow.aggregates.metrics_available).toBe(false);
    expect(shadow.quality_check).toMatchObject({ state: "needs_review" });
    expect(r.db.tables.report_pipeline_steps.at(-1)?.detail).toMatchObject({ would_be: "failed" });
  });

  it("app: writes the real report and its snapshots through update-competitive-report's writer, fenced to the attempt", async () => {
    const r = await run({ mode: "app" });
    expect(r.result.outcome.status).toBe("done");
    const report = r.db.tables.competitive_reports[0];
    expect(report.status).toBe("complete");
    expect(report.duration_minutes).toBeGreaterThanOrEqual(1);
    expect(competitiveFigures(shownCompetitiveReport(report.report_data, POSTS))).toEqual(FX.expected);
    expect(r.db.tables.rivaliq_snapshots.map((s) => s.endpoint).sort()).toEqual(["companies", "metrics", "socialposts", "status"]);
    for (const s of r.db.tables.rivaliq_snapshots) expect(s).toMatchObject({ report_id: r.reportId, attempt_started_at: r.createdAt, landscape_id: String(LANDSCAPE), client_id: FX.report.client_id });
    expect(r.db.tables.competitor_sets[0].status).toBe("complete");
    expect(r.db.tables.shadow_competitive_reports ?? []).toEqual([]);
  });

  it("app: writes nothing once the dispatch has taken the report away", async () => {
    const r = await run({ mode: "app", reportStatus: "failed" });
    expect(r.result.outcome.status).toBe("done");
    expect(r.db.tables.competitive_reports[0]).toMatchObject({ status: "failed", report_data: {} });
    expect(r.db.tables.rivaliq_snapshots).toEqual([]);
  });
});
