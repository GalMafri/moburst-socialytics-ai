// QA 22 Nov 2026 (P47-03): an outlier fact states a smoothed multiple ((value+1)/(usual+1)) as "Nx the
// platform's usual per post", beside a basis line whose own figures give a different multiple.
import { describe, expect, it } from "vitest";
import { socialFacts } from "../../../functions/_shared/reports/facts";

const report = {
  sprout_performance: {
    platform_breakdown: [{ network: "Instagram", current: { engagements: 20, impressions: 2000 }, previous: { engagements: 20, impressions: 2000 }, post_count: 10, previous_post_count: 10 }],
    top_posts: [{ permalink: "https://instagram.com/p/1", platform_display: "Instagram", content_category: "VIDEO", engagements: 10, impressions: 300 }],
  },
};

describe("P47-03 outlier multiple", () => {
  it("says the multiple its own figures hold (10 engagements against 2 per post is 5x)", () => {
    const outlier = socialFacts(report).find((f) => f.kind === "outlier")!;
    expect(outlier.basis).toContain("10 engagements against 2 per post");
    expect(outlier.sentence).toContain("5x the platform's usual per post");
  });
});
