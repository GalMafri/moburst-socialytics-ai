// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// The pipeline reads the client's time zone (clients.timezone) and stores it
// with the report, counting every company's posting hours in it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { competitivePipeline } from "../../../../functions/_shared/pipelines/definitions/competitive";
import { makeRegistry } from "../../../../functions/_shared/pipelines/registry";
import { drivePipeline, pipelineDb, testClock } from "../../../../functions/_shared/pipelines/testDriver";
import { startCompetitiveReplay } from "../../../../functions/_shared/pipelines/competitive/harness";

const here = dirname(fileURLToPath(import.meta.url));
const FX: any = JSON.parse(readFileSync(join(here, "..", "..", "..", "..", "fixtures", "pipelines", "competitive-replay-moburst-2026-09.json"), "utf8"));

async function aggregatesFor(timezone: string | null) {
  const clock = testClock("2026-10-20T09:00:00Z");
  const db = pipelineDb({
    competitive_reports: [{ ...FX.report, report_data: { landscape: FX.real_landscape, ai_analysis: FX.real_analysis, aggregates: { companies: [] }, period: { start: FX.report.date_range_start, end: FX.report.date_range_end } } }],
        rivaliq_snapshots: FX.snapshots.map((s: any, i: number) => ({ id: `snap-${i}`, report_id: FX.report.id, client_id: FX.report.client_id, ...s })),
    clients: [{ ...FX.client, timezone }],
    competitor_sets: [FX.set], competitors: FX.competitors, sprout_profiles: FX.sprout_profiles,
    competitive_insight_feedback: [], competitive_learnings: [],
    report_engines: [{ kind: "competitive", client_id: null, engine: "n8n" }],
  }, clock.now);
  const pipeline = competitivePipeline({});
  const started = await startCompetitiveReplay(db, pipeline, FX.report.id, { reuseAnalysis: true, now: clock.now });
  const result = await drivePipeline(db, makeRegistry([pipeline]), started.run_id, { clock, env: () => undefined });
  expect(result.outcome.status).toBe("done");
  return db.tables.shadow_competitive_reports[0].report_data.aggregates;
}

describe("the client's time zone in a competitive run", () => {
  it("is stored with the report, and the client's hours are counted in it", async () => {
    const utc = await aggregatesFor(null);
    const ny = await aggregatesFor("America/New_York");
    expect(utc.time_zone).toBeUndefined();
    expect(ny.time_zone).toBe("America/New_York");
        const me = (a: any) => a.companies.find((c: any) => c.is_client);
    expect(JSON.stringify(me(ny).by_hour)).not.toBe(JSON.stringify(me(utc).by_hour));
    const total = (counts: Record<string, number>) => Object.values(counts).reduce((s, n) => s + n, 0);
    expect(total(me(ny).by_hour)).toBe(total(me(utc).by_hour));
  });
});
