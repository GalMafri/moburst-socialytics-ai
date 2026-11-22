// @vitest-environment node
// P50-03: the draft check refuses any field holding a letter P, C, T, N or R
// followed by one or two digits as an "evidence id". A competitor (or the
// brand) named like "N26", "C3" or "T1" can then never be written: the
// positioning point must name the competitor exactly, and that exact name is
// refused. The write is asked again once, then ends; it starts over later
// from the start, and fails the same way.
import { describe, expect, it } from "vitest";
import { strategyProblems, type StrategyDraft, type StrategyEvidence } from "../../../functions/_shared/strategy/write";

const E = {
  client: { name: "Revolut", market: ["UK"], languages: ["en"], first_language: "en" },
  brief: "", pillars: [{ name: "Money tips", description: "", share: null }], keywords: [], brand_notes: "", brand_book: "", voice: "", site: "",
  competitors: ["N26"], competitive_brief: "",
  profile: { audience: "A", fit_rubric: "F", exclusions: [] },
  platforms: [{
    platform: "Instagram", key: "instagram", state: "posting", handle: null, profile_reason: null, cadence: { per_week: 2, source: "competitors" },
    baseline: null, figures: { platform: "Instagram", basis: "measured", posts: 30, posts_per_week: 2.3, median_engagement: 40, rate: 0.03, rate_kind: "impression", followers: 1000 },
  }],
  competitor_figures: [], window: { start: "2026-08-04", end: "2026-11-02" }, written_on: "2026-11-02",
  evidence: [], avoid: [], thin: [], edits: {}, sources: [],
} as unknown as StrategyEvidence;

const draft: StrategyDraft = {
  goals: [
    { title: "Grow engagement per post", why: "Useful posts get saved.", platform: "Instagram", metric: "median_engagement", direction: "above" },
    { title: "Post at a steady pace", why: "A steady week keeps us seen.", platform: "Instagram", metric: "posts_per_week", direction: "above" },
  ],
  audience: { who: "Young people who travel.", wants: ["Low fees", "Fast transfers", "Clear spending"], where: ["Instagram"] },
  positioning: { statement: "The money app for people on the move.", points: [{ vs: "N26", point: "We show spending by trip, not only by month." }] },
  pillars: [{ name: "Money tips", purpose: "Save people money.", formats: ["carousel"], planned_share: 100, ideas: [{ hook: "Three fees to skip", format: "carousel" }, { hook: "Travel money check", format: "reel" }] }],
  platforms: [{ platform: "Instagram", role: "Our home base.", post: ["Tips", "Guides", "Answers"], worked: [], first_30: [], checks: { day_30: "Saves per post", day_90: "Engagement per post" } }],
  candidates: [],
  avoid: [{ pattern: "Stock photos of cards", source: "brief" }],
};

describe("a competitor named like an evidence id", () => {
  it("accepts a positioning point against the competitor by its exact name", () => {
    expect(strategyProblems(draft, E)).toEqual([]);
  });
});
