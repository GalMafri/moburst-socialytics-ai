import { describe, expect, it } from "vitest";
import { chunkWindow, localToday, presetRange, yesterdayIn } from "./dateRange";

describe("preset ranges in the client's time zone", () => {
  // 01:00 UTC on Nov 12 is still the evening of Nov 11 in New York.
  const now = new Date("2026-11-12T01:00:00Z");

  it("ends on the client's yesterday, not the UTC one", () => {
    expect(localToday("America/New_York", now)).toBe("2026-11-11");
    expect(yesterdayIn("America/New_York", now)).toBe("2026-11-10");
    expect(presetRange("7d", now, "America/New_York")).toEqual({ start: "2026-11-04", end: "2026-11-10" });
    // Without a zone the days are UTC days, as before.
    expect(presetRange("7d", now)).toEqual({ start: "2026-11-05", end: "2026-11-11" });
  });

  it("takes the previous month from the client's own calendar", () => {
    const early = new Date("2026-12-01T02:00:00Z"); // Nov 30 in New York
    expect(presetRange("previous_month", early, "America/New_York")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(presetRange("previous_month", early)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });

  it("falls back to UTC for a zone it does not know", () => {
    expect(localToday("Not/AZone", now)).toBe("2026-11-12");
  });
});

describe("chunkWindow", () => {
  it("keeps a window of a year or less whole and splits a longer one into contiguous year-sized pieces", () => {
    expect(chunkWindow({ start: "2026-01-01", end: "2026-01-31" })).toEqual([{ start: "2026-01-01", end: "2026-01-31" }]);
    const parts = chunkWindow({ start: "2025-01-01", end: "2026-02-04" });
    expect(parts).toHaveLength(2);
    expect(parts[0].start).toBe("2025-01-01");
    expect(parts[1].end).toBe("2026-02-04");
    const next = new Date(`${parts[0].end}T00:00:00Z`).getTime() + 86400000;
    expect(new Date(`${parts[1].start}T00:00:00Z`).getTime()).toBe(next);
  });
});
