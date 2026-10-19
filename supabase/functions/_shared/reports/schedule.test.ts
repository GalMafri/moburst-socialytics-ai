import { describe, it, expect } from "vitest";
import { closeAbandonedRuns, currentMonthRange, firstRunFrom, nextRun, previousMonthRange, rangeForSchedule } from "./schedule";

describe("schedule arithmetic", () => {
  const oct7 = new Date("2026-10-07T07:15:00Z");
  it("covers the whole previous calendar month", () => {
    expect(previousMonthRange(oct7)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(previousMonthRange(new Date("2026-01-07T07:15:00Z"))).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });
  it("covers this month to date", () => {
    expect(currentMonthRange(oct7)).toEqual({ start: "2026-10-01", end: "2026-10-07" });
  });
  it("picks the range by mode", () => {
    expect(rangeForSchedule("previous_month", oct7).start).toBe("2026-09-01");
    expect(rangeForSchedule("month_to_date", oct7).start).toBe("2026-10-01");
  });
  it("moves a monthly schedule to its run day next month at 07:15 UTC", () => {
    expect(nextRun(oct7, 7, "monthly")).toBe("2026-11-07T07:15:00.000Z");
    expect(nextRun(oct7, null, "monthly")).toBe("2026-11-07T07:15:00.000Z");
    expect(nextRun(oct7, 31, "monthly")).toBe("2026-11-28T07:15:00.000Z");
    expect(nextRun(new Date("2026-12-07T07:15:00Z"), 7, "monthly")).toBe("2027-01-07T07:15:00.000Z");
  });
  it("starts a schedule again on its next run day, this month when it is still ahead", () => {
    // The same answers as public.report_schedule_first_run, checked against the database on 19 Oct.
    expect(firstRunFrom(new Date("2026-10-19T12:00:00Z"), 7, "monthly")).toBe("2026-11-07T07:15:00.000Z");
    expect(firstRunFrom(new Date("2026-10-03T00:00:00Z"), 7, "monthly")).toBe("2026-10-07T07:15:00.000Z");
    expect(firstRunFrom(oct7, 7, "monthly")).toBe("2026-11-07T07:15:00.000Z");
    expect(firstRunFrom(new Date("2026-12-20T00:00:00Z"), 31, "monthly")).toBe("2026-12-28T07:15:00.000Z");
    expect(firstRunFrom(new Date("2026-10-19T12:00:00Z"), null, "weekly")).toBe("2026-10-26T12:00:00.000Z");
  });
  it("moves weekly and biweekly schedules by seven and fourteen days", () => {
    expect(nextRun(oct7, 7, "weekly")).toBe("2026-10-14T07:15:00.000Z");
    expect(nextRun(oct7, 7, "biweekly")).toBe("2026-10-21T07:15:00.000Z");
  });
});

describe("closeAbandonedRuns", () => {
  /** A query builder that records each call and answers selects from fixed rows. */
  function fakeDb(rows: Record<string, Array<Record<string, unknown>>>) {
    const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
    const from = (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        in: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        lt: () => q,
        limit: () => q,
        then: (resolve: (r: { data: unknown }) => unknown) => {
          if (patch) { updates.push({ table, patch, filters }); return resolve({ data: null }); }
          const status = filters.find(([c]) => c === "status")?.[1];
          return resolve({ data: (rows[table] ?? []).filter((r) => status === undefined || Array.isArray(status) || r.status === status) });
        },
      };
      return q;
    };
    return { db: { from } as never, updates };
  }

  it("closes a run that stopped answering, in plain words, and leaves a scheduled run to its dispatch job", async () => {
    const { db, updates } = fakeDb({
      reports: [{ id: "manual", status: "running" }, { id: "scheduled", status: "running" }],
      competitive_reports: [],
      scheduled_jobs: [{ report_id: "scheduled" }],
    });
    const closed = await closeAbandonedRuns(db, new Date("2026-10-07T12:00:00Z"), false);
    expect(closed).toEqual([{ table: "reports", id: "manual" }]);
    expect(updates).toHaveLength(1);
    const error = String((updates[0].patch.report_data as { error: string }).error);
    expect(error).toBe("The run stopped before it finished, so it was closed.");
    expect(error).not.toMatch(/n8n|run it again|retry/i);
  });
});
