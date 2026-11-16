import { describe, expect, it } from "vitest";
import { competitiveRangeError, socialRangeError } from "../../../functions/_shared/reports/competitiveRange.ts";

// 22:30 UTC on 12 Nov 2026 is already 13 Nov in Israel and still 12 Nov in New York.
const now = new Date("2026-11-12T22:30:00Z");

describe("the range a monthly report may be asked for", () => {
  it.each([
    ["start after end", "2026-11-10", "2026-11-01"],
    ["an end in the future", "2026-11-01", "2026-11-14"],
    ["a day that does not exist", "2026-02-30", "2026-03-02"],
    ["a missing end", "2026-11-01", ""],
    ["a span over a year", "2025-01-01", "2026-11-01"],
  ])("rejects %s", (_name, start, end) => {
    expect(socialRangeError({ start, end }, "America/New_York", now)).toBeTruthy();
  });

  it.each([
    ["a whole past month", "2026-10-01", "2026-10-31"],
    ["a single day", "2026-11-05", "2026-11-05"],
    ["the month so far, ending on the client's today", "2026-11-01", "2026-11-12"],
  ])("accepts %s", (_name, start, end) => {
    expect(socialRangeError({ start, end }, "America/New_York", now)).toBeNull();
  });

  it("reads today in the client's own zone", () => {
    expect(socialRangeError({ start: "2026-11-01", end: "2026-11-13" }, "Asia/Jerusalem", now)).toBeNull();
    expect(socialRangeError({ start: "2026-11-01", end: "2026-11-13" }, "America/New_York", now)).toBeTruthy();
  });

  it("falls back to UTC for a zone it does not know", () => {
    expect(socialRangeError({ start: "2026-11-01", end: "2026-11-12" }, "Nowhere/Land", now)).toBeNull();
    expect(socialRangeError({ start: "2026-11-01", end: "2026-11-13" }, null, now)).toBeTruthy();
  });

  it("keeps the competitive rule as it was", () => {
    expect(competitiveRangeError({ start: "2026-11-01", end: "2026-11-12" }, now)).toBeTruthy();
    expect(competitiveRangeError({ start: "2026-11-01", end: "2026-11-11" }, now)).toBeNull();
  });
});
