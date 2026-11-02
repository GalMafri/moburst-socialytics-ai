// @vitest-environment node
// The coverage rewrite (spec, "How we'll know it works"): at least 5 kept
// posts per platform per week, and a platform under that for two weeks
// running gets its searches rewritten from the profile. Proves when a
// platform counts as short, what Claude is asked, and which answers are refused.
import { describe, expect, it } from "vitest";
import { COVERAGE_FLOOR, coverageShort, lastKept, parseRewrite, rewriteRequest, TREND_REWRITE_MODEL, withoutRemoved, type CoverageWeek } from "./coverage";
import { MAX_SEARCHES } from "./sources";
import { TREND_WRITERS } from "./writer";
import { fakeDb } from "../lifecycle/fakeDb";
import type { PipelineRun } from "../pipelines/types";

const week = (week_start: string, tiktok: Record<string, unknown> | null, o: Partial<CoverageWeek> = {}): CoverageWeek => ({
  week_start, status: "done", filter_status: "ok",
  platforms: { ...(tiktok ? { tiktok: { status: "ok", kept: 0, ...tiktok } } : {}), linkedin: { status: "ok", kept: 9 } },
  ...o,
});
const short = (week_start: string, kept = 2, o: Partial<CoverageWeek> = {}) => week(week_start, { kept }, o);

describe("when a platform is short", () => {
  it("is short after fewer than 5 kept posts in each of the last two finished weeks", () => {
    expect(COVERAGE_FLOOR).toBe(5);
    const weeks = [short("2026-10-19", 4), short("2026-10-12", 0)];
    expect(coverageShort(weeks, "tiktok")).toBe(true);
    expect(coverageShort(weeks, "linkedin")).toBe(false);
    // Only the last two count, in whatever order the weeks were read.
    expect(coverageShort([week("2026-10-05", { kept: 9 }), short("2026-10-12"), short("2026-10-19")], "tiktok")).toBe(true);
  });

  it("is not short after one short week, or when one of the two kept 5", () => {
    expect(coverageShort([short("2026-10-19")], "tiktok")).toBe(false);
    expect(coverageShort([], "tiktok")).toBe(false);
    expect(coverageShort([week("2026-10-19", { kept: 5 }), short("2026-10-12")], "tiktok")).toBe(false);
    expect(coverageShort([short("2026-10-19"), week("2026-10-12", { kept: 7 })], "tiktok")).toBe(false);
  });

  it("reads finished weeks only", () => {
    const running = short("2026-10-26", 0, { status: "running" });
    expect(coverageShort([running, short("2026-10-19"), week("2026-10-12", { kept: 8 })], "tiktok")).toBe(false);
    expect(coverageShort([running, short("2026-10-19"), short("2026-10-12", 1, { status: "partial" })], "tiktok")).toBe(true);
  });

  it("leaves a source that failed, a filter that failed and a platform not watched out: new searches would not help", () => {
    expect(coverageShort([week("2026-10-19", { status: "failed", kept: 0 }), short("2026-10-12")], "tiktok")).toBe(false);
    expect(coverageShort([short("2026-10-19", 0, { filter_status: "failed" }), short("2026-10-12")], "tiktok")).toBe(false);
    expect(coverageShort([week("2026-10-19", { status: "not_watched" }), short("2026-10-12")], "tiktok")).toBe(false);
    expect(coverageShort([week("2026-10-19", null), short("2026-10-12")], "tiktok")).toBe(false);
  });

  it("counts a watched platform with nothing to search as short, and a platform with nothing new found", () => {
    expect(coverageShort([week("2026-10-19", { status: "no_searches" }), week("2026-10-12", { status: "empty" })], "tiktok")).toBe(true);
  });

  it("waits for a second week on new searches after a rewrite", () => {
    // The week that rewrote the searches ran on them; the week before it did not.
    expect(coverageShort([short("2026-10-19", 2, { platforms: { tiktok: { status: "ok", kept: 2, rewritten: true } } }), short("2026-10-12")], "tiktok")).toBe(false);
    expect(coverageShort([short("2026-10-26"), short("2026-10-19", 2, { platforms: { tiktok: { status: "ok", kept: 2, rewritten: true } } })], "tiktok")).toBe(true);
  });

  it("gives the kept counts of the last two finished weeks, newest first", () => {
    expect(lastKept([short("2026-10-12", 1), short("2026-10-26", 0, { status: "running" }), short("2026-10-19", 4)], "tiktok")).toEqual([4, 1]);
  });
});

describe("the rewrite request", () => {
  const profile = {
    audience: "App founders", fit_rubric: "Posts that teach app growth.", topics: [{ term: "app marketing", reason: "r" }],
    brand: "Moburst", competitors: ["SplitMetrics"], languages: ["he", "en"], region: "IL", exclusions: [{ term: "fake reviews", reason: "r" }],
  };

  it("asks Sonnet for new searches from the profile, naming what came up short and what stays", () => {
    const body = rewriteRequest(profile, "tiktok", ["mobile game UA", "app marketing", "marketing tips"], [2, 1], { keep: ["mobile game UA"], avoid: ["growth hacks"] }) as { model: string; max_tokens: number; messages: Array<{ content: string }> };
    expect(TREND_REWRITE_MODEL).toBe("claude-sonnet-5-5");
    expect(body.model).toBe(TREND_REWRITE_MODEL);
    const prompt = body.messages[0].content;
    for (const part of ["TikTok", "App founders", "Posts that teach app growth.", "app marketing", "marketing tips", "2 posts", "1 post", "Moburst", "SplitMetrics", "he, en", "IL", "fake reviews", "growth hacks", "mobile game UA"]) expect(prompt).toContain(part);
    // A person's search keeps its place, so there is room for 7 more.
    expect(prompt).toContain(`1 to ${MAX_SEARCHES - 1} searches`);
  });

  it("asks for hashtags on Instagram, which searches by hashtag", () => {
    const body = rewriteRequest(profile, "instagram", ["#aso"], [0, 3]) as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain("#tag");
    expect(body.messages[0].content).toContain(`1 to ${MAX_SEARCHES} searches`);
  });
});

describe("reading a rewrite", () => {
  const rules = { platform: "tiktok" as const, brand: "Moburst", competitors: ["SplitMetrics"], last: ["app marketing", "marketing tips"], keep: ["mobile game UA"], avoid: ["growth hacks"] };
  const answer = (searches: unknown) => JSON.stringify({ searches });

  it("reads the new searches, each once, leaving out a person's own", () => {
    expect(parseRewrite(answer([" app store optimization ", "App Store Optimization", "Mobile game UA", "app marketing", "user acquisition"]), rules))
      .toEqual({ value: ["app store optimization", "app marketing", "user acquisition"] });
  });

  it("refuses the brand, a competitor, a term a person removed, too many searches and none at all", () => {
    for (const bad of [["Moburst agency tips"], ["SplitMetrics review"], ["Growth Hacks"], Array.from({ length: MAX_SEARCHES }, (_, i) => `search ${i}`), []]) {
      expect(parseRewrite(answer(bad), rules)).toHaveProperty("error");
    }
    expect(parseRewrite("not json", rules)).toHaveProperty("error");
    expect(parseRewrite(JSON.stringify({ topics: ["a"] }), rules)).toHaveProperty("error");
  });

  it("refuses an answer that only repeats the searches that came up short", () => {
    const got = parseRewrite(answer(["Marketing tips", "app marketing"]), rules);
    expect(got).toHaveProperty("error");
    expect((got as { error: string }).error).toMatch(/already searched/);
  });

  it("takes Instagram searches as one #tag each", () => {
    const ig = { ...rules, platform: "instagram" as const, last: ["#aso"], keep: [] };
    expect(parseRewrite(answer(["appgrowth", "#mobileapps"]), ig)).toEqual({ value: ["#appgrowth", "#mobileapps"] });
    expect(parseRewrite(answer(["app growth tips"]), ig)).toHaveProperty("error");
    expect(parseRewrite(answer(["#moburstlife"]), ig)).toHaveProperty("error");
  });
});

describe("a person's removals", () => {
  it("drops a rewritten search a person has since removed: topics everywhere but Instagram, hashtags on Instagram", () => {
    const removed = { topics: ["app marketing"], instagram: ["#aso"] };
    expect(withoutRemoved({ tiktok: ["App Marketing", "aso"], instagram: ["#ASO", "#apps"], linkedin: [] }, removed))
      .toEqual({ tiktok: ["aso"], instagram: ["#apps"], linkedin: [] });
  });
});

describe("keeping a rewrite", () => {
  const WRITTEN = "2026-10-01T00:00:00.000Z";
  const TAGGED = "2026-10-02T00:00:00.000Z";
  const db = () => fakeDb({ trend_profiles: [{ client_id: "c1", search_overrides: { youtube: ["kept"] }, written_at: WRITTEN, hashtags_at: TAGGED }] });
  const run = { id: "run-1", client_id: "c1" } as PipelineRun;

  it("stores a platform's new searches beside the other platforms'", async () => {
    const d = db();
    await TREND_WRITERS.searches(d, run, { platform: "tiktok", searches: ["a", "b"], profile_written_at: WRITTEN });
    expect(d.tables.trend_profiles[0].search_overrides).toEqual({ youtube: ["kept"], tiktok: ["a", "b"] });
  });

  it("stores nothing once the profile was written again, which cleared the rewrites made from the old one", async () => {
    const d = db();
    d.tables.trend_profiles[0] = { ...d.tables.trend_profiles[0], search_overrides: {}, written_at: "2026-11-01T11:00:00.000Z" };
    await TREND_WRITERS.searches(d, run, { platform: "tiktok", searches: ["a"], profile_written_at: WRITTEN });
    expect(d.tables.trend_profiles[0].search_overrides).toEqual({});
  });

  it("stores an Instagram rewrite only while the hashtags it was built from stand", async () => {
    const d = db();
    await TREND_WRITERS.searches(d, run, { platform: "instagram", searches: ["#a"], profile_written_at: WRITTEN, profile_hashtags_at: TAGGED });
    expect(d.tables.trend_profiles[0].search_overrides).toEqual({ youtube: ["kept"], instagram: ["#a"] });
    // The monthly refresh replaced the hashtags since: Instagram's rewrite is not stored, another platform's still is.
    const refreshed = db();
    refreshed.tables.trend_profiles[0].hashtags_at = "2026-11-01T00:00:00.000Z";
    await TREND_WRITERS.searches(refreshed, run, { platform: "instagram", searches: ["#a"], profile_written_at: WRITTEN, profile_hashtags_at: TAGGED });
    await TREND_WRITERS.searches(refreshed, run, { platform: "tiktok", searches: ["b"], profile_written_at: WRITTEN, profile_hashtags_at: TAGGED });
    expect(refreshed.tables.trend_profiles[0].search_overrides).toEqual({ youtube: ["kept"], tiktok: ["b"] });
    // A profile with no refresh yet: both sides have none.
    const fresh = db();
    fresh.tables.trend_profiles[0].hashtags_at = null;
    await TREND_WRITERS.searches(fresh, run, { platform: "instagram", searches: ["#a"], profile_written_at: WRITTEN, profile_hashtags_at: "" });
    expect(fresh.tables.trend_profiles[0].search_overrides).toEqual({ youtube: ["kept"], instagram: ["#a"] });
  });
});
