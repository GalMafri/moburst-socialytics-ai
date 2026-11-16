import { describe, expect, it } from "vitest";
import { isWholeMonth, periodWords } from "../../../functions/_shared/reports/facts";
import { previousPeriod } from "../../../functions/_shared/pipelines/social/nodes";

describe("a whole calendar month, one test for the labels and the comparison", () => {
  it("needs the first and the last day of one month of one year", () => {
    expect(isWholeMonth("2026-09-01", "2026-09-30")).toBe(true);
    expect(isWholeMonth("2024-02-01", "2024-02-29")).toBe(true);
    expect(isWholeMonth("2026-01-01", "2027-01-31")).toBe(false);
    expect(isWholeMonth("2026-09-02", "2026-09-30")).toBe(false);
    expect(isWholeMonth("2026-09-01", "2026-09-29")).toBe(false);
    expect(isWholeMonth("", "")).toBe(false);
  });

  it("names a range of 13 months and compares it as a plain range, not as January against December", () => {
    expect(periodWords({ start: "2026-01-01", end: "2027-01-31" })).toEqual({ now: "this period", before: "the period before" });
    expect(previousPeriod("2026-01-01", "2027-01-31")).toEqual({ start: "2024-12-01", end: "2025-12-31" });
    expect(periodWords({ start: "2026-09-01", end: "2026-09-30" })).toEqual({ now: "September", before: "August" });
    expect(previousPeriod("2026-09-01", "2026-09-30")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });
});
