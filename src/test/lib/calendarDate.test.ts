import { describe, expect, it } from "vitest";
import { byPostingTime, postingMinutes, postingTimeText, timeInputOf } from "@/lib/calendarDate";

describe("posting times", () => {
  it("shows 18:45 and 6:45 PM in one form, with the client's zone name", () => {
    expect(postingTimeText("18:45", "America/New_York", "2026-11-10")).toBe("6:45 PM EST");
    expect(postingTimeText("6:45 PM", "America/New_York", "2026-11-10")).toBe("6:45 PM EST");
    expect(postingTimeText("18:45", "America/New_York", "2026-07-10")).toBe("6:45 PM EDT");
    expect(postingTimeText("00:05")).toBe("12:05 AM");
    expect(postingTimeText("12:00", "Not/AZone")).toBe("12:00 PM");
    expect(postingTimeText(null, "UTC")).toBe("");
  });

  it("sorts 6:00 PM before 10:00 PM, whichever form each is stored in", () => {
    expect(postingMinutes("6:00 PM")).toBe(1080);
    expect(postingMinutes("22:00")).toBe(1320);
    expect(["10:00 PM", "6:00 PM", null, "9:30 AM"].sort(byPostingTime)).toEqual(["9:30 AM", "6:00 PM", "10:00 PM", null]);
  });

  it("still reads a time input's value", () => {
    expect(timeInputOf("6:45pm EST")).toBe("18:45");
    expect(timeInputOf("soon")).toBe("");
  });
});
