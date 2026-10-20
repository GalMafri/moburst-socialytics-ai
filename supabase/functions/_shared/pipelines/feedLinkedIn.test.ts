// @vitest-environment node
// The competitor feed's LinkedIn posts under the LinkedIn source's switch.
// n8n and shadow: the n8n workflow answers the feed, exactly as before. app:
// the in-app pipeline runs inside the refresh, recorded as an app run with
// its step log, its answer checked as n8n's is; a run that stops counts, and
// after APP_STOPS_BEFORE_N8N stops for the window n8n collects it again.
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../lifecycle/fakeDb";
import { linkedInSourcePipeline } from "./definitions/linkedinSource";
import { feedLinkedInAnswer, LINKEDIN_INLINE_BUDGET_MS } from "./feedLinkedIn";
import { InlineRunStopped } from "./inline";
import { fakeActor, POSTS } from "./fixtures/moburst";
import { APP_STOPS_BEFORE_N8N } from "./types";

const MOBURST = "d00ce604-2bcc-455a-9826-f80250db75cf";
const SOURCES = POSTS.linkedin_sources;
const PERIOD = { start: "2026-09-22", end: "2026-09-28" };
const N8N_ANSWER = { socialPosts: [{ postId: "linkedin:n8n" }], additional_metrics: {} };

function setup(statuses: Parameters<typeof fakeActor>[0] = ["RUNNING", "SUCCEEDED"], runs: Array<Record<string, unknown>> = []) {
  const db = fakeDb({ report_pipeline_runs: runs, report_pipeline_steps: [], pipeline_payloads: [] });
  const calls: string[] = [];
  const pipeline = linkedInSourcePipeline({ apify: fakeActor(statuses, calls) });
  let t = Date.parse("2026-09-29T06:00:00Z");
  const now = () => new Date(t);
  const n8n = vi.fn(async () => N8N_ANSWER);
  const args = { clientId: MOBURST, sources: SOURCES, period: PERIOD, now, env: (n: string) => (n === "APIFY_API_TOKEN" ? "token" : undefined), inline: { sleep: async (ms: number) => { t += ms; } } };
  return { db, calls, pipeline, n8n, args, advance: (ms: number) => { t += ms; } };
}

describe("feedLinkedInAnswer", () => {
  it("on n8n and on shadow, the n8n workflow answers the feed and nothing runs in the app", async () => {
    for (const engine of [{ engine: "n8n" as const }, { engine: "shadow" as const, pipeline: setup().pipeline }]) {
      const s = setup();
      expect(await feedLinkedInAnswer(s.db, engine, s.args, s.n8n)).toBe(N8N_ANSWER);
      expect(s.n8n).toHaveBeenCalledTimes(1);
      expect(s.calls).toEqual([]);
      expect(s.db.tables.report_pipeline_runs).toEqual([]);
    }
  });

  it("on app, runs the pipeline in the refresh and answers as n8n would, recorded as an app run", async () => {
    const s = setup();
    const answer = await feedLinkedInAnswer(s.db, { engine: "app", pipeline: s.pipeline }, s.args, s.n8n);
    expect(s.n8n).not.toHaveBeenCalled();
    expect(answer.linkedin_posts).toBeGreaterThan(0);
    for (const src of SOURCES) expect(answer.additional_metrics[src.company_id]).toMatchObject({ coverage: "complete", profile_url: src.profile_url, period: PERIOD });
    const run = s.db.tables.report_pipeline_runs[0];
    expect(run).toMatchObject({ kind: "linkedin_source", pipeline: "linkedin_source_v1", mode: "app", app_capable: true, status: "done", real_table: "rivaliq_snapshots", real_id: null, client_id: MOBURST });
    expect(run.real_ref).toMatchObject({ client_id: MOBURST, endpoint: "feed", window: PERIOD });
    expect(s.db.tables.report_pipeline_steps.map((x) => [x.step, x.outcome, x.job_id])).toEqual([["collect", "poll", null], ["collect", "poll", null], ["collect", "done", null]]);
    expect(s.db.tables.pipeline_payloads.map((p) => p.key).sort()).toEqual(["apify.dataset", "result"]);
  });

  it("on app, a run that stops throws for the refresh's quiet retry, and n8n collects the window once two have stopped", async () => {
    const s = setup(["FAILED"]);
    for (let i = 0; i < APP_STOPS_BEFORE_N8N; i++) {
      await expect(feedLinkedInAnswer(s.db, { engine: "app", pipeline: s.pipeline }, s.args, s.n8n)).rejects.toBeInstanceOf(InlineRunStopped);
    }
    expect(s.db.tables.report_pipeline_runs.map((r) => r.status)).toEqual(["stopped", "stopped"]);
    expect(s.n8n).not.toHaveBeenCalled();
    expect(await feedLinkedInAnswer(s.db, { engine: "app", pipeline: s.pipeline }, s.args, s.n8n)).toBe(N8N_ANSWER);
    expect(s.db.tables.report_pipeline_runs).toHaveLength(2);
    // Another window starts in-app again.
    const next = setup(["SUCCEEDED"], s.db.tables.report_pipeline_runs);
    await feedLinkedInAnswer(next.db, { engine: "app", pipeline: next.pipeline }, { ...next.args, period: { start: "2026-09-23", end: "2026-09-29" } }, next.n8n);
    expect(next.n8n).not.toHaveBeenCalled();
  });

  it("on app, stops a run that does not finish in the time the n8n call had", async () => {
    const s = setup(["RUNNING"]);
    await expect(feedLinkedInAnswer(s.db, { engine: "app", pipeline: s.pipeline }, s.args, s.n8n)).rejects.toThrow(`did not finish in ${LINKEDIN_INLINE_BUDGET_MS / 1000} s`);
    expect(s.db.tables.report_pipeline_runs[0]).toMatchObject({ status: "stopped" });
  });

  it("on app with no reviewed pages, answers nothing and runs nothing, as the n8n call did", async () => {
    const s = setup();
    expect(await feedLinkedInAnswer(s.db, { engine: "app", pipeline: s.pipeline }, { ...s.args, sources: [] }, s.n8n)).toEqual({ socialPosts: [], additional_metrics: {} });
    expect(s.db.tables.report_pipeline_runs).toEqual([]);
  });
});
