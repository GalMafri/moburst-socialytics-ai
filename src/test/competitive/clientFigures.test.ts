// The client's own figures from Sprout (Lital, 20 Oct 2026), proved on Bader
// Law's stored September 2026 competitive report (1c4f4805): its figures
// counted again from the posts the report stored, ads left out, and read the
// way every screen reads them.

import { describe, expect, it } from "vitest";
import { normalizedCompetitiveMetrics } from "@/lib/competitiveMetrics";
import { competitiveReportQuality } from "../../../supabase/functions/_shared/competitive/reportEvidence";
import { clientFiguresFromStoredPosts } from "../../../supabase/functions/_shared/competitive/storedFigures";
import { companyPostSample, postsInPeriod } from "../../../supabase/functions/_shared/competitive/postSample";
import { ownedPostTotals } from "../../../supabase/functions/_shared/competitive/ownedSource";
import { BADER_POSTS, BADER_REPORT } from "./fixtures/bader20260930";

const shown = (report: unknown) => normalizedCompetitiveMetrics(report).aggregates.companies as any[];
const share = (companies: any[]) => Math.round((companies[0].post_count / companies.reduce((n, c) => n + c.post_count, 0)) * 100);

describe("the client's figures from Sprout, counted from the report's own posts", () => {
  const repaired = clientFiguresFromStoredPosts(BADER_REPORT, { socialPosts: BADER_POSTS });

  it("leaves the 29 ad rows out and counts YouTube's views as its impressions", () => {
    expect(repaired.changed).toBe(true);
    const owned = repaired.report_data.aggregates.companies[0].owned_metrics;
    expect(owned.published_posts_only).toBe(true);
    expect(owned.by_network.facebook.posts).toEqual({ current: 13, previous: null });
    expect(owned.by_network.facebook.engagement.current).toBe(755);
    expect(owned.by_network.facebook.impressions.current).toBe(235735);
    // Three September videos have no view count yet: none observed, as a missing action is.
    expect(owned.by_network.youtube.impressions.current).toBe(1747356);
    expect(owned.by_network.youtube.posts.current).toBe(19);
    expect(owned.by_network.instagram.posts).toEqual({ current: 13, previous: 8 });
    expect(repaired.changes).toEqual(expect.arrayContaining([
      { network: "facebook", field: "posts", before: 42, after: 13 },
      { network: "youtube", field: "impressions", before: null, after: 1747356 },
    ]));
    expect(repaired.report_data.aggregates.total_posts_analyzed).toBe(228 - 29);
    expect(repaired.original_client).toBe(BADER_REPORT.aggregates.companies[0]);
  });

  it("shows Bader's September figures from Sprout: 65 posts, 33% share of voice, 15.2 a week, 13,809 followers", () => {
    const [bader, topdog, morgan, reyes] = shown(repaired.report_data);
    expect(bader.post_count).toBe(65);
    expect(share([bader, topdog, morgan, reyes])).toBe(33);
    expect(bader.cadence_per_week).toBe(15.2);
    expect(bader.comparison_metrics.audience.current).toBe(13809);
    expect(bader.comparison_metrics.engagement.current).toBe(2673);
    expect((bader.engagement_rate_avg * 100).toFixed(2)).toBe("0.12");
    expect(bader.engagement_rate_avg).toBe((755 + 437 + 511 + 908) / (235735 + 21477 + 90167 + 1747356));
    const rates = Object.fromEntries(Object.entries(bader.by_channel).map(([k, b]: [string, any]) => [k, b.engagement_rate_avg == null ? null : +(b.engagement_rate_avg * 100).toFixed(2)]));
    expect(rates).toEqual({ facebook: 0.32, instagram: 2.03, tiktok: 0.57, youtube: 0.05, linkedin: 2.29, twitter: null });
    // Competitors keep RivalIQ's figures.
    expect([topdog, morgan, reyes].map((c) => +(c.engagement_rate_avg * 100).toFixed(2))).toEqual([1.28, 2.89, 1.62]);
    expect([topdog, morgan, reyes].map((c) => c.post_count)).toEqual([50, 51, 33]);
  });

  it("rebuilds the client's post sample without the ad rows, so the report still passes its checks", () => {
    const bader = repaired.report_data.aggregates.companies[0];
    expect(bader.observed_post_count).toBe(65);
    expect(bader.by_channel.facebook.observed_post_count).toBe(13);
    expect(Object.values(bader.by_weekday as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(65);
    expect(competitiveReportQuality(repaired.report_data).ready).toBe(true);
  });

  it("before the stored posts are counted again, the stored figures still show the ads (what the job replaces)", () => {
    const [bader] = shown(BADER_REPORT);
    expect(bader.post_count).toBe(94);
    // Sprout's stored YouTube figures had no impressions: no YouTube rate, never another source's.
    expect(bader.by_channel.youtube.engagement_rate_avg).toBeNull();
  });

  it("changes nothing a second time, nor a report without Sprout figures or stored posts", () => {
    expect(clientFiguresFromStoredPosts(repaired.report_data, { socialPosts: BADER_POSTS }).changed).toBe(false);
    expect(clientFiguresFromStoredPosts(BADER_REPORT, null).changed).toBe(false);
    const noOwned = { ...BADER_REPORT, aggregates: { ...BADER_REPORT.aggregates, companies: BADER_REPORT.aggregates.companies.map((c: any) => ({ ...c, owned_metrics: undefined })) } };
    expect(clientFiguresFromStoredPosts(noOwned, { socialPosts: BADER_POSTS }).changed).toBe(false);
  });
});

describe("the shared post sample and owned totals", () => {
  it("counts a period's posts once, leaves ads out, and dates X posts from their native id", () => {
    const rows = [
      { postId: "sprout:p:1", source: "sprout", companyId: "1", channel: "facebook", publishedAt: "2026-09-02T10:00:00Z", engagementTotal: 5 },
      { postId: "sprout:p:1", source: "sprout", companyId: "1", channel: "facebook", publishedAt: "2026-09-02T10:00:00Z", engagementTotal: 5 },
      { postId: "sprout:fa:9_1", source: "sprout", companyId: "1", channel: "facebook", publishedAt: "2026-09-02T10:00:01Z", engagementTotal: 0 },
      { postId: "x1", companyId: "1", channel: "twitter", postNativeId: "2092944952070181123" },
      { postId: "late", companyId: "1", channel: "instagram", publishedAt: "2026-10-01T00:00:00Z" },
      { postId: "other", companyId: "2", channel: "instagram", publishedAt: "2026-09-03T00:00:00Z" },
    ];
    const posts = postsInPeriod(rows, "2026-08-01", "2026-09-30", new Set(["1"]));
    expect(posts.map((p) => p.postId)).toEqual(["sprout:p:1", "x1"]);
    const sample = companyPostSample(posts, 61);
    expect(sample.observed_post_count).toBe(2);
    expect(sample.by_channel.facebook.observed_post_count).toBe(1);
    expect(sample.channel_mix).toEqual([{ key: "facebook", count: 1 }, { key: "twitter", count: 1 }]);
  });

  it("sums a platform's reach from the posts that report one", () => {
    expect(ownedPostTotals([{ channel: "youtube", engagementTotal: 6, views: 100 }, { channel: "youtube", engagementTotal: 0, views: null }])).toEqual({ posts: 2, engagement: 6, impressions: 100 });
    expect(ownedPostTotals([{ channel: "facebook", engagementTotal: 1, ownedImpressions: null }])).toEqual({ posts: 1, engagement: 1, impressions: null });
    expect(ownedPostTotals([])).toEqual({ posts: 0, engagement: 0, impressions: 0 });
  });
});
