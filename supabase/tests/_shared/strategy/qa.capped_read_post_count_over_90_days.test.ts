// @vitest-environment node
// P50-04: Instagram's public reader brings back only the 12 latest posts.
// figures() knows such a read covers fewer days and works the pace out over
// them, but the writer is told "<posts> posts from <90-day start> to <end>
// (<pace> a week)": 12 posts over 90 days beside a pace of about 4 a week.
// The count is a figure the evidence does not have (the brand posted far
// more than 12 times in those 90 days), and the fact check passes it.
import { describe, expect, it } from "vitest";
import { platformFigures, strategyRequest, type StrategyEvidence } from "../../../functions/_shared/strategy/write";
import type { PublicPost } from "../../../functions/_shared/strategy/publicRead";

const NOW = new Date("2026-11-02T10:00:00.000Z");
// The 12 latest posts, one every two days: the read reached its cap.
const posts: PublicPost[] = Array.from({ length: 12 }, (_, i) => ({
  company: "Acme", client: true, platform: "Instagram", id: `ig${i}`, publishedAt: new Date(NOW.getTime() - (3 + i * 2) * 86_400_000).toISOString(),
  text: "x", link: "https://www.instagram.com/p/x/", format: "image", engagement: 40, views: null, followers: 900, boosted: false, source: "apify", capped: 12,
}));

describe("a capped public read in the writer's evidence", () => {
  it("does not state the capped count as the posts of the whole 90 days", () => {
    const f = platformFigures("Instagram", { sprout: false, own: [], publicPosts: posts, now: NOW });
    expect(f.posts).toBe(12);
    expect(f.posts_per_week).toBeGreaterThan(3); // pace over the ~25 days the read covers
    const e = {
      client: { name: "Acme", market: [], languages: ["en"], first_language: "en" }, brief: "", pillars: [], keywords: [], brand_notes: "", brand_book: "", voice: "", site: "",
      competitors: [], competitive_brief: "", profile: { audience: "", fit_rubric: "", exclusions: [] },
      platforms: [{ platform: "Instagram", key: "instagram", state: "posting", handle: null, profile_reason: null, cadence: null, baseline: null, figures: f }],
      competitor_figures: [], window: { start: "2026-08-04", end: "2026-11-02" }, written_on: "2026-11-02", evidence: [], avoid: [], thin: [], edits: {}, sources: [],
    } as unknown as StrategyEvidence;
    const prompt = (strategyRequest(e) as { messages: Array<{ content: string }> }).messages[0].content;
    expect(prompt).not.toContain("12 posts from 2026-08-04 to 2026-11-02");
  });
});
