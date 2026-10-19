// Engagement rate per impression everywhere (Lital, 19 Oct 2026). The figures
// are RivalIQ's stored period totals from the Bader Law and LegaBot reports
// of September 2026 (1c4f4805, e993884a), the proof the decision was made on.

import { describe, expect, it } from "vitest";
import { engagementRate, normalizedCompetitiveMetrics, postEngagementRate, postReach } from "@/lib/competitiveMetrics";
import { sproutEngagementRate, sproutEngagements } from "@/lib/reportFigures";

const period = { start: "2026-09-01", end: "2026-09-30" };
const both = (current: number, previous = 0) => ({ current, previous });
const network = (posts: number, engagement: number, impressions: number, extra: Record<string, unknown> = {}) => ({
  posts: both(posts), engagement: both(engagement), impressions: both(impressions), rate: both(9.99), ...extra,
});

const company = (name: string, is_client: boolean, engagement: number, impressions: number, by_network: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name, is_client, post_count: 10, by_channel: Object.fromEntries(Object.keys(by_network).map((k) => [k, { post_count: 1, engagement_rate_avg: 9.99 }])),
  rivaliq_metrics: { period, posts: both(10), engagement: both(engagement), estimated_impressions: both(impressions), engagement_rate_per_post: both(0.0141), by_network },
  ...extra,
});

describe("one engagement rate: engagements divided by impressions", () => {
  it("is null without impressions, never a rate from another formula", () => {
    expect(engagementRate(5, 100)).toBe(0.05);
    expect(engagementRate(5, 0)).toBeNull();
    expect(engagementRate(5, null)).toBeNull();
    expect(engagementRate(null, 100)).toBeNull();
  });

  it("reads every company from RivalIQ, the client included: Bader 0.12% against peers at 1.28% to 2.89%", () => {
    const report = {
      period,
      aggregates: {
        metric_semantics_version: 4,
        companies: [
          company("Bader Law", true, 2533, 2097537, {
            facebook: network(13, 677, 230566),
            instagram: network(13, 437, 17211),
            tiktok: network(12, 511, 90170, { views: both(90170) }),
            youtube: network(16, 908, 1759590, { views: both(1759590) }),
          }, {
            // Sprout's own figures for the client: they must not replace the comparison rate.
            owned_metrics: {
              coverage: "complete", period,
              by_network: { facebook: { posts: both(42), engagement: both(755), impressions: both(235735), rate: both(0.002155), profiles: [{ id: "1", name: "Bader Law" }] } },
            },
          }),
          company("TopDog Law", false, 11538, 900620, {}),
          company("Morgan & Morgan P.A.", false, 11459, 396194, {}),
          company("reyeslaw.com", false, 538, 33274, {}),
        ],
      },
    };
    const companies = normalizedCompetitiveMetrics(report).aggregates.companies as any[];
    const pct = (n: number) => (n * 100).toFixed(2) + "%";
    expect(companies.map((c) => pct(c.engagement_rate_avg))).toEqual(["0.12%", "1.28%", "2.89%", "1.62%"]);
    const bader = companies[0];
    expect(bader.comparison_metrics.engagement_rate.current).toBe(2533 / 2097537);
    expect(bader.by_channel.facebook.engagement_rate_avg).toBe(677 / 230566);
    expect(bader.by_channel.tiktok.engagement_rate_avg).toBe(511 / 90170);
    expect(bader.by_channel.youtube.engagement_rate_avg).toBe(908 / 1759590);
    expect(JSON.stringify(bader.comparison_metrics)).not.toMatch(/"rate":|engagement_rate_per_post/);
  });

  it("leaves a platform RivalIQ has no impressions for without a rate (LegaBot Facebook showed 304.19%)", () => {
    const report = {
      period,
      aggregates: {
        metric_semantics_version: 4,
        companies: [company("LegaBot", true, 8233, 187375, {
          instagram: network(39, 8133, 186562),
          tiktok: network(4, 100, 813, { views: both(813) }),
          twitter: network(0, 0, 0),
        }, {
          owned_metrics: {
            coverage: "complete", period,
            by_network: { facebook: { posts: both(43), engagement: both(1300), impressions: both(0), rate: both(3.0419), profiles: [{ id: "2", name: "LegaBot" }] } },
          },
          by_channel: { facebook: { post_count: 43, engagement_rate_avg: 3.0419 }, instagram: { post_count: 39 } },
        })],
      },
    };
    const legabot = normalizedCompetitiveMetrics(report).aggregates.companies[0] as any;
    expect(legabot.by_channel.facebook.engagement_rate_avg).toBeNull();
    expect(legabot.by_channel.instagram.engagement_rate_avg).toBe(8133 / 186562);
    expect(legabot.by_channel.twitter.engagement_rate_avg).toBeNull();
  });

  it("rates a top post per impression or per view, or not at all, and keeps its stored rank", () => {
    expect(postReach({ channel: "tiktok", views: 900, est_impressions: 50 })).toEqual({ value: 900, kind: "views" });
    expect(postReach({ channel: "facebook", actual_impressions: 400, est_impressions: 50 })).toEqual({ value: 400, kind: "impressions" });
    expect(postReach({ channel: "instagram", est_impressions: 50 })).toEqual({ value: 50, kind: "estimated" });
    expect(postEngagementRate({ channel: "instagram", engagement: 10 })).toBeNull();
    const report = { aggregates: { companies: [{ name: "A", top_posts: [
      { engagement: 210, channel: "linkedin", engagement_rate: 19.72 },
      { engagement: 30, channel: "instagram", est_impressions: 1000, engagement_rate: 2.2588 },
    ] }] } };
    const posts = (normalizedCompetitiveMetrics(report).aggregates.companies[0] as any).top_posts;
    expect(posts.map((p: any) => p.engagement)).toEqual([210, 30]);
    expect(posts.map((p: any) => p.engagement_rate)).toEqual([null, 0.03]);
  });

  it("uses the same definition for the client's own Sprout performance", () => {
    const totals = { engagements: 3341, impressions: 996405, reactions: 1987, comments: 109, shares: 632, link_clicks: 223 };
    expect(sproutEngagements(totals)).toBe(3341);
    expect(sproutEngagementRate(totals)).toBe(engagementRate(3341, 996405));
    // Reports written before Sprout's total was stored add up the parts.
    expect(sproutEngagements({ reactions: 5, comments: 2, shares: 1, link_clicks: 2 })).toBe(10);
    expect(sproutEngagementRate({ reactions: 5, impressions: 0 })).toBeNull();
  });
});
