import { describe, it, expect } from "vitest";
import { currentMonthRange, nextRun, previousMonthRange, rangeForSchedule } from "./schedule";

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
  it("moves weekly and biweekly schedules by seven and fourteen days", () => {
    expect(nextRun(oct7, 7, "weekly")).toBe("2026-10-14T07:15:00.000Z");
    expect(nextRun(oct7, 7, "biweekly")).toBe("2026-10-21T07:15:00.000Z");
  });
});
