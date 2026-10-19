import { describe, expect, it } from "vitest";
import { competitiveRunStatus, listedRuns, monthlyReportStatus } from "@/lib/display";
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

  it("never shows a failure: a run that did not finish is scheduled to run again, for staff only", () => {
    for (const s of ["failed", "error", "cancelled"]) {
      expect(monthlyReportStatus({ status: s }, staff)).toMatchObject({ state: "scheduled", label: "Scheduled", hidden: false });
      expect(competitiveRunStatus({ status: s, report_data: null }, staff)).toMatchObject({ state: "scheduled", label: "Scheduled" });
      expect(monthlyReportStatus({ status: s }, client).hidden).toBe(true);
    }
  });

  it("works out held from the whole row, so no screen can call a held run ready", () => {
    expect(competitiveRunStatus({ status: "complete", report_data: held }, staff)).toMatchObject({ state: "held", label: "Held back", hidden: false });
    expect(competitiveRunStatus({ status: "complete", report_data: held }, client).hidden).toBe(true);
    expect(competitiveRunStatus({ status: "running", report_data: held }, staff).label).toBe("Running");
  });

  it("never prints a raw database value", () => {
    for (const status of ["complete", "completed", "running", "failed", "draft", "", null, undefined, "something_new"]) {
      for (const label of [monthlyReportStatus({ status }, staff).label, competitiveRunStatus({ status, report_data: ready }, staff).label]) {
        expect(label).not.toBe(status);
        expect(["Ready", "Running", "Scheduled", "Held back"]).toContain(label);
      }
    }
  });

  it("hides a run that did not finish behind the ready run for the same period", () => {
    const rows = [
      { id: "new", client_id: "c", status: "completed", date_range_start: "2026-09-01", date_range_end: "2026-09-30" },
      { id: "old", client_id: "c", status: "failed", date_range_start: "2026-09-01", date_range_end: "2026-09-30" },
      { id: "aug", client_id: "c", status: "failed", date_range_start: "2026-08-01", date_range_end: "2026-08-31" },
    ];
    expect(listedRuns("monthly", rows, staff).map((r) => [r.id, r.display.label])).toEqual([["new", "Ready"], ["aug", "Scheduled"]]);
    expect(listedRuns("monthly", rows, client).map((r) => r.id)).toEqual(["new"]);
    const competitive = [
      { id: "r", client_id: "c", status: "complete", report_data: { ...ready, period: { start: "2026-09-01", end: "2026-09-30" } } },
      { id: "h", client_id: "c", status: "complete", report_data: { ...held, period: { start: "2026-09-01", end: "2026-09-30" } } },
    ];
    expect(listedRuns("competitive", competitive, staff).map((r) => r.id)).toEqual(["r"]);
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
