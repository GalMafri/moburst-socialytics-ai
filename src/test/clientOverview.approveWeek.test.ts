// P13: the Dashboard's "not approved yet" action counts posts of next week (Sat/Sun) but links to this week.
import { describe, expect, it } from "vitest";
import { actionItems, contentWeek, type WeekPost } from "@/lib/clientOverview";
import { thisWeek } from "@/lib/weekWindow";

describe("P13 overview approve link", () => {
  it("links to the week where the unapproved posts are", () => {
    const week = thisWeek("UTC", new Date("2026-11-21T10:00:00Z")); // Saturday; this week is Nov 16 to 22
    const post: WeekPost = { id: "1", post_key: "k1", post_date: "2026-11-23", platform: "Instagram", source: "plan", copy: "Monday post" };
    const content = contentWeek([post], [], week);
    expect(content.unapprovedSoon).toHaveLength(1); // counted in "going out in the next three days"
    const approve = actionItems({ clientId: "c", isStaff: true, week, content, openTopics: 0, endorsedTests: 0 }).find((a) => a.key === "approve")!;
    expect(approve.href).toContain("week=2026-11-23");
  });
});
