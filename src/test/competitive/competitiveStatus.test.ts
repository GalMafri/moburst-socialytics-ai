import { describe, expect, it } from "vitest";
import { competitiveRunStatus, heldRunsOfPeriod, listedRuns, monthlyReportStatus } from "@/lib/display";
import { HELD_REDO_MINUTES, HELD_REDOS, REDO_LEASE_ALLOWANCE_MINUTES } from "../../../supabase/functions/_shared/competitive/reportEvidence";
import { watchExpired, watchInterval, WATCH_LIMIT_MINUTES } from "@/lib/runWatch";

const staff = { isStaff: true };
const client = { isStaff: false };
const ready = { aggregates: { companies: [{ name: "A", post_count: 3 }] } };
const held = { provider_status: 2, aggregates: { companies: [{ name: "A", post_count: 3 }] } };

describe("run statuses, one per row for both report tables", () => {
  it("names both tables' stored words the same way", () => {
    expect(monthlyReportStatus({ status: "completed" }, staff).label).toBe("Ready");
    expect(competitiveRunStatus({ status: "complete", report_data: ready }, staff).label).toBe("Ready");
    expect(monthlyReportStatus({ status: "running" }, staff).label).toBe("Running");
    expect(competitiveRunStatus({ status: "running", report_data: null }, staff).label).toBe("Running");
  });

  it("never shows a failure: a run that did not finish is made again by the product and shown to nobody", () => {
    for (const s of ["failed", "error", "cancelled"]) {
      expect(monthlyReportStatus({ status: s }, staff)).toMatchObject({ state: "scheduled", hidden: true });
      expect(competitiveRunStatus({ status: s, report_data: null }, staff)).toMatchObject({ state: "scheduled", hidden: true });
      expect(monthlyReportStatus({ status: s }, client).hidden).toBe(true);
    }
  });

  it("works out held from the whole row, so no screen can call a held run ready", () => {
    expect(competitiveRunStatus({ status: "complete", report_data: held }, staff)).toMatchObject({ state: "held", label: "Being redone", hidden: false });
    expect(competitiveRunStatus({ status: "complete", report_data: held }, client).hidden).toBe(true);
    expect(competitiveRunStatus({ status: "running", report_data: held }, staff).label).toBe("Running");
  });

  it("never prints a raw database value", () => {
    for (const status of ["complete", "completed", "running", "failed", "draft", "", null, undefined, "something_new"]) {
      for (const label of [monthlyReportStatus({ status }, staff).label, competitiveRunStatus({ status, report_data: ready }, staff).label]) {
        expect(label).not.toBe(status);
        expect(["Ready", "Running", "Scheduled", "Being redone", "Not shared"]).toContain(label);
      }
    }
  });

  it("hides a run that did not finish behind the ready run for the same period", () => {
    const rows = [
      { id: "new", client_id: "c", status: "completed", date_range_start: "2026-09-01", date_range_end: "2026-09-30" },
      { id: "old", client_id: "c", status: "failed", date_range_start: "2026-09-01", date_range_end: "2026-09-30" },
      { id: "aug", client_id: "c", status: "failed", date_range_start: "2026-08-01", date_range_end: "2026-08-31" },
    ];
    // A run that did not finish is listed for nobody: the product makes it again.
    expect(listedRuns("monthly", rows, staff).map((r) => [r.id, r.display.label])).toEqual([["new", "Ready"]]);
    expect(listedRuns("monthly", rows, client).map((r) => r.id)).toEqual(["new"]);
    const competitive = [
      { id: "r", client_id: "c", status: "complete", report_data: { ...ready, period: { start: "2026-09-01", end: "2026-09-30" } } },
      { id: "h", client_id: "c", status: "complete", report_data: { ...held, period: { start: "2026-09-01", end: "2026-09-30" } } },
    ];
    expect(listedRuns("competitive", competitive, staff).map((r) => r.id)).toEqual(["r"]);
  });

  it("shows a period held more than once by its newest held run, and says when the redos are used up", () => {
    const period = { period: { start: "2026-09-01", end: "2026-09-30" } };
    const heldRun = (id: string, created_at: string) => ({ id, client_id: "c", status: "complete", created_at, report_data: { ...held, ...period } });
    const twice = [heldRun("h1", "2026-10-07T07:15:00Z"), heldRun("h2", "2026-10-08T07:15:00Z")];
    // The day of the second run: a redo can still come.
    const soon = Date.parse("2026-10-08T12:00:00Z");
    expect(listedRuns("competitive", twice, staff, soon).map((r) => [r.id, r.display.label])).toEqual([["h2", "Being redone"]]);
    expect(listedRuns("competitive", twice, client, soon)).toEqual([]);
    const used = [...twice, heldRun("h3", "2026-10-09T07:15:00Z"), heldRun("h4", "2026-10-10T07:15:00Z")];
    expect(listedRuns("competitive", used, staff, Date.parse("2026-10-10T08:00:00Z")).map((r) => [r.id, r.display.label])).toEqual([["h4", "Not shared"]]);
  });
});

describe("a held run reads 'Being redone' only while a redo can still come", () => {
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const row = (created_at: string) => ({ status: "complete", created_at, report_data: held });

  it("reads 'Not shared' for a run made 30 days ago, and 'Being redone' for one made today", () => {
    expect(competitiveRunStatus(row(ago(30)), staff)).toMatchObject({ state: "held", label: "Not shared", hidden: false });
    expect(competitiveRunStatus(row(ago(0)), staff).label).toBe("Being redone");
  });

  it("reads 'Not shared' once a redo wait has gone by with no redo made", () => {
    const made = Date.parse("2026-10-01T07:00:00Z");
    const windowMs = HELD_REDO_MINUTES * 60000;
    const at = (ms: number) => competitiveRunStatus({ status: "complete", created_at: new Date(made).toISOString(), report_data: held }, staff, made + ms).label;
    const allowMs = REDO_LEASE_ALLOWANCE_MINUTES * 60000;
    expect(at(windowMs + allowMs - 1)).toBe("Being redone");
    expect(at(windowMs + allowMs)).toBe("Not shared");
  });

  it("reads 'Not shared' on the report page for the last allowed redo's row made today, as the list does", () => {
    const period = { period: { start: "2026-09-01", end: "2026-09-30" } };
    const now = Date.parse("2026-10-10T08:00:00Z");
    const heldRow = (id: string, created_at: string) => ({ id, client_id: "c", status: "complete", created_at, report_data: { ...held, ...period } });
    const rows = [heldRow("h1", "2026-10-07T07:15:00Z"), heldRow("h2", "2026-10-08T07:15:00Z"), heldRow("h3", "2026-10-09T07:15:00Z"), heldRow("h4", "2026-10-10T07:15:00Z")];
    // The page has one row and its period's rows; the list has them all: both count HELD_REDOS + 1 held runs.
    expect(heldRunsOfPeriod(rows[3], rows)).toBe(HELD_REDOS + 1);
    expect(competitiveRunStatus(rows[3], staff, now, heldRunsOfPeriod(rows[3], rows)).label).toBe("Not shared");
    expect(listedRuns("competitive", rows, staff, now).map((r) => [r.id, r.display.label])).toEqual([["h4", "Not shared"]]);
    // The third held run still has its redo coming.
    expect(competitiveRunStatus(rows[2], staff, Date.parse("2026-10-09T09:00:00Z"), heldRunsOfPeriod(rows[2], rows.slice(0, 3))).label).toBe("Being redone");
    // A run the page cannot count siblings for reads as the one held run it is.
    expect(heldRunsOfPeriod(rows[0], undefined)).toBe(1);
  });

  it("keeps reading 'Being redone' past a day after the run was made, while its redo is still due", () => {
    // A run that took 19 minutes ends at created_at + 19 min; the redo is queued a day after that.
    const made = Date.parse("2026-10-01T07:00:00Z");
    const run = { status: "complete", created_at: new Date(made).toISOString(), duration_minutes: 19, report_data: held };
    const at = (ms: number) => competitiveRunStatus(run, staff, made + ms).label;
    const day = HELD_REDO_MINUTES * 60000;
    expect(at(day + 5 * 60000)).toBe("Being redone");
    expect(at(day + 19 * 60000)).toBe("Being redone");
    // Past the run's end, a day, and the dispatch's own lease allowance, no redo is queued.
    expect(at(day + (19 + REDO_LEASE_ALLOWANCE_MINUTES) * 60000)).toBe("Not shared");
  });

  it("reads 'Not shared' once a newer row of the period exists", () => {
    const made = Date.parse("2026-10-01T07:00:00Z");
    const run = { status: "complete", created_at: new Date(made).toISOString(), duration_minutes: 10, report_data: held };
    expect(competitiveRunStatus(run, staff, made + 60000, 1, { newerRow: true }).label).toBe("Not shared");
  });

  it("counts every held run of the period on a row with no decision, a scheduled run with a creator included", () => {
    // Scheduled runs carry the schedule's creator (dispatch.ts), so a creator says nothing about how the run was asked for.
    const period = { period: { start: "2026-10-01", end: "2026-10-31" } };
    const heldRow = (id: string, created_at: string) => ({ id, client_id: "c", status: "complete", created_at, created_by: "u1", duration_minutes: 12, report_data: { ...held, ...period } });
    const rows = [heldRow("s1", "2026-11-04T07:00:00Z"), heldRow("s2", "2026-11-05T07:00:00Z"), heldRow("s3", "2026-11-06T07:00:00Z"), heldRow("s4", "2026-11-07T07:00:00Z")];
    expect(heldRunsOfPeriod(rows[3], rows)).toBe(HELD_REDOS + 1);
    const now = Date.parse("2026-11-07T07:20:00Z");
    expect(competitiveRunStatus(rows[3], staff, now, heldRunsOfPeriod(rows[3], rows)).label).toBe("Not shared");
    expect(listedRuns("competitive", rows, staff, now).map((r) => [r.id, r.display.label])).toEqual([["s4", "Not shared"]]);
  });

  it("reads the dispatch's decision written on the held row, whatever its age or its period's count", () => {
    const period = { period: { start: "2026-10-01", end: "2026-10-31" } };
    const decided = (id: string, created_at: string, redo: Record<string, unknown>) => ({ id, client_id: "c", status: "complete", created_at, report_data: { ...held, ...period, redo } });
    const queued = { queued: true, available_at: "2026-10-03T07:00:00Z", decided_at: "2026-10-02T07:00:00Z" };
    const none = { queued: false, decided_at: "2026-11-07T07:20:00Z" };
    // A redo the dispatch queued, long after the clock would have run out: still being redone.
    const waiting = decided("q", "2026-10-02T07:00:00Z", queued);
    expect(competitiveRunStatus(waiting, staff, Date.parse("2026-11-07T07:00:00Z")).label).toBe("Being redone");
    expect(listedRuns("competitive", [waiting], staff, Date.parse("2026-11-07T07:00:00Z")).map((r) => r.display.label)).toEqual(["Being redone"]);
    // No redo queued, minutes after the run: not shared at once.
    const done = decided("n", "2026-11-07T07:00:00Z", none);
    expect(competitiveRunStatus(done, staff, Date.parse("2026-11-07T07:21:00Z")).label).toBe("Not shared");
    expect(listedRuns("competitive", [done], staff, Date.parse("2026-11-07T07:21:00Z")).map((r) => r.display.label)).toEqual(["Not shared"]);
    // A queued redo that has been made (a newer complete row of the period) is no longer coming for this row.
    expect(competitiveRunStatus(waiting, staff, Date.parse("2026-10-03T09:00:00Z"), 1, { newerRow: true }).label).toBe("Not shared");
  });

  it("lists a single old held run as 'Not shared' for staff and shows a client nothing", () => {
    const rows = [{ id: "h", client_id: "c", ...row(ago(30)), report_data: { ...held, period: { start: "2026-09-01", end: "2026-09-30" } } }];
    expect(listedRuns("competitive", rows, staff).map((r) => [r.id, r.display.label])).toEqual([["h", "Not shared"]]);
    expect(listedRuns("competitive", rows, client)).toEqual([]);
  });
});

describe("run watch", () => {
  const start = Date.parse("2026-10-13T08:00:00Z");
  const at = (minutes: number) => start + minutes * 60000;

  it("keeps polling an active run inside the limit and stops after it", () => {
    expect(watchInterval(true, "2026-10-13T08:00:00Z", 5000, at(10))).toBe(5000);
    expect(watchInterval(true, "2026-10-13T08:00:00Z", 5000, at(WATCH_LIMIT_MINUTES - 1))).toBe(5000);
    expect(watchInterval(true, "2026-10-13T08:00:00Z", 5000, at(WATCH_LIMIT_MINUTES))).toBe(false);
    expect(watchExpired(start, at(WATCH_LIMIT_MINUTES + 30))).toBe(true);
  });

  it("does not poll a run that is no longer active", () => {
    expect(watchInterval(false, "2026-10-13T08:00:00Z", 5000, at(1))).toBe(false);
  });

  it("does not treat an unknown start time as expired", () => {
    expect(watchExpired(null, at(500))).toBe(false);
    expect(watchExpired("not a date", at(500))).toBe(false);
  });
});

describe("measuredEngagements", () => {
  it("adds up the measured likes, comments and shares", async () => {
    const { measuredEngagements } = await import("@/lib/trendEngagement");
    expect(measuredEngagements({ likes: 1200, comments: 30, shares: 4 })).toBe(1234);
    expect(measuredEngagements({ likes: "10", comments: null, shares: undefined })).toBe(10);
    expect(measuredEngagements({})).toBeNull();
    expect(measuredEngagements({ likes: "n/a" })).toBeNull();
  });
});
