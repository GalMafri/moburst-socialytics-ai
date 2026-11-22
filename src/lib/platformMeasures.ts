/**
 * Which measures a network's own analytics report. Sprout returns no value
 * for a measure a network does not have, and every aggregator (n8n's, the
 * in-app pipeline's, sprout-analytics) turns a missing value into 0, so a
 * screen would show "Link clicks 0" for Instagram: a zero that was never
 * measured. A screen shows a measure for a network only when the network
 * reports it.
 *
 * Read from the data on 20 Oct 2026: Sprout's own profile answers carry no
 * post_link_clicks for Instagram, and across every stored report (all
 * clients, every month) these were never above zero while the networks'
 * other measures were: Instagram and TikTok link clicks (35 and 15 months)
 * and YouTube impressions and link clicks (12 months, with millions of
 * views). Every other network and measure has real values.
 */

import { platformKey, platformName } from "./display";

export type Measure = "impressions" | "reactions" | "link_clicks" | "video_views" | "comments" | "shares";

const NOT_REPORTED: Record<string, readonly Measure[]> = {
  instagram: ["link_clicks"],
  tiktok: ["link_clicks"],
  youtube: ["impressions", "link_clicks"],
};

/** Whether the network reports this measure (an unknown network or measure is shown). */
export function reportsMeasure(network: string | null | undefined, measure: string): boolean {
  const key = platformKey(network);
  return !(NOT_REPORTED[key] ?? []).includes(measure as Measure);
}

/** The networks (named for people, each once, in the order given) whose own analytics report the measure. */
export function networksCovered(networks: ReadonlyArray<string | null | undefined>, measure: string): string[] {
  const out: string[] = [];
  for (const n of networks) {
    if (!n || !reportsMeasure(n, measure)) continue;
    const name = platformName(n);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The line under a headline tile when its total leaves out a network of the
 * client's that does not report the measure ("Facebook and LinkedIn only").
 * Null when every network reports it, or none does (the tile reads "No data").
 */
export function coverageLine(networks: ReadonlyArray<string | null | undefined>, measure: string): string | null {
  const all = new Set(networks.filter(Boolean).map((n) => platformName(n)));
  const covered = networksCovered(networks, measure);
  if (covered.length === 0 || covered.length === all.size) return null;
  const list = covered.length === 1 ? covered[0] : `${covered.slice(0, -1).join(", ")} and ${covered[covered.length - 1]}`;
  return `${list} only`;
}

/** The one way this page writes a count in a tile or a sentence: 8,323 reads 8.3K, 1,250,000 reads 1.3M. */
export function formatCount(v: number): string {
  // QA 22 Nov 2026: from 999,950 the thousands round to 1000.0, so the unit
  // is chosen on the rounded figure: those read 1.0M, never 1000.0K.
  if (v >= 999_950) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

