// The monthly (social) report's own figures, with the definitions every
// competitive figure uses (reportMetrics.ts), so the client's numbers are
// counted one way on every screen, the public API and the report text:
//
//   engagements      reactions or likes, comments, and shares where the
//                    network shows them (not Instagram or YouTube). Never
//                    clicks, saves, story replies or views. A report stored
//                    Sprout's own engagements total, which adds clicks; it is
//                    worked out again from the parts the report stored.
//   reach            views on TikTok and YouTube, impressions elsewhere.
//   engagement rate  engagements divided by reach, platform by platform, and
//                    across platforms the engagements of the platforms with a
//                    reach figure over their reach.
//
// normalizedSocialReport applies them to a stored report when it is read;
// the stored row is never rewritten for a definition.

import { engagementRate, engagementsOf, isVideoNetwork } from "../competitive/reportMetrics.ts";

// deno-lint-ignore no-explicit-any
type Figures = Record<string, any> | null | undefined;
// deno-lint-ignore no-explicit-any
type Any = any;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The network a post, a platform or a period figure set belongs to, when it says. */
function networkOf(m: Figures, network?: unknown): string {
  return String(network ?? m?.network ?? m?.platform_display ?? m?.platform ?? m?.network_type ?? "").toLowerCase();
}

/** Engagements of a post, a platform or a period, by the one rule. Null when none of the parts is known. */
export function sproutEngagements(m: Figures, network?: unknown): number | null {
  if (!m) return null;
  return engagementsOf(networkOf(m, network), { applause: num(m.reactions) ?? num(m.likes), conversation: num(m.comments), amplification: num(m.shares) });
}

/** Reach of a post, a platform or a period: views on video networks, impressions elsewhere. */
export function sproutReach(m: Figures, network?: unknown): number | null {
  if (!m) return null;
  const views = num(m.video_views) ?? num(m.views);
  return isVideoNetwork(networkOf(m, network)) && views != null && views > 0 ? views : num(m.impressions);
}

/** A post's or a platform's engagement rate: engagements divided by reach. */
export function sproutEngagementRate(m: Figures, network?: unknown): number | null {
  return engagementRate(sproutEngagements(m, network), sproutReach(m, network));
}

const change = (current: number | null, previous: number | null) => {
  if (current == null || previous == null) return { current, previous, absolute: null, percent: null };
  const percent = previous === 0 ? (current > 0 ? null : 0) : Math.round(((current - previous) / previous) * 1000) / 10;
  return { current, previous, absolute: current - previous, percent };
};

/** The platforms of a stored report's performance section, current and previous. */
function platformsOf(sp: Figures): Array<{ network: string; current: Any; previous: Any }> {
  const breakdown: Any[] = Array.isArray(sp?.platform_breakdown) ? sp!.platform_breakdown : [];
  if (breakdown.length) return breakdown.map((p) => ({ network: String(p?.network ?? ""), current: p?.current, previous: p?.previous }));
  return Object.entries(sp?.platform_metrics || {}).map(([network, m]) => ({ network, current: m, previous: null }));
}

export type SocialPeriodFigures = {
  engagements: { current: number | null; previous: number | null };
  reach: { current: number | null; previous: number | null };
  engagement_rate: { current: number | null; previous: number | null };
  /** The engagements the rate counts: those of the platforms with a reach figure. */
  rate_engagements: { current: number | null; previous: number | null };
  /** The platforms the cross-platform rate covers. */
  rate_networks: string[];
};

/**
 * A period's engagements, reach and engagement rate across the client's
 * platforms, added up platform by platform so each platform is counted by
 * its own rule. A report with no platform figures falls back to its totals.
 */
export function socialPeriodFigures(sp: Figures): SocialPeriodFigures {
  const platforms = platformsOf(sp).filter((p) => p.network && p.network.toLowerCase() !== "unknown");
  const totals = (which: "current" | "previous") => {
    const sets = platforms.map((p) => ({ network: p.network, m: p[which] })).filter((x) => x.m);
    if (!sets.length) {
      const m = which === "current" ? (sp?.overall_totals || sp?.month_comparison?.current_month) : sp?.month_comparison?.previous_month;
      const engagements = sproutEngagements(m, "");
      const reach = num(m?.impressions);
      return { engagements, reach, rate: engagementRate(engagements, reach), rated: reach != null ? engagements : null, networks: [] as string[] };
    }
    const engagementValues = sets.map((x) => sproutEngagements(x.m, x.network));
    const engagements = engagementValues.some((v) => v != null) ? engagementValues.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
    const rated = sets.filter((x) => sproutEngagements(x.m, x.network) != null && sproutReach(x.m, x.network) != null);
    const reach = rated.length ? rated.reduce((a, x) => a + (sproutReach(x.m, x.network) as number), 0) : null;
    const ratedEngagements = rated.reduce((a, x) => a + (sproutEngagements(x.m, x.network) as number), 0);
    return { engagements, reach, rate: rated.length ? engagementRate(ratedEngagements, reach) : null, rated: rated.length ? ratedEngagements : null, networks: rated.map((x) => x.network) };
  };
  const current = totals("current"), previous = totals("previous");
  return {
    engagements: { current: current.engagements, previous: previous.engagements },
    reach: { current: current.reach, previous: previous.reach },
    engagement_rate: { current: current.rate, previous: previous.rate },
    rate_engagements: { current: current.rated, previous: previous.rated },
    rate_networks: current.networks,
  };
}

// A figure set gets the one count where its parts are stored; one without them is left as it was.
const withEngagements = (m: Any, network: unknown) => {
  if (!m || typeof m !== "object") return m;
  const engagements = sproutEngagements(m, network);
  return engagements == null ? m : { ...m, engagements };
};
const postWithEngagements = (p: Any) => {
  if (!p || typeof p !== "object") return p;
  const engagements = sproutEngagements(p);
  return engagements == null ? p : { ...p, engagements, engagement: engagements };
};

/**
 * A stored monthly report with its figures counted by the one rule: every
 * engagements figure (per platform, per period, per post, and their changes)
 * worked out again from the reactions, comments and shares the report
 * stored, and the period's engagement rate added. Everything else is kept.
 */
export function normalizedSocialReport<T>(input: T): T {
  const rd = (Array.isArray(input) ? input[0] : input) as Any;
  if (!rd || typeof rd !== "object" || !rd.sprout_performance || typeof rd.sprout_performance !== "object") return rd as T;
  const sp = rd.sprout_performance;
  const platform_breakdown = Array.isArray(sp.platform_breakdown) ? sp.platform_breakdown.map((p: Any) => {
    if (!p || typeof p !== "object" || !p.current || typeof p.current !== "object") return p;
    const current = withEngagements(p.current, p.network);
    const previous = withEngagements(p.previous, p.network);
    return {
      ...p, current, ...(p.previous ? { previous } : {}),
      ...(p.changes && typeof p.changes === "object" ? { changes: { ...p.changes, engagements: change(current?.engagements ?? null, previous?.engagements ?? null) } } : {}),
    };
  }) : sp.platform_breakdown;
  const platform_metrics = sp.platform_metrics && typeof sp.platform_metrics === "object"
    ? Object.fromEntries(Object.entries(sp.platform_metrics).map(([network, m]) => [network, withEngagements(m, network)]))
    : sp.platform_metrics;
  const figures = socialPeriodFigures({ ...sp, platform_breakdown, platform_metrics });
  const mc = sp.month_comparison && typeof sp.month_comparison === "object" ? sp.month_comparison : null;
  const month_comparison = mc ? {
    ...mc,
    ...(mc.current_month && figures.engagements.current != null ? { current_month: { ...mc.current_month, engagements: figures.engagements.current } } : {}),
    ...(mc.previous_month && figures.engagements.previous != null ? { previous_month: { ...mc.previous_month, engagements: figures.engagements.previous } } : {}),
    ...(mc.changes && typeof mc.changes === "object" && figures.engagements.current != null ? { changes: { ...mc.changes, engagements: change(figures.engagements.current, figures.engagements.previous) } } : {}),
    // The workflow's one-line summaries carried the old engagements count; the screens build their own lines.
    ...(Array.isArray(mc.summary) ? { summary: mc.summary.filter((line: unknown) => !/^engagements\b/i.test(String(line))) } : {}),
  } : mc;
  const top_posts_by_platform = sp.top_posts_by_platform && typeof sp.top_posts_by_platform === "object"
    ? Object.fromEntries(Object.entries(sp.top_posts_by_platform).map(([k, posts]) => [k, Array.isArray(posts) ? posts.map(postWithEngagements) : posts]))
    : sp.top_posts_by_platform;
  return {
    ...rd,
    sprout_performance: {
      ...sp,
      ...(sp.platform_breakdown ? { platform_breakdown } : {}),
      ...(sp.platform_metrics ? { platform_metrics } : {}),
      ...(sp.overall_totals && typeof sp.overall_totals === "object" && figures.engagements.current != null ? { overall_totals: { ...sp.overall_totals, engagements: figures.engagements.current } } : {}),
      ...(mc ? { month_comparison } : {}),
      ...(Array.isArray(sp.top_posts) ? { top_posts: sp.top_posts.map(postWithEngagements) } : {}),
      ...(sp.top_posts_by_platform ? { top_posts_by_platform } : {}),
      ...(figures.engagement_rate.current != null ? { engagement_rate: figures.engagement_rate, reach: figures.reach, engagement_rate_networks: figures.rate_networks } : {}),
    },
  } as T;
}
