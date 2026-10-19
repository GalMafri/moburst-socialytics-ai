// Labels match their fields: the report page, Analytics and its insight
// tiles count posts, recommendations and calendar posts the same way.

import { describe, expect, it } from "vitest";
import { reportCounts } from "@/lib/reportFigures";

describe("report counts", () => {
  it("counts the posts Sprout measured, not the length of the top-ten list", () => {
    // Bader Law, September 2026: 13 + 15 + 12 + 8 + 19 posts; the top-posts list held 10.
    const rd = { data_counts: { sprout_top_posts: 10, total_recommendations: 13 }, sprout_performance: { top_posts: new Array(10).fill({}), platform_breakdown: [13, 15, 12, 8, 19].map((post_count) => ({ post_count })) } };
    expect(reportCounts(rd).postsAnalyzed).toBe(67);
    expect(reportCounts([rd]).postsAnalyzed).toBe(67);
    expect(reportCounts({ sprout_performance: { platform_metrics: { TikTok: { post_count: 12 }, YouTube: { post_count: 19 } } } }).postsAnalyzed).toBe(31);
    expect(reportCounts({}).postsAnalyzed).toBeNull();
  });

  it("counts recommendations as the actions the report recommends, and calendar posts under their own name", () => {
    const rd = {
      data_counts: { total_recommendations: 13 },
      content_calendar: [{ posts: [{}, {}] }, { posts: [{}] }],
      ai_analysis: {
        competitive_takeaways: ["a", "b"],
        sprout_performance_analysis: { pillar_alignment: { recommendations: ["c"] } },
        tiktok_trends_analysis: { opportunities_for_client: ["d", "e"] },
        instagram_trends_analysis: { opportunities_for_client: [] },
      },
    };
    expect(reportCounts(rd).recommendations).toBe(5);
    expect(reportCounts(rd).calendarPosts).toBe(3);
  });
});
