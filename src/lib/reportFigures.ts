/**
 * The monthly report's own figures, each with one definition that every
 * screen reads: the report page, Analytics and its insight tiles.
 */

// The client's own Sprout figures, one definition shared with the server and
// the report-text check (supabase/functions/_shared/reports/socialFigures.ts).
export { sproutEngagementRate, sproutEngagements, sproutImpressions } from "../../supabase/functions/_shared/reports/socialFigures";
import { shownSocial, type ShownInsightsRow } from "../../supabase/functions/_shared/reports/shownFields";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

type ReportData = Record<string, any> | null | undefined;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);

/** A stored weekly theme, as much of it as the report's trends read (useTrendThemes' TrendTheme). */
export interface StoredThemeLike {
  title?: string | null;
  angle?: string | null;
}

/** One trend recommendation: what to do, and the title of the theme it comes from (none for a report's own opportunity). */
export interface TrendItem {
  text: string;
  theme?: string;
}

/** Which trends a monthly report shows, and the trend recommendations it makes (reportTrends). */
export interface ReportTrends {
  /**
   * "industry": the period's stored themes, or the report's own industry_trends_analysis.
   * "own": the report's TikTok and Instagram trends, as before stored trends.
   * "pending": the themes are still being read and the report has no industry analysis: no trend shows yet.
   */
  source: "industry" | "own" | "pending";
  /** The trend recommendations, in the order every part of the report lists them. Empty while held. */
  items: TrendItem[];
  /** How many industry themes the report shows (0 unless source is "industry"; 0 while held). */
  themes: number;
  /**
   * The stored themes are still being read: every figure they change (the
   * trend recommendations, the recommendations count, the theme count) waits,
   * so no number shows and then changes when they arrive.
   */
  held: boolean;
}

/**
 * The stored themes that belong to a report: those of the weeks whose Monday
 * (week_start) falls inside its period, both ends included. One rule with the
 * API's industry_trends and the in-app report. trend_themes_in_range answers
 * a window by overlap, for Analytics' arbitrary windows, so a week that starts
 * in the month before is in its answer for a month and not on that month's
 * report. Dismissed themes and posts the tripwire flagged are never in the
 * answer.
 */
export function themesInPeriod<T extends { week_start?: string | null }>(themes: readonly T[] | null | undefined, start: string | null | undefined, end: string | null | undefined): T[] {
  const from = String(start ?? "").slice(0, 10);
  const to = String(end ?? "").slice(0, 10);
  if (!themes || !from || !to) return [];
  return themes.filter((t) => {
    const week = String(t.week_start ?? "").slice(0, 10);
    return !!week && week >= from && week <= to;
  });
}

/** The report's own industry trends analysis (written from the stored themes since Trends Task 16), normalized; null when it has none. */
export interface IndustryTrendsAnalysis {
  overview: string;
  themes: Array<{ title: string; platforms: string[]; note: string }>;
  opportunities: string[];
  takeaways: string[];
}

const words = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** ai_analysis.industry_trends_analysis as the screens read it; null when the report has none, or one with nothing in it. */
export function industryTrendsAnalysis(aiAnalysis: unknown): IndustryTrendsAnalysis | null {
  const a = record(record(aiAnalysis)?.industry_trends_analysis);
  if (!a) return null;
  const out: IndustryTrendsAnalysis = {
    overview: words(a.overview),
    themes: (Array.isArray(a.themes) ? a.themes : [])
      .map((t) => record(t))
      .map((t) => ({ title: words(t?.title), platforms: strings(t?.platforms), note: words(t?.note) }))
      .filter((t) => t.title || t.note),
    opportunities: strings(a.opportunities_for_client).map((t) => t.trim()),
    takeaways: strings(a.key_takeaways).map((t) => t.trim()),
  };
  return out.overview || out.themes.length || out.opportunities.length || out.takeaways.length ? out : null;
}

/**
 * Which trends a monthly report shows, and the trend recommendations it
 * makes, read one way by every part of the report: the Trends tab, "Where to
 * act next", Weekly highlights and the counts (design
 * docs/superpowers/specs/2026-10-28-trends-redesign-design.md, "Monthly
 * report", Lital's option A; Trends plan Task 15).
 *
 * When stored weekly themes belong to the report's period (themesInPeriod),
 * the report shows them in one Industry trends section, whichever engine
 * wrote it. A report whose own analysis has industry trends (Task 16) shows
 * that section too. Either way the report's own TikTok and Instagram trends
 * are not shown. Its trend recommendations are what the section lists: the
 * analysis' opportunities when it has them, otherwise the themes' angles,
 * each under its theme's title (an angle repeated in a later week is listed
 * once).
 *
 * A report with no stored theme in its period, read and answered, shows its
 * own TikTok and Instagram trends and opportunities, as before.
 *
 * While the themes are being read (`pending`, which a read that did not
 * answer stays in: useTrendThemes' untilRead) the report shows neither kind,
 * and every figure the themes change is held.
 *
 * `themes` are the stored themes that belong to the report's period, newest
 * week first; null or empty when there are none.
 */
export function reportTrends(aiAnalysis: unknown, themes: readonly StoredThemeLike[] | null | undefined, opts: { pending?: boolean } = {}): ReportTrends {
  const ai = record(aiAnalysis);
  const held = !!opts.pending;
  const stored = !held && Array.isArray(themes) && themes.length > 0 ? themes : null;
  const analysis = industryTrendsAnalysis(ai);
  if (stored || analysis) {
    if (held) return { source: "industry", items: [], themes: 0, held };
    const items: TrendItem[] = [];
    if (analysis?.opportunities.length) {
      for (const text of analysis.opportunities) items.push({ text });
    } else {
      for (const t of stored ?? []) {
        const text = words(t.angle);
        const theme = words(t.title);
        if (text && !items.some((i) => i.text === text)) items.push(theme ? { text, theme } : { text });
      }
    }
    return { source: "industry", items, themes: stored?.length ?? analysis?.themes.length ?? 0, held };
  }
  if (held) return { source: "pending", items: [], themes: 0, held };
  const own = [...strings(record(ai?.tiktok_trends_analysis)?.opportunities_for_client), ...strings(record(ai?.instagram_trends_analysis)?.opportunities_for_client)];
  return { source: "own", items: own.map((text) => ({ text })), themes: 0, held };
}

/**
 * What a monthly report holds, counted the same way everywhere.
 *
 * postsAnalyzed: the posts Sprout measured in the period, across every
 * connected profile (the top-posts list is only the best ten of them).
 * recommendations: the actions the report recommends (competitive takeaways,
 * pillar recommendations and trend recommendations), as the page lists them:
 * through the one reading of a report (shownFields.ts), so a report with
 * insights counts its insights' recommendations, and through reportTrends, so
 * a report with stored themes counts their angles. A reader that reads no
 * themes (`trends` left out) counts the report's own trend opportunities.
 * calendarPosts: posts in the report's own calendar, which reports since
 * 19 Oct 2026 no longer write.
 * industryTrends: the industry themes the report shows (reportTrends).
 */
export function reportCounts(rd: ReportData, insights: ShownInsightsRow | null = null, trends: ReportTrends | null = null): { postsAnalyzed: number | null; recommendations: number; calendarPosts: number; tiktokTrends: number; instagramTrends: number; industryTrends: number } {
  const data = (Array.isArray(rd) ? rd[0] : rd) as Record<string, any> | null | undefined;
  const sp = data?.sprout_performance || {};
  const breakdown: any[] = Array.isArray(sp.platform_breakdown) && sp.platform_breakdown.length ? sp.platform_breakdown : Object.values(sp.platform_metrics || {});
  const counts = breakdown.map((p) => num(p?.post_count)).filter((n): n is number => n != null);
  const ai = data?.ai_analysis || {};
  const shown = shownSocial(ai, insights);
  const trend = trends ?? reportTrends(ai, null);
  const calendar: any[] = Array.isArray(data?.content_calendar) ? data!.content_calendar : Array.isArray(ai.content_calendar) ? ai.content_calendar : [];
  return {
    postsAnalyzed: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    recommendations: shown.takeaways.length + shown.recommendations.length + trend.items.length,
    calendarPosts: calendar.reduce((n, day) => n + (Array.isArray(day?.posts) ? day.posts.length : 0), 0),
    tiktokTrends: num(data?.data_counts?.tiktok_trends) ?? (Array.isArray(data?.tiktok_trends?.posts) ? data!.tiktok_trends.posts.length : 0),
    instagramTrends: num(data?.data_counts?.instagram_trends) ?? (Array.isArray(data?.instagram_trends?.posts) ? data!.instagram_trends.posts.length : 0),
    industryTrends: trend.source === "industry" ? trend.themes : 0,
  };
}
