// Engagement rate per impression everywhere (Lital, 19 Oct 2026), and the
// client's own figures from Sprout (Lital, 20 Oct 2026). The figures are the
// stored period totals from the Bader Law and LegaBot reports of September
// 2026 (1c4f4805, e993884a): RivalIQ's for every company, Sprout's for the
// client, counted from the report's own stored posts with ads left out.

import { describe, expect, it } from "vitest";
import { engagementRate, engagementsOf, normalizedCompetitiveMetrics, postEngagementRate, postReach } from "@/lib/competitiveMetrics";
import { normalizedSocialReport, socialPeriodFigures, sproutEngagementRate, sproutEngagements } from "@/lib/reportFigures";

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

  it("rates the client from Sprout where Sprout measures it and every competitor from RivalIQ, with one definition", () => {
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
            // Sprout's own Facebook figures for the client replace RivalIQ's on that platform.
            owned_metrics: {
              coverage: "complete", period,
              by_network: { facebook: { posts: both(13), engagement: both(755), impressions: both(235735), rate: both(0.002155), profiles: [{ id: "1", name: "Bader Law" }] } },
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
    // Sprout's Facebook, RivalIQ's other platforms, views on TikTok and YouTube.
    expect(bader.comparison_metrics.engagement_rate.current).toBe((755 + 437 + 511 + 908) / (235735 + 17211 + 90170 + 1759590));
    expect(bader.comparison_metrics.metric_scopes.engagement_rate).toBe("sprout_and_rivaliq");
    expect(bader.by_channel.facebook.engagement_rate_avg).toBe(755 / 235735);
    expect(bader.by_channel.instagram.engagement_rate_avg).toBe(437 / 17211);
    expect(bader.by_channel.tiktok.engagement_rate_avg).toBe(511 / 90170);
    expect(bader.by_channel.youtube.engagement_rate_avg).toBe(908 / 1759590);
    expect(companies[1].comparison_metrics.engagement_rate.current).toBe(11538 / 900620);
    expect(companies[1].comparison_metrics.metric_scopes.engagement_rate).toBe("rivaliq");
    expect(JSON.stringify(bader.comparison_metrics)).not.toMatch(/"rate":|engagement_rate_per_post/);
  });

  it("reads the client's posts, engagement, audience, share of voice and cadence from Sprout, ads left out (Bader 1c4f4805)", () => {
    const rq = (posts: number, audience: number, engagement: number, impressions: number, by_network: Record<string, unknown>) => ({
      period, posts: both(posts), audience: both(audience), engagement: both(engagement), estimated_impressions: both(impressions), by_network,
    });
    const sample = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, { post_count: 99 }]));
    const sprout = (posts: number, engagement: number, followers: number, impressions: number) => ({ posts: both(posts), engagement: both(engagement), followers: both(followers), impressions: both(impressions), source: "sprout", profiles: [{ id: "1", name: "Bader Law" }] });
    const report = {
      period: { ...period, days: 30 },
      aggregates: {
        metric_semantics_version: 4,
        companies: [
          { name: "Bader Law", is_client: true, post_count: 94, by_channel: sample(["facebook", "instagram", "linkedin", "tiktok", "twitter", "youtube"]),
            rivaliq_metrics: rq(54, 15056, 2533, 2097537, { facebook: network(13, 677, 230566), instagram: network(13, 437, 17211), tiktok: network(12, 511, 90170, { views: both(90170) }), twitter: network(0, 0, 0), youtube: network(16, 908, 1759590, { views: both(1759590) }) }),
            // Sprout's figures for Bader in September 2026, counted from the report's stored
            // posts: 13 published Facebook posts (the 29 ad rows left out), YouTube's views as its impressions.
            owned_metrics: { coverage: "complete", period, published_posts_only: true, by_network: {
              facebook: sprout(13, 755, 8367, 235735), instagram: sprout(13, 437, 5169, 21477), tiktok: sprout(12, 511, 42, 90167),
              youtube: sprout(19, 908, 231, 1747356), linkedin: sprout(8, 62, 3646, 2705),
            } } },
          { name: "TopDog Law", is_client: false, post_count: 50, by_channel: sample(["facebook", "instagram"]), rivaliq_metrics: rq(50, 683428, 11538, 900620, { facebook: network(22, 1027, 302809), instagram: network(28, 10511, 597811) }) },
          { name: "Morgan & Morgan P.A.", is_client: false, post_count: 51, by_channel: sample(["facebook"]), rivaliq_metrics: rq(51, 385867, 11459, 396194, { facebook: network(16, 1039, 96943) }) },
          { name: "reyeslaw.com", is_client: false, post_count: 33, by_channel: sample(["facebook"]), rivaliq_metrics: rq(33, 41623, 538, 33274, { facebook: network(9, 126, 11585) }) },
        ],
      },
    };
    const companies = normalizedCompetitiveMetrics(report).aggregates.companies as any[];
    const bader = companies[0];
    // 13 + 13 + 12 + 19 + 8 from Sprout, and X's 0 from RivalIQ, the platform Sprout does not cover.
    expect(bader.post_count).toBe(65);
    expect(bader.comparison_metrics.audience.current).toBe(8367 + 5169 + 42 + 231);
    expect(bader.comparison_metrics.engagement.current).toBe(755 + 437 + 511 + 908 + 62);
    expect(bader.cadence_per_week).toBe(15.2);
    expect(bader.by_channel.facebook.post_count).toBe(13);
    expect(bader.by_channel.linkedin.post_count).toBe(8);
    expect(bader.by_channel.linkedin.engagement_rate_avg).toBe(62 / 2705);
    expect(bader.by_channel.twitter.post_count).toBe(0);
    // Across platforms LinkedIn is left out for every company: no competitor has LinkedIn impressions.
    expect(bader.engagement_rate_avg).toBe((755 + 437 + 511 + 908) / (235735 + 21477 + 90167 + 1747356));
    // X had no posts: it is not one of the networks the rate covers.
    expect([...bader.comparison_metrics.engagement_rate_networks].sort()).toEqual(["facebook", "instagram", "tiktok", "youtube"]);
    expect(bader.comparison_metrics.metric_scopes.impressions).toBe("sprout");
    const total = companies.reduce((n, c) => n + c.post_count, 0);
    expect(Math.round((bader.post_count / total) * 100)).toBe(33);
    const dims = Object.fromEntries((normalizedCompetitiveMetrics(report).ai_analysis.benchmark_scorecard as any).dimensions.map((d: any) => [d.dimension, d.client]));
    expect(dims).toMatchObject({ Audience: 13809, Engagement: 2673, Impressions: 235735 + 21477 + 90167 + 1747356 });
  });

  it("leaves a platform without impressions without a rate (LegaBot Facebook showed 304.19%)", () => {
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
    // Sprout's Facebook has no impressions: its posts count, its rate is none, never 304.19%.
    expect(legabot.by_channel.facebook.post_count).toBe(43);
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

  it("counts the same actions for every company: no clicks, saves or views, and no shares where the network hides them", () => {
    expect(engagementsOf("facebook", { applause: 469, conversation: 47, amplification: 24 })).toBe(540);
    expect(engagementsOf("instagram", { applause: 412, conversation: 43, amplification: 556 })).toBe(455);
    expect(engagementsOf("youtube", { applause: 708, conversation: 5, amplification: 10 })).toBe(713);
    expect(engagementsOf("linkedin", { applause: 57, conversation: 1 })).toBe(58);
    expect(engagementsOf("tiktok", {})).toBeNull();
  });

  it("uses the same definitions for the client's own Sprout performance (Bader Law, September 2026)", () => {
    // Sprout's engagements total adds clicks: 963 on Facebook where reactions, comments and shares are 540.
    expect(sproutEngagements({ engagements: 963, reactions: 469, comments: 47, shares: 24, link_clicks: 49 }, "Facebook")).toBe(540);
    expect(sproutEngagements({ engagements: 1027, reactions: 412, comments: 43, shares: 556, saves: 12 }, "Instagram")).toBe(455);
    // Views are YouTube's reach.
    expect(sproutEngagementRate({ reactions: 708, comments: 5, shares: 10, impressions: 0, video_views: 1581992 }, "YouTube")).toBe(713 / 1581992);
    expect(sproutEngagementRate({ reactions: 5, impressions: 0 })).toBeNull();
    const current = (shares: number, comments: number, reactions: number, engagements: number, impressions: number, video_views: number, link_clicks = 0) => ({ shares, comments, reactions, engagements, impressions, video_views, link_clicks });
    const rd = { sprout_performance: {
      overall_totals: { engagements: 3341, impressions: 996405, reactions: 1987, comments: 109, shares: 632, link_clicks: 223, video_views: 1851832 },
      platform_breakdown: [
        { network: "Facebook", post_count: 13, current: current(24, 47, 469, 963, 846738, 205032, 49) },
        { network: "Instagram", post_count: 15, current: current(556, 43, 412, 1027, 102229, 19679) },
        { network: "TikTok", post_count: 12, current: current(42, 13, 341, 396, 44167, 44167) },
        { network: "LinkedIn", post_count: 8, current: current(0, 1, 57, 232, 3271, 962, 174) },
        { network: "YouTube", post_count: 19, current: current(10, 5, 708, 723, 0, 1581992) },
      ],
      top_posts: [{ platform: "LINKEDIN", reactions: 10, comments: 2, shares: 1, link_clicks: 210, engagements: 223, impressions: 900 }],
    } };
    const figures = socialPeriodFigures(rd.sprout_performance);
    expect(figures.engagements.current).toBe(540 + 455 + 396 + 58 + 713);
    expect(figures.reach.current).toBe(846738 + 102229 + 44167 + 3271 + 1581992);
    expect(figures.engagement_rate.current).toBe(2162 / 2578397);
    const shown = normalizedSocialReport(rd).sprout_performance as any;
    expect(shown.overall_totals.engagements).toBe(2162);
    expect(shown.platform_breakdown[0].current.engagements).toBe(540);
    // A 210-click post is 13 engagements, the count the card shows and ranks by.
    expect(shown.top_posts[0].engagement).toBe(13);
  });
});
