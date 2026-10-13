import { describe, it, expect } from "vitest";
import { addDays, mondayOf, weekBoard, weekLabel, type CalendarPostRow } from "@/lib/calendarPosts";

const row = (over: Partial<CalendarPostRow>): CalendarPostRow => ({
  id: "1", client_id: "c", report_id: "r", post_date: "2026-10-14", posting_time: "9:00 AM", platform: "LinkedIn",
  format: "Carousel", pillar: null, copy: "Copy", hashtags: [], cta: null, visual_direction: null, rationale: null,
  language: null, reasons: [], source: "report", post_key: "key-1", raw: null, created_at: "2026-10-07T00:00:00Z", ...over,
});

describe("calendar weeks", () => {
  it("finds the Monday of any day", () => {
    expect(mondayOf("2026-10-14")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(addDays("2026-10-12", 7)).toBe("2026-10-19");
  });
  it("labels a week across a month end", () => {
    expect(weekLabel("2026-10-12")).toBe("Oct 12 – 18, 2026");
    expect(weekLabel("2026-09-28")).toBe("Sep 28 – Oct 4, 2026");
  });
  it("puts each post on its day with its key and date", () => {
    const board = weekBoard([row({}), row({ id: "2", post_date: "2026-10-19", post_key: "key-2" })], "2026-10-12");
    expect(board.map((d) => d.posts.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(board[2]).toMatchObject({ day: "Wednesday", date_label: "Oct 14" });
    expect(board[2].posts[0]).toMatchObject({ _calendarPostKey: "key-1", date_label: "2026-10-14", copy: "Copy" });
  });
});
