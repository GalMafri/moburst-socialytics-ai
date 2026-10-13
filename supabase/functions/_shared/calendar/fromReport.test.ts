import { describe, it, expect } from "vitest";
import { nextMonday, postsFromReport, weekStart } from "./fromReport";
import { calendarWithRevisions } from "../../../../src/lib/calendarRevision";

const report = {
  id: "c98e94f1-cc0f-4ede-8287-23a78b50d925",
  client_id: "client-1",
  created_at: "2026-10-07T07:28:01Z",
  report_data: {
    content_calendar: [
      { day: "Monday", date_label: "Week of Oct 12, 2026", posts: [{ platform: "LinkedIn", format: "Carousel", copy: "language: en\nMost teams measure AI visibility wrong.", hashtags: ["#AEO"], CTA: "Read the brief" }] },
      { day: "Wednesday", date_label: "Week of Oct 12, 2026", posts: [{ platform: "Instagram", caption_angle: "A quieter angle" }, { platform: "TikTok", copy: "Hook first" }] },
    ],
  },
};

describe("weekStart", () => {
  it("reads every label form the reports use", () => {
    expect(weekStart("Week of Oct 12, 2026", "2026-10-07T00:00:00Z")).toBe("2026-10-12");
    expect(weekStart("Week of 2026-10-12", "2026-10-07T00:00:00Z")).toBe("2026-10-12");
    expect(weekStart("Week of July 13, 2026", "2026-07-09T00:00:00Z")).toBe("2026-07-13");
    expect(weekStart("Week of Oct 12", "2026-10-07T00:00:00Z")).toBe("2026-10-12");
  });
  it("puts a yearless January label after a December report", () => {
    expect(weekStart("Week of Jan 4", "2026-12-28T00:00:00Z")).toBe("2027-01-04");
  });
  it("returns null for a label without a date", () => {
    expect(weekStart("This week", "2026-10-07T00:00:00Z")).toBeNull();
    expect(nextMonday("2026-10-07T07:00:00Z")).toBe("2026-10-12");
  });
});

describe("postsFromReport", () => {
  const rows = postsFromReport(report);
  it("dates each post by its week and day", () => {
    expect(rows.map((r) => [r.platform, r.post_date])).toEqual([["LinkedIn", "2026-10-12"], ["Instagram", "2026-10-14"], ["TikTok", "2026-10-14"]]);
    expect(rows[0]).toMatchObject({ copy: "Most teams measure AI visibility wrong.", cta: "Read the brief", hashtags: ["#AEO"] });
  });
  it("keys each post exactly as the report's board does, so its edits and designs stay attached", () => {
    const board = calendarWithRevisions(report.report_data.content_calendar as never, report.id, []).flatMap((d) => d.posts);
    expect(rows.map((r) => r.post_key)).toEqual(board.map((p) => p._calendarPostKey));
  });
});
