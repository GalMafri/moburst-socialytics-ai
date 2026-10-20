// @vitest-environment node
// The LinkedIn source pipeline on the queue (shadow): it waits for the Apify
// token, runs the actor with n8n's input, starts it again after a run that
// failed, checks every row as n8n does, and writes only shadow storage, next
// to what n8n answered. The actor is a stand-in answering with the rows the
// real actor returned for Moburst's competitors in September 2026.
import { describe, expect, it } from "vitest";
import { compareResults } from "../compare";
import { makeRegistry } from "../registry";
import { shadowLinkedInSource } from "../shadow";
import { loadShadowPair } from "../store";
import { drivePipeline, pipelineDb, testClock } from "../testDriver";
import { linkedInSourceAnswer, prepareSourceRequest, verifyLinkedInRows } from "../linkedin/sources";
import { fakeActor, linkedInRows, POSTS } from "../fixtures/moburst";
import { linkedInSourcePipeline } from "./linkedinSource";

// deno-lint-ignore no-explicit-any
type Any = any;
const MOBURST = "d00ce604-2bcc-455a-9826-f80250db75cf";
const SOURCES = POSTS.linkedin_sources;
const PERIOD = { start: "2026-09-22", end: "2026-09-28" };

/** n8n's answer for the same request (the port gives it, as the parity test shows). */
const n8nAnswer = () => { const plan = prepareSourceRequest({ sources: SOURCES, period: PERIOD }); return linkedInSourceAnswer(plan, verifyLinkedInRows(linkedInRows(), plan, { today: "2026-09-29" })); };

async function shadowRun(o: { statuses: ApifyRunStatus[]; tokenAfterMinutes?: number }) {
  const clock = testClock("2026-09-29T06:00:00Z");
  const db = pipelineDb({ rivaliq_snapshots: [], report_engines: [] }, clock.now);
  const calls: string[] = [];
  const pipeline = linkedInSourcePipeline({ apify: fakeActor(o.statuses, calls) });
  const start = clock.now().getTime();
  const env = (n: string) => (n === "APIFY_API_TOKEN" && clock.now().getTime() >= start + (o.tokenAfterMinutes ?? 0) * 60_000 ? "token" : undefined);
  const runId = await shadowLinkedInSource(db, { engine: "shadow", pipeline }, { clientId: MOBURST, sources: SOURCES, period: PERIOD, real: n8nAnswer(), now: clock.now });
  const result = await drivePipeline(db, makeRegistry([pipeline]), runId!, { clock, env });
  return { db, calls, result, runId: runId! };
}

describe("the LinkedIn source pipeline, shadowing n8n", () => {
  it("runs the actor with n8n's input and limits, checks the rows, and writes only shadow storage", async () => {
    const r = await shadowRun({ statuses: ["RUNNING", "SUCCEEDED"] });
    expect(r.result.outcome.status).toBe("done");
    expect(r.calls[0]).toBe(`start WI0tj4Ieb5Kq458gB ${JSON.stringify({ targetUrls: SOURCES.map((s: Any) => s.profile_url), maxPosts: 150, postedLimitDate: "2026-09-22", scrapeComments: false, scrapeReactions: false, includeReposts: false, includeQuotePosts: true })} 240/512`);
    expect(r.result.calls.map((c) => c.step)).toEqual(["collect", "collect", "collect"]);
    expect(r.db.tables.rivaliq_snapshots).toEqual([]);
    const shadow = r.db.tables.shadow_linkedin_sources;
    expect(shadow).toHaveLength(1);
    expect(shadow[0]).toMatchObject({ run_id: r.runId, client_id: MOBURST, period_start: PERIOD.start, period_end: PERIOD.end, sources: SOURCES });
    expect(shadow[0].result.linkedin_posts).toBeGreaterThan(0);
    for (const m of Object.values(shadow[0].result.additional_metrics) as Any[]) expect(m).toMatchObject({ coverage: "complete", period: PERIOD, reposts_included: false });
    // Next to what n8n answered: the same posts and figures.
    const pair = await loadShadowPair(r.db, r.runId);
    const c = compareResults(pair!.real, pair!.shadow, { keyBy: { socialPosts: "postId" } });
    expect(c.numbers.differences).toEqual([]);
    expect(c.onlyReal).toEqual([]);
    expect(c.onlyShadow).toEqual([]);
    expect(r.db.tables.pipeline_payloads.map((p) => p.key).sort()).toEqual(["apify.dataset", "real.output"]);
  });

  it("waits quietly for the Apify token, saying so in its step log", async () => {
    const r = await shadowRun({ statuses: ["SUCCEEDED"], tokenAfterMinutes: 25 });
    expect(r.result.outcome.status).toBe("done");
    const waits = r.db.tables.report_pipeline_steps.filter((s) => s.detail?.waiting_for === "APIFY_API_TOKEN");
    expect(waits).toHaveLength(3);
    expect(waits[0]).toMatchObject({ outcome: "poll", detail: { note: "APIFY_API_TOKEN is not set yet; the step looks again in 10 minutes.", wait_seconds: 600 } });
    expect(r.result.calls.every((c) => c.outcome.status === "queued" ? c.outcome.deferred || c.outcome.resetAttempts : true)).toBe(true);
  });

  it("starts the actor again after a run that failed or timed out, and never counts a timed-out run as complete", async () => {
    const r = await shadowRun({ statuses: ["FAILED", "TIMED-OUT", "SUCCEEDED"] });
    expect(r.result.outcome.status).toBe("done");
    expect(r.calls.filter((c) => c.startsWith("start"))).toHaveLength(3);
    expect(r.calls.filter((c) => c.startsWith("dataset"))).toEqual(["dataset ds-3"]);
  });

  it("stops quietly after the restarts are used up", async () => {
    const r = await shadowRun({ statuses: ["FAILED"] });
    expect(r.result.outcome.status).toBe("failed");
    expect(r.db.tables.report_pipeline_runs[0]).toMatchObject({ status: "stopped" });
    expect(r.db.tables.report_pipeline_runs[0].outcome).toContain("ended FAILED");
    expect(r.db.tables.shadow_linkedin_sources ?? []).toEqual([]);
  });
});
