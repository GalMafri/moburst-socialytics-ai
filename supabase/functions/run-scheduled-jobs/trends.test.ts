// @vitest-environment node
// The weekly trend_refresh job (spec section 3): one week row per client per
// week, and trends_v1 started on it in app mode. Clients without a trend
// profile are skipped before anything is paid for.
import { describe, expect, it } from "vitest";
import { pipelineDb } from "../_shared/pipelines/testDriver";
import { runTrendJob, startTrendWeek, weekStartOf } from "./trends";
import type { ScheduledJob } from "./types";

const NOW = new Date("2026-11-01T10:00:00.000Z");
const job = (client = "c1") => ({ id: "j1", kind: "trend_refresh", client_id: client, attempts: 1 } as unknown as ScheduledJob);
const withProfile = () => pipelineDb({
  trend_profiles: [{ client_id: "c1", audience: "a", fit_rubric: "f", platforms: [], search_overrides: {}, inputs_key: "k", written_at: NOW.toISOString() }],
}, () => NOW);

describe("the weekly trend_refresh job", () => {
  it("names a week by its Monday in Israel time", () => {
    expect(weekStartOf(NOW)).toBe("2026-10-26");
    // Sunday 1 Nov 23:30 UTC is already Monday 2 Nov in Israel.
    expect(weekStartOf(new Date("2026-11-01T23:30:00.000Z"))).toBe("2026-11-02");
  });

  it("makes one week row per client per week and starts trends_v1 in app mode on it", async () => {
    const db = withProfile();
    const first = await runTrendJob(db, job(), NOW);
    expect(first.status).toBe("done");
    expect(db.tables.trend_weeks).toHaveLength(1);
    const week = db.tables.trend_weeks[0];
    expect(week).toMatchObject({ client_id: "c1", week_start: "2026-10-26", status: "running" });
    expect(db.tables.report_pipeline_runs).toHaveLength(1);
    expect(db.tables.report_pipeline_runs[0]).toMatchObject({
      kind: "trends", pipeline: "trends_v1", mode: "app", client_id: "c1", real_table: "trend_weeks", real_id: week.id,
      dedupe_key: "trends:c1:2026-10-26", input: { week_start: "2026-10-26" },
    });
    expect(first.result).toMatchObject({ week_id: week.id, run_id: db.tables.report_pipeline_runs[0].id, started: true });

    const again = await runTrendJob(db, job(), NOW);
    expect(again.status).toBe("done");
    expect(db.tables.trend_weeks).toHaveLength(1);
    expect(db.tables.report_pipeline_runs).toHaveLength(1);
    expect(again.result).toMatchObject({ started: false });
  });

  it("skips a client without a trend profile and spends nothing", async () => {
    const db = pipelineDb({}, () => NOW);
    const out = await runTrendJob(db, job(), NOW);
    expect(out.status).toBe("skipped");
    expect(out.reason).toMatch(/no trend profile/i);
    expect(db.tables.trend_weeks ?? []).toHaveLength(0);
    expect(db.tables.report_pipeline_runs ?? []).toHaveLength(0);
  });

  it("starts a replay that reads another run's kept answers", async () => {
    const db = withProfile();
    await runTrendJob(db, job(), NOW);
    const replay = await startTrendWeek(db, "c1", NOW, { replayFrom: "run-1", suffix: "replay-1" });
    if (!("runId" in replay)) throw new Error(replay.skipped);
    const run = db.tables.report_pipeline_runs.find((r) => r.id === replay.runId)!;
    expect(run).toMatchObject({ dedupe_key: "trends:c1:2026-10-26:replay-1", input: { week_start: "2026-10-26", replay: { from_run: "run-1" } } });
    // The replay writes the same week again.
    expect(replay.weekId).toBe(db.tables.trend_weeks[0].id);
  });
});
