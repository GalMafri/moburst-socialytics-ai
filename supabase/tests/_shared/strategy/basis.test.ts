// @vitest-environment node
// Each platform's data basis (spec: docs/superpowers/specs/2026-11-03-strategy-
// v2-design.md, section 3): measured with Sprout, public at 12 posts in 90
// days, thin below, none without posts; a rate per view only where the public
// sees views (TikTok, YouTube); no estimated rate anywhere; LinkedIn's public
// read has no follower count; a thin or none platform's goals measure only
// posts a week or followers.
import { describe, expect, it } from "vitest";
import { basisOf, basisWords, dataLine, metricsFor, PUBLIC_MIN_POSTS, publicWindowLine, rateKindOf, type PlatformFigures } from "../../../functions/_shared/strategy/basis";

const f = (over: Partial<PlatformFigures>): PlatformFigures => ({ platform: "Instagram", basis: "public", posts: 20, posts_per_week: 1.6, median_engagement: 40, rate: null, rate_kind: null, followers: 1200, ...over });

describe("the data basis", () => {
  it("comes from the data", () => {
    expect(PUBLIC_MIN_POSTS).toBe(12);
    expect(basisOf({ sprout: true, posts: 1 })).toBe("measured");
    // A connected account with no posts yet has nothing measured.
    expect(basisOf({ sprout: true, posts: 0 })).toBe("none");
    expect(basisOf({ sprout: false, posts: 12 })).toBe("public");
    expect(basisOf({ sprout: false, posts: 11 })).toBe("thin");
    expect(basisOf({ sprout: false, posts: 1 })).toBe("thin");
    expect(basisOf({ sprout: false, posts: 0 })).toBe("none");
  });

  it("rates per impression with Sprout, per view on public TikTok and YouTube, and nowhere else", () => {
    expect(rateKindOf("Instagram", "measured")).toBe("impression");
    expect(rateKindOf("TikTok", "public")).toBe("view");
    expect(rateKindOf("YouTube", "public")).toBe("view");
    for (const p of ["Instagram", "Facebook", "X", "LinkedIn"]) expect(rateKindOf(p, "public")).toBeNull();
    expect(rateKindOf("TikTok", "thin")).toBeNull();
  });

  it("lets a goal measure only what the platform has a figure for, and only posts a week or followers on thin data", () => {
    expect(metricsFor(f({ basis: "measured", rate: 0.03, rate_kind: "impression" }))).toEqual(["posts_per_week", "median_engagement", "engagement_rate", "followers"]);
    expect(metricsFor(f({}))).toEqual(["posts_per_week", "median_engagement", "followers"]);
    expect(metricsFor(f({ basis: "thin", rate: 0.05, rate_kind: null }))).toEqual(["posts_per_week", "followers"]);
    expect(metricsFor(f({ basis: "none", posts: 0, median_engagement: null, followers: null }))).toEqual(["posts_per_week"]);
    // LinkedIn's public read has no follower count.
    expect(metricsFor(f({ platform: "LinkedIn", followers: null }))).toEqual(["posts_per_week", "median_engagement"]);
  });

  it("says where each platform's numbers come from in plain words, with no vendor name and no pipe", () => {
    const all = [f({ basis: "measured" }), f({ platform: "TikTok" }), f({ platform: "LinkedIn", followers: null }), f({ platform: "X", basis: "thin", posts: 4 }), f({ platform: "YouTube", basis: "none", posts: 0 })];
    expect(dataLine(all)).toBe("Instagram from your own account; TikTok, LinkedIn and X from public posts; YouTube not measured yet");
    expect(dataLine([f({ basis: "measured" })])).toBe("Instagram from your own account");
    expect(dataLine([])).toBe("");
    for (const line of [dataLine(all), ...all.map(basisWords)]) expect(line).not.toMatch(/sprout|rivaliq|apify|\|/i);
    // A gap in a figure is not a line of its own.
    expect(dataLine([f({ platform: "LinkedIn", followers: null })])).not.toMatch(/follower/);
  });

  it("says the deck's one factual line", () => {
    expect(publicWindowLine([f({})], { start: "2026-08-05", end: "2026-11-02" })).toBe("Based on public posts from Aug 5 to Nov 2, 2026");
    expect(publicWindowLine([f({ basis: "measured" })], { start: "2026-08-05", end: "2026-11-02" })).toBe("");
  });
});
