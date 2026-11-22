// @vitest-environment node
// QA 22 Nov 2026 (P31-03): the one engagement rate is "engagements / impressions, views on video networks" for every
// company. A RivalIQ-only company (every competitor) gets its cross-network rate from RivalIQ's
// cross-channel totals, whose impressions are estimated impressions, never views. A company whose
// only network is TikTok must have the same cross-network rate as its TikTok rate.
import { describe, expect, it } from "vitest";
import { competitiveCompanyMetrics } from "../../../functions/_shared/competitive/reportMetrics";

const tiktok = { posts: { current: 10, previous: null }, engagement: { current: 1000, previous: null }, impressions: { current: 5000, previous: null }, views: { current: 100000, previous: null } };
const competitor = { rivaliq_metrics: {
  period: { start: "2026-10-01", end: "2026-10-31" },
  posts: { current: 10, previous: null }, engagement: { current: 1000, previous: null },
  estimated_impressions: { current: 5000, previous: null }, // crossChannelEstimatedImpressions: the sum of network estimated impressions
  by_network: { tiktok },
} };

describe("P31-03 a competitor's cross-network rate on a video network", () => {
  it("divides by views, as its own TikTok rate does and as a Sprout client's rate does", () => {
    const m = competitiveCompanyMetrics(competitor);
    expect(m.engagement_rate.current).toBeCloseTo(m.by_network.tiktok.engagement_rate.current, 6);
  });
});
