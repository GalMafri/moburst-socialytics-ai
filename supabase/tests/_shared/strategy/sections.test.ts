// @vitest-environment node
// The version 2 fields of a strategy (spec: docs/superpowers/specs/2026-11-03-
// strategy-v2-design.md, section 2) and how a 2 Nov section or edit keeps its
// place: every key a 2 Nov strategy or person wrote has a card on the new page,
// and a 2 Nov text edit reads as itself.
import { describe, expect, it } from "vitest";
import { avoidSourceWords, dayWords, editShown, orphanedGoals, placeOf, sectionLines, targetLine, typedPart, withLatestSection } from "../../../functions/_shared/strategy/sections";
import { FIXED_SECTIONS } from "../../../functions/_shared/strategy/write";
import { pillarSectionKey, platformSectionKey } from "../../../functions/_shared/strategy/platforms";

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
    expect(editShown("audience", { text: " Captains and co-captains. ", value: null })).toBe("Captains and co-captains.");
    expect(editShown("audience", { text: "x", value: { who: "Captains" } })).toEqual({ who: "Captains" });
    expect(sectionLines("audience", "Captains and co-captains.")).toBe("Captains and co-captains.");
  });
});

const latestGoal = (platform: string, metric: string, over: Record<string, unknown> = {}) => ({ title: `Latest ${platform} ${metric}`, why: "Latest why.", platform, metric, direction: "above", baseline: 61, by: "2027-05-01", ...over });

describe("a person's words over the latest write", () => {
  it("lays a goal's typed words over the latest goal it was written against, whatever order the latest write is in", () => {
    // Written against LinkedIn followers; the latest write lists Instagram first and LinkedIn second.
    const edited = { items: [{ title: "My LinkedIn goal", why: "Mine.", platform: "LinkedIn", metric: "followers", direction: "above" }] };
    const latest = { items: [latestGoal("Instagram", "median_engagement"), latestGoal("LinkedIn", "followers", { baseline: 900 })] };
    expect(withLatestSection("goals", latest, edited)).toEqual({ items: [latest.items[0], { ...latest.items[1], title: "My LinkedIn goal", why: "Mine." }] });
    expect(editShown("goals", { text: "x", value: edited }, latest)).toEqual(withLatestSection("goals", latest, edited));
  });

  it("matches the nth of repeated goals to the nth, and shows the latest goal where the person wrote none", () => {
    const l = (n: number) => latestGoal("LinkedIn", "followers", { title: `Latest ${n}`, baseline: n });
    const latest = { items: [l(1), l(2), latestGoal("YouTube", "posts_per_week")] };
    const edited = { items: [{ title: "Mine 1", why: "w", platform: "LinkedIn", metric: "followers", direction: "above" }] };
    expect(withLatestSection("goals", latest, edited)).toEqual({ items: [{ ...l(1), title: "Mine 1", why: "w" }, l(2), latest.items[2]] });
  });

  it("never lays a goal over an unrelated one: it is left out of the card and kept for the sheet", () => {
    const latest = { items: [latestGoal("Instagram", "median_engagement")] };
    const edited = { items: [{ title: "Old TikTok goal", why: "Mine.", platform: "TikTok", metric: "followers", direction: "above" }, { title: "No identity", why: "x" }] };
    expect(withLatestSection("goals", latest, edited)).toEqual(latest);
    expect(orphanedGoals(latest, edited)).toEqual([{ title: "Old TikTok goal", why: "Mine." }, { title: "No identity", why: "x" }]);
    expect(orphanedGoals(latest, { items: [{ title: "T", why: "", platform: "Instagram", metric: "median_engagement", direction: "above" }] })).toEqual([]);
  });

  it("keeps a platform's typed words over the latest worked posts, and shows other cards and text as saved", () => {
    const old = { role: "Mine.", post: ["a"], worked: [{ text: "old" }], checks: { day_30: "x", day_90: "y" } };
    const now = { role: "Theirs.", post: ["b"], worked: [{ text: "new" }], checks: { day_30: "p", day_90: "q" } };
    expect(withLatestSection("platform:instagram:posting", now, old)).toEqual({ ...old, worked: [{ text: "new" }] });
    expect(withLatestSection("audience", { who: "A" }, { who: "B" })).toEqual({ who: "B" });
    expect(withLatestSection("goals", { items: [] }, "- text")).toBe("- text");
    expect(withLatestSection("goals", null, { items: [] })).toEqual({ items: [] });
  });

  it("prints a target line only for a goal that has its date", () => {
    expect(sectionLines("goals", { items: [{ title: "Grow", why: "Because.", platform: "Instagram", metric: "followers", direction: "above" }] })).toBe("- Grow. Why: Because.");
  });
});

describe("a section as plain lines", () => {
  it("writes each section's fields as short lines", () => {
    expect(sectionLines("goals", { items: [{ title: "Grow saves", why: "Checklists bring captains back.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 42, by: "2027-02-01" }] }))
      .toBe("- Grow saves (Instagram median engagement per post: 42 today, above it by Feb 1, 2027). Why: Checklists bring captains back.");
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
    expect(targetLine({ platform: "TikTok", metric: "engagement_rate", direction: "above", baseline: 0.0312, by: "2027-02-01" })).toBe("TikTok engagement rate: 3.1% today, above it by Feb 1, 2027");
    expect(targetLine({ platform: "LinkedIn", metric: "followers", direction: "above", baseline: 12400, by: "2027-02-01" })).toBe("LinkedIn followers: 12,400 today, above it by Feb 1, 2027");
    expect(targetLine({ platform: "TikTok", metric: "posts_per_week", direction: "above", baseline: null, by: "2027-02-01" })).toBe("TikTok posts a week: above today's by Feb 1, 2027");
    expect(dayWords("2026-11-03")).toBe("Nov 3, 2026");
  });

  it("writes every date in one style, the one the page uses elsewhere: month, day, year", () => {
    expect(dayWords("2027-02-09")).toBe("Feb 9, 2027");
    expect(dayWords("2026-11-08")).toBe("Nov 8, 2026");
    expect(dayWords("2026-11-08", { year: false })).toBe("Nov 8");
    expect(dayWords("")).toBe("");
    expect(dayWords("not a date")).toBe("");
  });

  it("names where an avoid pattern came from in plain words", () => {
    expect(avoidSourceWords("posts")).toBe("Our posts");
    expect(avoidSourceWords("trend_profile")).toBe("Industry trends");
    expect(avoidSourceWords("brief")).toBe("Brief");
    expect(avoidSourceWords("team")).toBe("Team");
    expect(avoidSourceWords("anything else")).toBe("Team");
  });
});

describe("what a person typed in a card (typedPart)", () => {
  it("keeps a goal's words and what it was written against, and a platform's text fields, without numbers, dates or worked posts", () => {
    const goals = { items: [{ title: " Grow ", why: "Because.", platform: "Instagram", metric: "followers", direction: "above", baseline: 900, by: "2027-02-01" }] };
    expect(typedPart("goals", goals)).toEqual({ items: [{ title: "Grow", why: "Because.", platform: "Instagram", metric: "followers", direction: "above" }] });
    const platform = { role: "Home.", post: ["a"], worked: [{ text: "w" }], first_30: ["1", "2"], checks: { day_30: "x", day_90: "y" } };
    expect(typedPart("platform:tiktok:new", platform)).toEqual({ role: "Home.", post: ["a"], first_30: ["1", "2"], checks: { day_30: "x", day_90: "y" } });
    expect(typedPart("platform:instagram:posting", { role: "R", worked: [] })).toEqual({ role: "R" });
    const audience = { who: "W", wants: ["a"], where: ["Instagram"] };
    expect(typedPart("audience", audience)).toBe(audience);
    expect(typedPart("goals", "2 Nov text")).toBe("2 Nov text");
  });

  it("is what withLatestSection lays over the latest write, so an edit stored with old figures reads the new ones", () => {
    const old = { role: "Mine.", post: ["a"], worked: [{ text: "old" }], checks: { day_30: "x", day_90: "y" } };
    const latest = { role: "Theirs.", post: ["b"], worked: [{ text: "new" }], checks: { day_30: "p", day_90: "q" } };
    expect(withLatestSection("platform:instagram:posting", latest, old)).toEqual({ ...latest, ...typedPart("platform:instagram:posting", old) });
  });
});
