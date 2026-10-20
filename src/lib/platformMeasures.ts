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

import { platformKey } from "./display";

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
