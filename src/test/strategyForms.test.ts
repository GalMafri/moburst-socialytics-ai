// A strategy card's fields in the edit sheet and back: what the sheet does not
// show (a goal's metric and figure, a pillar idea's format, the posts that
// worked, an unchanged pattern's source) is kept from the version started from.
import { describe, expect, it } from "vitest";
import { fieldsOf, fromForm, overCap, toForm } from "@/lib/strategyForms";

describe("the edit sheet's fields", () => {
  it("round-trips every card kind, keeping what the sheet does not show", () => {
    const goals = { items: [{ title: "Grow", why: "Because.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 42, by: "2027-02-01" }] };
    const g = toForm("goals", goals);
    expect(fromForm("goals", { ...g, goal_0_title: "Grow more" }, goals)).toEqual({ items: [{ ...goals.items[0], title: "Grow more" }] });

    const pillar = { purpose: "Laugh.", formats: ["carousel"], planned_share: 60, ideas: [{ hook: "A", format: "reel" }, { hook: "B", format: "carousel" }] };
    expect(fromForm("pillar:X", { ...toForm("pillar:X", pillar), planned_share: "55" }, pillar)).toEqual({ ...pillar, planned_share: 55 });

    const platform = { role: "Home.", post: ["a", "b", "c"], worked: [{ date: "2026-10-05", multiple: 2.7, metric: "impressions", link: null, text: "t", format: "carousel" }], first_30: ["1", "2", "3", "4"], checks: { day_30: "x", day_90: "y" } };
    expect(fromForm("platform:tiktok:new", toForm("platform:tiktok:new", platform), platform)).toEqual(platform);
    expect(fieldsOf("platform:instagram:posting", { ...platform, first_30: undefined }).map((f) => f.name)).toEqual(["role", "post", "day_30", "day_90"]);

    const avoid = { items: [{ pattern: "Office photos", source: "posts" }] };
    expect(fromForm("avoid", { patterns: "Office photos\nMemes about other apps" }, avoid)).toEqual({ items: [{ pattern: "Office photos", source: "posts" }, { pattern: "Memes about other apps", source: "team" }] });

    const positioning = { statement: "S", points: [{ vs: "BenchApp", point: "P" }] };
    expect(fromForm("positioning", toForm("positioning", positioning), positioning)).toEqual(positioning);
    const audience = { who: "W", wants: ["a", "b", "c"], where: ["Instagram"] };
    expect(fromForm("audience", toForm("audience", audience), audience)).toEqual(audience);
    const notNow = { items: [{ platform: "YouTube", reason: "Costly." }] };
    expect(fromForm("not_now", toForm("not_now", notNow), notNow)).toEqual(notNow);
  });

  it("says when a line is over the writer's cap", () => {
    const fields = fieldsOf("audience", { who: "", wants: [] });
    expect(overCap(fields, { who: "x".repeat(121), wants: "short" })).toEqual({ who: 121 });
  });
});
