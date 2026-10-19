import { describe, it, expect } from "vitest";
import { addDays, canRevise, mondayOf, nextPlannableWeek, weekBoard, weekLabel, type CalendarPostRow } from "@/lib/calendarPosts";

const row = (over: Partial<CalendarPostRow>): CalendarPostRow => ({
  id: "1", client_id: "c", report_id: "r", post_date: "2026-10-14", posting_time: "9:00 AM", platform: "LinkedIn",
  format: "Carousel", pillar: null, copy: "Copy", hashtags: [], cta: null, visual_direction: null, rationale: null,
  language: null, reasons: [], source: "plan", plan_id: null, post_key: "key-1", raw: null, created_at: "2026-10-07T00:00:00Z", ...over,
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

describe("planning the next week", () => {
  const plan = (week_start: string, status: "queued" | "planning" | "ready" | "failed" = "ready") => ({ week_start, status });

  it("picks the earliest week without a plan, this week included while it has days to come", () => {
    // Monday 19 Oct: this week is planned through the cutover, the next one isn't.
    expect(nextPlannableWeek([plan("2026-10-19")], "2026-10-19")).toBe("2026-10-26");
    expect(nextPlannableWeek([], "2026-10-21")).toBe("2026-10-19");
  });

  it("skips this week on Sunday, offers a failed week again, and stops a month ahead", () => {
    expect(nextPlannableWeek([], "2026-10-25")).toBe("2026-10-26");
    expect(nextPlannableWeek([plan("2026-10-19"), plan("2026-10-26", "failed")], "2026-10-20")).toBe("2026-10-26");
    const month = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"].map((w) => plan(w));
    expect(nextPlannableWeek(month, "2026-10-20")).toBeNull();
    expect(nextPlannableWeek(month.slice(0, 4), "2026-10-20")).toBe("2026-11-16");
  });

  it("lets a ready week with days to come be revised, one revision at a time", () => {
    expect(canRevise({ status: "ready", week_start: "2026-10-19", pending_revision: null }, "2026-10-25")).toBe(true);
    expect(canRevise({ status: "ready", week_start: "2026-10-19", pending_revision: null }, "2026-10-26")).toBe(false);
    expect(canRevise({ status: "ready", week_start: "2026-10-19", pending_revision: { note: "x", at: "" } }, "2026-10-20")).toBe(false);
    expect(canRevise({ status: "planning", week_start: "2026-10-26", pending_revision: null }, "2026-10-20")).toBe(false);
    expect(canRevise(null, "2026-10-20")).toBe(false);
  });
});
