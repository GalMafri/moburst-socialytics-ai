// @vitest-environment node
// The version 2 fields of a strategy (spec: docs/superpowers/specs/2026-11-03-
// strategy-v2-design.md, section 2) and how a 2 Nov section or edit keeps its
// place: every key a 2 Nov strategy or person wrote has a card on the new page,
// and a 2 Nov text edit reads as itself.
import { describe, expect, it } from "vitest";
import { dayWords, editShown, placeOf, sectionLines, targetLine } from "./sections";
import { FIXED_SECTIONS } from "./write";
import { pillarSectionKey, platformSectionKey } from "./platforms";

describe("people's 2 Nov versions keep their place", () => {
  it("maps every 2 Nov section key to a card on the new page, measures included", () => {
    const v1 = ["goals", "audience", "positioning", "avoid", "measures", "not_now", pillarSectionKey("Beer League Truths"), platformSectionKey("Instagram", "posting"), platformSectionKey("TikTok", "new")];
    expect(v1.map((k) => [k, placeOf(k)])).toEqual([
      ["goals", "plan"], ["audience", "audience"], ["positioning", "audience"], ["avoid", "avoid"], ["measures", "start"], ["not_now", "platforms"],
      ["pillar:Beer League Truths", "pillars"], ["platform:instagram:posting", "platforms"], ["platform:tiktok:new", "platforms"],
    ]);
    for (const k of FIXED_SECTIONS) expect(placeOf(k)).not.toBeNull();
    expect(placeOf("notes")).toBeNull();
  });

  it("reads a 2 Nov text edit as its own text, and a v2 edit by its fields", () => {
    expect(editShown({ text: " Captains and co-captains. ", value: null })).toBe("Captains and co-captains.");
    expect(editShown({ text: "x", value: { who: "Captains" } })).toEqual({ who: "Captains" });
    expect(sectionLines("audience", "Captains and co-captains.")).toBe("Captains and co-captains.");
  });
});

describe("a section as plain lines", () => {
  it("writes each section's fields as short lines", () => {
    expect(sectionLines("goals", { items: [{ title: "Grow saves", why: "Checklists bring captains back.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 42, by: "2027-02-01" }] }))
      .toBe("- Grow saves (Instagram median engagement per post: 42 today, above it by 1 Feb 2027). Why: Checklists bring captains back.");
    expect(sectionLines("audience", { who: "Rec league captains.", wants: ["Less chasing", "Fair splits", "Time back"], where: ["Instagram", "TikTok"] }))
      .toBe("Rec league captains.\nWants:\n- Less chasing\n- Fair splits\n- Time back\nWhere: Instagram, TikTok");
    expect(sectionLines("positioning", { statement: "Built for the captain.", points: [{ vs: "BenchApp", point: "Payments in the same place." }] }))
      .toBe("Built for the captain.\n- vs BenchApp: Payments in the same place.");
    expect(sectionLines("pillar:X", { purpose: "Make captains laugh.", formats: ["carousel"], planned_share: 40, ideas: [{ hook: "Lo que nadie dice", format: "reel" }] }))
      .toBe("Make captains laugh.\nFormats: carousel\nPlanned share: 40%\n- Idea (reel): Lo que nadie dice");
    expect(sectionLines("platform:tiktok:new", { role: "Reach new captains.", post: ["a", "b", "c"], worked: [], first_30: ["w1", "w2", "w3", "w4"], checks: { day_30: "Views", day_90: "Follows" } }))
      .toContain("First 30 days:\n- Week 1: w1");
    expect(sectionLines("avoid", { items: [{ pattern: "Office photos", source: "posts" }] })).toBe("- Office photos");
    expect(sectionLines("not_now", { items: [{ platform: "YouTube", reason: "Long video is costly." }] })).toBe("YouTube: Long video is costly.");
  });

  it("states a goal's figure today and its date in words", () => {
    expect(targetLine({ platform: "TikTok", metric: "engagement_rate", direction: "above", baseline: 0.0312, by: "2027-02-01" })).toBe("TikTok engagement rate: 3.1% today, above it by 1 Feb 2027");
    expect(targetLine({ platform: "LinkedIn", metric: "followers", direction: "above", baseline: 12400, by: "2027-02-01" })).toBe("LinkedIn followers: 12,400 today, above it by 1 Feb 2027");
    expect(targetLine({ platform: "TikTok", metric: "posts_per_week", direction: "above", baseline: null, by: "2027-02-01" })).toBe("TikTok posts a week: above today's by 1 Feb 2027");
    expect(dayWords("2026-11-03")).toBe("3 Nov 2026");
  });
});
