// @vitest-environment node
// The monthly report's insights worded in its run (Trends plan, Phase 3
// point 2): nothing is paid for a report that can't have them, and a retry
// words the same input as the try before it.
import { describe, expect, it } from "vitest";
import { MOBURST } from "../../../../fixtures/pipelines/social";
import { fakeDb } from "../../../../functions/_shared/lifecycle/fakeDb";
import { readOnlyDb } from "../../../../functions/_shared/pipelines/store";
import { runInsights } from "../../../../functions/_shared/pipelines/social/runInsights";
import type { InsightsDeps } from "../../../../functions/_shared/reports/insights";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPORT_DATA = MOBURST.stored_report.report_data;
const CREATED = "2026-11-12T07:00:00.000Z";
const LIVE_FROM = "2026-11-10T22:00:00.000Z";
const report = (o: Any = {}) => ({
  id: "r1", client_id: "c1", status: "running", created_at: CREATED, date_range_start: "2026-10-01", date_range_end: "2026-10-31", report_data: {},
  clients: { name: "Moburst", archived_at: null }, ...o,
});
/** An earlier finished report of the client with the same figures, so its changes are the client's usual swing. */
const earlier = (i: number) => ({ id: `e${i}`, client_id: "c1", status: "completed", created_at: `2026-0${i + 6}-05T07:00:00.000Z`, report_data: REPORT_DATA });

function setup(o: { liveFrom?: string | null; row?: Any } = {}) {
  const db = fakeDb({ reports: [o.row ?? report()], report_insights: [] }, { report_insights_live_from: () => (o.liveFrom === undefined ? LIVE_FROM : o.liveFrom) });
  return { db, ro: readOnlyDb(db) };
}

/** A model that refuses: the facts in code's own words, after two calls. */
function model(calls: Any[]): InsightsDeps["complete"] {
  return async (body) => { calls.push(body); return { text: "", stopReason: "refusal", raw: {} }; };
}

const run = (ro: Any, calls: Any[], o: Any = {}) => runInsights({
  db: ro, reportId: "r1", reportData: REPORT_DATA, answered: null, complete: model(calls), now: () => new Date("2026-11-12T08:00:00.000Z"), ...o,
});

describe("runInsights", () => {
  it("asks when insights went live before any call: a report from before gets none, and nothing is paid", async () => {
    const calls: Any[] = [];
    expect(await run(setup({ liveFrom: "2026-11-12T09:00:00.000Z" }).ro, calls)).toMatchObject({ row: null, from: "none", reason: "The report is from before report insights." });
    expect(await run(setup({ liveFrom: null }).ro, calls)).toMatchObject({ row: null, from: "none" });
    expect(calls).toEqual([]);
    expect((await run(setup().ro, calls)).from).toBe("model");
    expect(calls).toHaveLength(2);
  });

  it("in app mode, gives a report made again or no longer running none, before any call", async () => {
    const calls: Any[] = [];
    expect(await run(setup().ro, calls, { attemptStartedAt: "2026-11-12T06:00:00.000Z" })).toMatchObject({ row: null, reason: "The report was made again since the run started." });
    expect(await run(setup({ row: report({ status: "completed" }) }).ro, calls, { attemptStartedAt: CREATED })).toMatchObject({ row: null, reason: "The report is no longer running." });
    expect(calls).toEqual([]);
    expect((await run(setup().ro, calls, { attemptStartedAt: CREATED })).from).toBe("model");
  });

  it("reads the client's earlier reports once: a retry with the history it kept words the same input after another report finished", async () => {
    const { db, ro } = setup();
    const calls: Any[] = [];
    const kept: Any[] = [];
    const first = await run(ro, calls, { onHistory: async (h: Any) => { kept.push(h); } });
    expect(first.from).toBe("model");
    expect(kept).toEqual([[]]);
    // Three earlier reports finish in between.
    db.tables.reports.push(earlier(0), earlier(1), earlier(2));
    const again = await run(ro, calls, { history: kept[0], answered: first.row });
    expect(again).toMatchObject({ from: "kept" });
    expect(again.row!.input_hash).toBe(first.row!.input_hash);
    expect(calls).toHaveLength(2);
    // Read afresh, the history is another input: the kept one is what keeps the retry free.
    const fresh = await run(ro, calls, { answered: first.row });
    expect(fresh.row!.input_hash).not.toBe(first.row!.input_hash);
  });
});
