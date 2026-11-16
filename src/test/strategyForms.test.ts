// A strategy card's fields in the edit sheet and back: what the sheet does not
// show (a pillar idea's format, an unchanged pattern's source) is kept from the
// version started from. A goal's figures and a platform's worked posts are not
// stored with an edit at all: they are read from the latest write, matched by
// the platform, metric and direction the goal was written against.
import { describe, expect, it } from "vitest";
import { choicesFor, fieldsOf, formIssue, fromForm, missingHalf, overCap, savedAsWritten, toForm } from "@/lib/strategyForms";
import { typedPart, withLatestSection } from "../../supabase/functions/_shared/strategy/sections";

describe("the edit sheet's fields", () => {
  it("round-trips every card kind, keeping what the sheet does not show", () => {
    const goals = { items: [{ title: "Grow", why: "Because.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 42, by: "2027-02-01" }] };
    const g = toForm("goals", goals);
    const orphan = { title: "Old goal", why: "Mine.", platform: "TikTok", metric: "followers", direction: "above" };
    expect(fromForm("goals", g, goals, [orphan]).items).toEqual([{ title: "Grow", why: "Because.", platform: "Instagram", metric: "median_engagement", direction: "above" }, orphan]);
    expect(fromForm("goals", { ...g, goal_0_title: "Grow more" }, goals)).toEqual({ items: [{ title: "Grow more", why: "Because.", platform: "Instagram", metric: "median_engagement", direction: "above" }] });

    const pillar = { purpose: "Laugh.", formats: ["carousel"], planned_share: 60, ideas: [{ hook: "A", format: "reel" }, { hook: "B", format: "carousel" }] };
    expect(fromForm("pillar:X", { ...toForm("pillar:X", pillar), planned_share: "55" }, pillar)).toEqual({ ...pillar, planned_share: 55 });

    const platform = { role: "Home.", post: ["a", "b", "c"], worked: [{ date: "2026-10-05", multiple: 2.7, metric: "impressions", link: null, text: "t", format: "carousel" }], first_30: ["1", "2", "3", "4"], checks: { day_30: "x", day_90: "y" } };
    const { worked: _worked, ...typed } = platform;
    expect(fromForm("platform:tiktok:new", toForm("platform:tiktok:new", platform), platform)).toEqual(typed);
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

  it("keeps a person's wording over the latest figures, dates and worked posts", () => {
    const stored = { items: [{ title: "Grow more", why: "Mine.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 42, by: "2027-02-01" }] };
    const latest = { items: [{ title: "Grow", why: "Theirs.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 61, by: "2027-05-01" }, { title: "Second", why: "w", platform: "TikTok", metric: "posts", direction: "above", baseline: 3, by: "2027-05-01" }] };
    expect(withLatestSection("goals", latest, stored)).toEqual({ items: [{ ...latest.items[0], title: "Grow more", why: "Mine." }, latest.items[1]] });
    // A latest write that lists the goals in another order still gets the words on the goal they were written for.
    const reordered = { items: [latest.items[1], latest.items[0]] };
    expect(withLatestSection("goals", reordered, stored)).toEqual({ items: [reordered.items[0], { ...latest.items[0], title: "Grow more", why: "Mine." }] });

    const oldPlatform = { role: "Mine.", post: ["a"], worked: [{ text: "old" }], checks: { day_30: "x", day_90: "y" } };
    const newPlatform = { role: "Theirs.", post: ["b"], worked: [{ text: "new" }], checks: { day_30: "p", day_90: "q" } };
    expect(withLatestSection("platform:instagram:posting", newPlatform, oldPlatform)).toEqual({ ...oldPlatform, worked: [{ text: "new" }] });

    // A card with no figures to refresh, or a 2 Nov text, is shown as it was saved.
    expect(withLatestSection("audience", { who: "A" }, { who: "B" })).toEqual({ who: "B" });
    expect(withLatestSection("goals", latest, "- text")).toBe("- text");
    expect(withLatestSection("goals", null, stored)).toBe(stored);
  });

  it("asks for a competitor and a platform from a list, and refuses a line that has none", () => {
    const positioning = { statement: "S", points: [{ vs: "BenchApp", point: "P" }] };
    const form = toForm("positioning", positioning);
    expect(form.points).toEqual([{ pick: "BenchApp", text: "P" }]);
    const bad = { ...form, points: [{ pick: "", text: "We post checklists." }] };
    expect(formIssue("positioning", bad)).toMatch(/competitor/i);
    expect(formIssue("positioning", form)).toBeNull();
    expect(formIssue("positioning", { ...form, points: [{ pick: "BenchApp", text: "" }] })).not.toBeNull();
    // A blank row is dropped; a point is never stored with an empty competitor.
    expect(fromForm("positioning", { ...form, points: [{ pick: "", text: "" }, { pick: "BenchApp", text: "P" }] }, positioning)).toEqual(positioning);
    expect(formIssue("not_now", { items: [{ pick: "", text: "Costly." }] })).toMatch(/platform/i);
    expect(fromForm("not_now", { items: [{ pick: "YouTube", text: "Costly." }] }, {})).toEqual({ items: [{ platform: "YouTube", reason: "Costly." }] });
  });

  it("marks which half of a line is empty, and lists each platform once whatever spelling was stored", () => {
    expect(missingHalf({ pick: "", text: "x" })).toBe("pick");
    expect(missingHalf({ pick: "BenchApp", text: " " })).toBe("text");
    expect(missingHalf({ pick: "BenchApp", text: "x" })).toBeNull();
    expect(missingHalf({ pick: "", text: "" })).toBeNull();
    const notNow = { items: [{ platform: "instagram", reason: "Later." }] };
    expect(toForm("not_now", notNow).items).toEqual([{ pick: "Instagram", text: "Later." }]);
    expect(choicesFor({}, notNow).platforms.filter((p) => p.toLowerCase() === "instagram")).toEqual(["Instagram"]);
  });

  it("offers the strategy's competitors and the known platforms, and shows no typed-format hint", () => {
    const positioning = { statement: "S", points: [{ vs: "BenchApp", point: "P" }] };
    const choices = choicesFor(positioning, positioning, ["Rival Co"], []);
    expect(choices.competitors).toEqual(["Rival Co", "BenchApp"]);
    expect(choices.platforms).toEqual(expect.arrayContaining(["Instagram", "YouTube", "TikTok"]));
    const pos = fieldsOf("positioning", positioning, choices);
    const points = pos.find((f) => f.name === "points");
    expect(points).toMatchObject({ kind: "pairs", options: ["Rival Co", "BenchApp"] });
    const notNow = fieldsOf("not_now", { items: [] }, choices)[0];
    expect(notNow.kind).toBe("pairs");
    for (const f of [...pos, notNow]) expect(f.hint ?? "").not.toMatch(/colon/i);
  });

  it("says when a line is over the writer's cap", () => {
    const fields = fieldsOf("audience", { who: "", wants: [] });
    expect(overCap(fields, { who: "x".repeat(121), wants: "short" })).toEqual({ who: 121 });
  });
});

describe("a save of the written version as it is", () => {
  it("is the typed part of the written goals and platform cards, and of every other card as the sheet saves it", () => {
    const goals = { items: [{ title: "Grow", why: "Because.", platform: "Instagram", metric: "followers", direction: "above", baseline: 900, by: "2027-02-01" }] };
    expect(fromForm("goals", toForm("goals", goals), goals)).toEqual(typedPart("goals", goals));
    const platform = { role: "Home.", post: ["a"], worked: [{ text: "w" }], checks: { day_30: "x", day_90: "y" } };
    expect(fromForm("platform:instagram:posting", toForm("platform:instagram:posting", platform), platform)).toEqual(typedPart("platform:instagram:posting", platform));
    for (const [key, value] of [["goals", goals], ["platform:instagram:posting", platform], ["audience", { who: "W", wants: ["a"], where: ["Instagram"] }], ["positioning", { statement: "S", points: [{ vs: "B", point: "P" }] }]] as const) {
      expect(savedAsWritten(key, fromForm(key, toForm(key, value), value), value)).toBe(true);
    }
  });

  it("is not a changed word, a kept earlier goal, or a strategy written as text", () => {
    const goals = { items: [{ title: "Grow", why: "Because.", platform: "Instagram", metric: "followers", direction: "above", baseline: 900, by: "2027-02-01" }] };
    const form = toForm("goals", goals);
    expect(savedAsWritten("goals", fromForm("goals", { ...form, goal_0_why: "Mine." }, goals), goals)).toBe(false);
    expect(savedAsWritten("goals", fromForm("goals", form, goals, [{ title: "Old", why: "", platform: "TikTok", metric: "followers", direction: "above" }]), goals)).toBe(false);
    expect(savedAsWritten("goals", fromForm("goals", form, goals), "Grow saves on Instagram.")).toBe(false);
  });
});
