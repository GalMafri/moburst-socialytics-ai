// The client's own Sprout figures (Lital, 20 Oct 2026: "use the most
// accurate measurement, the team typically works with sprout for their
// clients"). The team checks the monthly report against Sprout's own screen,
// so the client's performance screens (the monthly report, Analytics, the
// social side of the public API) show Sprout's figures as Sprout reports
// them, and say so ("Sprout engagement rate"):
//
//   engagements      Sprout's own engagements total, which counts clicks
//                    where Sprout does; a report stored before that total
//                    was collected adds up reactions, comments, shares and
//                    link clicks.
//   impressions      Sprout's impressions, else its views.
//   engagement rate  Sprout engagements divided by Sprout impressions.
//
// Comparisons with competitors use the comparable definition instead
// (reportMetrics.ts engagementsOf and engagementRate: likes, comments and
// shares, views as the impressions of video), because competitors have no
// click data. One module each; screens and the report-text check read these.

import { engagementRate } from "../competitive/reportMetrics.ts";

// deno-lint-ignore no-explicit-any
type Figures = Record<string, any> | null | undefined;

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
export function sproutEngagements(m: Figures): number | null {
  if (!m) return null;
  const total = num(m.engagements) ?? num(m.engagement);
  if (total != null) return total;
  const parts = [num(m.reactions) ?? num(m.likes), num(m.comments), num(m.shares), num(m.link_clicks)];
  return parts.some((p) => p != null) ? parts.reduce<number>((sum, p) => sum + (p ?? 0), 0) : null;
}

/** Impressions for a post, a platform or a period, with views standing in where no impressions were reported. */
export function sproutImpressions(m: Figures): number | null {
  if (!m) return null;
  return num(m.impressions) ?? num(m.views) ?? num(m.video_views);
}

/** The client's Sprout engagement rate: Sprout engagements divided by Sprout impressions. Null when there are no impressions. */
export function sproutEngagementRate(m: Figures): number | null {
  return engagementRate(sproutEngagements(m), sproutImpressions(m));
}
