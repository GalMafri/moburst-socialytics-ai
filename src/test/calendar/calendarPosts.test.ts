import { describe, it, expect } from "vitest";
import { addDays, canRemove, canRevise, canStop, mergePlan, mondayOf, nextPlannableWeek, weekBoard, weekLabel, type CalendarPlanRow, type CalendarPostRow } from "@/lib/calendarPosts";
import { rateWords, sourceWords } from "@/lib/postingRhythm";

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
  it("puts a Story right after the post it was made from, and links them", () => {
    const feed = row({ id: "f", post_key: "post:f", platform: "Instagram", format: "Single image", posting_time: "9:00 AM", created_at: "2026-10-07T00:00:00Z" });
    const other = row({ id: "o", post_key: "post:o", platform: "LinkedIn", posting_time: "9:00 AM", created_at: "2026-10-08T00:00:00Z" });
    const later = row({ id: "l", post_key: "post:l", platform: "Facebook", posting_time: "9:30 PM", created_at: "2026-10-07T00:00:00Z" });
    // Made after the LinkedIn post, at the same time as its Instagram post.
    const story = row({ id: "s", post_key: "post:s", platform: "Instagram", format: "Story", posting_time: "9:00 AM", story_of: "post:f", created_at: "2026-10-09T00:00:00Z" });
    const posts = weekBoard([later, story, other, feed], "2026-10-12")[2].posts;
    expect(posts.map((p) => p._calendarPostKey)).toEqual(["post:f", "post:s", "post:o", "post:l"]);
    expect(posts[1]).toMatchObject({ _storyOf: "post:f", format: "Story" });
    // A Story whose post is on another day, or gone, keeps its own place.
    const alone = weekBoard([later, row({ ...story, story_of: "post:gone" })], "2026-10-12")[2].posts;
    expect(alone.map((p) => p._calendarPostKey)).toEqual(["post:s", "post:l"]);
  });

  it("words each card's reason now, from its stored parts", () => {
    const reasons = [{ type: "seasonal", label: "Old words", moment: "Halloween on Oct 31", test: false }, { type: "idea", label: "Added by the team" }];
    const [post] = weekBoard([row({ reasons })], "2026-10-12")[2].posts as Array<{ _reasons: Array<{ label: string }> }>;
    expect(post._reasons.map((r) => r.label)).toEqual(["Halloween on Oct 31.", "Added by the team"]);
  });
});

describe("the posting rhythm on screen", () => {
  it("says how often and where the number came from", () => {
    expect(rateWords(3.2)).toBe("3 a week");
    expect(rateWords(21.9)).toBe("7 a week");
    expect(rateWords(0.25)).toBe("1 every 4 weeks");
    expect(rateWords(0.5)).toBe("1 every 2 weeks");
    expect(rateWords(0.9)).toBe("1 a week");
    expect(sourceWords("published_8w")).toBe("From its posts in the last 8 weeks");
    expect(sourceWords("published")).toBe("From its posts in the last 8 weeks");
    expect(sourceWords("published_90d")).toBe("From its posts in the last 90 days");
    expect(sourceWords("competitors")).toBe("From its competitors");
    expect(sourceWords("all_tracked")).toBe("From companies the app tracks");
  });
});

describe("planning the next week", () => {
  const plan = (week_start: string, status: CalendarPlanRow["status"] = "ready") => ({ week_start, status });

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

  it("offers a week again once a person stopped its planning or removed its plan", () => {
    // Lital pressed "Plan next week" for the week of Nov 9 by accident and stopped it.
    expect(nextPlannableWeek([plan("2026-11-02"), plan("2026-11-09", "canceled"), plan("2026-11-16", "queued")], "2026-11-03")).toBe("2026-11-09");
    expect(nextPlannableWeek([plan("2026-11-02"), plan("2026-11-09", "planning")], "2026-11-03")).toBe("2026-11-16");
  });

  it("lets planning be stopped while the plan is queued or being written", () => {
    expect(canStop({ status: "queued" })).toBe(true);
    expect(canStop({ status: "planning" })).toBe(true);
    expect(canStop({ status: "ready" })).toBe(false);
    expect(canStop({ status: "canceled" })).toBe(false);
    expect(canStop(null)).toBe(false);
  });

  it("lets a finished plan be removed while its week has days to come and no revision is running", () => {
    expect(canRemove({ status: "ready", week_start: "2026-11-09", pending_revision: null }, "2026-11-03")).toBe(true);
    expect(canRemove({ status: "ready", week_start: "2026-11-02", pending_revision: null }, "2026-11-08")).toBe(true);
    expect(canRemove({ status: "ready", week_start: "2026-11-02", pending_revision: null }, "2026-11-09")).toBe(false);
    expect(canRemove({ status: "ready", week_start: "2026-11-09", pending_revision: { note: "x", at: "" } }, "2026-11-03")).toBe(false);
    expect(canRemove({ status: "planning", week_start: "2026-11-09", pending_revision: null }, "2026-11-03")).toBe(false);
    expect(canRemove(null, "2026-11-03")).toBe(false);
  });

  it("puts the plan the server answered with in place of the one the screen had, in week order", () => {
    const row = (id: string, week_start: string, status: CalendarPlanRow["status"]) => ({ id, client_id: "c", week_start, status, trigger: "button", error: null, pending_revision: null, revisions: [], ready_at: null, created_at: "" }) as CalendarPlanRow;
    const before = [row("a", "2026-11-02", "ready"), row("c", "2026-11-16", "ready")];
    expect(mergePlan(before, row("b", "2026-11-09", "queued")).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(mergePlan([...before, row("b", "2026-11-09", "queued")], row("b", "2026-11-09", "canceled")).find((p) => p.id === "b")?.status).toBe("canceled");
    expect(mergePlan(undefined, row("b", "2026-11-09", "queued"))).toHaveLength(1);
    expect(mergePlan(before, null)).toBe(before);
  });

  it("lets a ready week with days to come be revised, one revision at a time", () => {
    expect(canRevise({ status: "ready", week_start: "2026-10-19", pending_revision: null }, "2026-10-25")).toBe(true);
    expect(canRevise({ status: "ready", week_start: "2026-10-19", pending_revision: null }, "2026-10-26")).toBe(false);
    expect(canRevise({ status: "ready", week_start: "2026-10-19", pending_revision: { note: "x", at: "" } }, "2026-10-20")).toBe(false);
    expect(canRevise({ status: "planning", week_start: "2026-10-26", pending_revision: null }, "2026-10-20")).toBe(false);
    expect(canRevise(null, "2026-10-20")).toBe(false);
  });
});
