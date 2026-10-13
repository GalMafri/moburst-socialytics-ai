import { describe, it, expect } from "vitest";
import { parseWeek, weekDates, weekPrompt, type PlanContext } from "./planner";

const ctx: PlanContext = {
  brand: "Moburst", voice: "Confident, expert", pillars: [{ name: "Thought leadership" }], market: ["US"], languages: ["English"],
  findings: { performance: ["LinkedIn carousels drive most clicks"], trends: ["Short expert explainers"], competitors: ["Competitors post 4.5 times a week"] },
  pattern: [{ weekday: "Monday", platform: "LinkedIn", format: "Carousel", posting_time: "9:00 AM" }],
  nearby: [{ date: "2026-10-12", platform: "LinkedIn", copy: "Most teams measure AI visibility wrong." }],
};

describe("week planning", () => {
  it("lists the week's dates from its Monday", () => {
    expect(weekDates("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });
  it("gives the planner the findings, the pattern and what not to repeat", () => {
    const p = weekPrompt(ctx, "2026-10-19");
    expect(p).toContain("LinkedIn carousels drive most clicks");
    expect(p).toContain("- Monday: LinkedIn Carousel at 9:00 AM");
    expect(p).toContain("Most teams measure AI visibility wrong.");
    expect(p).toContain("2026-10-19 (Monday) to 2026-10-25 (Sunday)");
  });
  it("keeps posts in the week with their reasons, and trend slots without copy", () => {
    const text = JSON.stringify({ posts: [
      { date: "2026-10-19", platform: "LinkedIn", format: "Carousel", copy: "Copy", reason: { type: "competitor", label: "Competitors post more" } },
      { date: "2026-10-21", platform: "LinkedIn", format: "Single Image", trend_slot: true },
      { date: "2026-10-30", platform: "LinkedIn", copy: "Outside the week" },
      { date: "2026-10-20", platform: "Instagram", copy: "" },
      { date: "2026-10-22", platform: "Facebook", copy: "No reason given" },
    ] });
    const posts = parseWeek(text, "2026-10-19", "report-1");
    expect(posts.map((p) => [p.post_date, p.source])).toEqual([["2026-10-19", "report"], ["2026-10-21", "trend_slot"], ["2026-10-22", "report"]]);
    expect(posts[0].reasons).toEqual([{ type: "competitor", label: "Competitors post more", report_id: "report-1" }]);
    expect(posts[1]).toMatchObject({ copy: "", reasons: [{ type: "trend" }] });
    expect(posts[2].reasons[0]).toMatchObject({ type: "performance", label: "Planned from the monthly report" });
  });
});
