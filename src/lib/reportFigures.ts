/**
 * The monthly report's own figures, each with one definition that every
 * screen reads: the report page, Analytics and its insight tiles.
 */

import { engagementRate } from "@/lib/competitiveMetrics";

type Totals = Record<string, unknown> | null | undefined;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Engagements for a post, a platform or a period: Sprout's own engagements
 * total when the report stored it, otherwise reactions, comments, shares and
 * link clicks added up (reports written before the total was collected).
 */
export function sproutEngagements(m: Totals): number | null {
  if (!m) return null;
  const total = num(m.engagements) ?? num(m.engagement);
  if (total != null) return total;
  const parts = [num(m.reactions) ?? num(m.likes), num(m.comments), num(m.shares), num(m.link_clicks)];
  return parts.some((p) => p != null) ? parts.reduce<number>((sum, p) => sum + (p ?? 0), 0) : null;
}

/** Impressions for a post, a platform or a period, with views standing in where no impressions were reported. */
export function sproutImpressions(m: Totals): number | null {
  if (!m) return null;
  return num(m.impressions) ?? num(m.views) ?? num(m.video_views);
}

/**
 * The client's own engagement rate: engagements divided by impressions, the
 * definition every competitive figure uses too (engagementRate in
 * reportMetrics.ts). Null when there are no impressions.
 */
export function sproutEngagementRate(m: Totals): number | null {
  return engagementRate(sproutEngagements(m), sproutImpressions(m));
}

type ReportData = Record<string, any> | null | undefined;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);

/**
 * What a monthly report holds, counted the same way everywhere.
 *
 * postsAnalyzed: the posts Sprout measured in the period, across every
 * connected profile (the top-posts list is only the best ten of them).
 * recommendations: the actions the report recommends (competitive takeaways,
 * pillar recommendations and trend opportunities).
 * calendarPosts: posts in the report's own calendar, which reports since
 * 19 Oct 2026 no longer write.
 */
export function reportCounts(rd: ReportData): { postsAnalyzed: number | null; recommendations: number; calendarPosts: number; tiktokTrends: number; instagramTrends: number } {
  const data = (Array.isArray(rd) ? rd[0] : rd) as Record<string, any> | null | undefined;
  const sp = data?.sprout_performance || {};
  const breakdown: any[] = Array.isArray(sp.platform_breakdown) && sp.platform_breakdown.length ? sp.platform_breakdown : Object.values(sp.platform_metrics || {});
  const counts = breakdown.map((p) => num(p?.post_count)).filter((n): n is number => n != null);
  const ai = data?.ai_analysis || {};
  const calendar: any[] = Array.isArray(data?.content_calendar) ? data!.content_calendar : Array.isArray(ai.content_calendar) ? ai.content_calendar : [];
  return {
    postsAnalyzed: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    recommendations: strings(ai.competitive_takeaways).length
      + strings(ai.sprout_performance_analysis?.pillar_alignment?.recommendations).length
      + strings(ai.tiktok_trends_analysis?.opportunities_for_client).length
      + strings(ai.instagram_trends_analysis?.opportunities_for_client).length,
    calendarPosts: calendar.reduce((n, day) => n + (Array.isArray(day?.posts) ? day.posts.length : 0), 0),
    tiktokTrends: num(data?.data_counts?.tiktok_trends) ?? (Array.isArray(data?.tiktok_trends?.posts) ? data!.tiktok_trends.posts.length : 0),
    instagramTrends: num(data?.data_counts?.instagram_trends) ?? (Array.isArray(data?.instagram_trends?.posts) ? data!.instagram_trends.posts.length : 0),
  };
}
