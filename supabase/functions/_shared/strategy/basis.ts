// supabase/functions/_shared/strategy/basis.ts
//
// How sure a strategy can be about each platform (spec: docs/superpowers/
// specs/2026-11-03-strategy-v2-design.md, section 3, "How confidence is
// stated"), worked out in code from the data, never by the writer:
//   measured  Sprout has the client's account there: impressions, reach;
//   public    12 or more public posts in 90 days (about one a week);
//   thin      1 to 11 public posts;
//   none      no profile found, or no posts.
// Only Sprout measures reach. A public rate is engagement per view, and only
// where the platform shows views publicly (TikTok, YouTube); an estimated
// reach is never a baseline or a target. LinkedIn's public read gives no
// follower count. A goal on a thin or none platform may only use posts a week
// or followers.

import { GOAL_METRICS, type GoalMetric } from "./sections.ts";

export type Basis = "measured" | "public" | "thin" | "none";
export type RateKind = "impression" | "view";

/** Public posts in 90 days for a public basis: about one a week. */
export const PUBLIC_MIN_POSTS = 12;

/** Platforms whose public posts show their views. */
const PUBLIC_VIEWS = new Set(["TikTok", "YouTube"]);

export function basisOf(i: { sprout: boolean; posts: number }): Basis {
  if (i.sprout) return "measured";
  if (i.posts >= PUBLIC_MIN_POSTS) return "public";
  if (i.posts >= 1) return "thin";
  return "none";
}

/** What the platform's rate is per: impressions with Sprout, views where the public sees them, else no rate. */
export function rateKindOf(platform: string, basis: Basis): RateKind | null {
  if (basis === "measured") return "impression";
  if (basis === "public" && PUBLIC_VIEWS.has(platform)) return "view";
  return null;
}

/** A platform's numbers, as the strategy keeps them. */
export interface PlatformFigures {
  platform: string;
  basis: Basis;
  posts: number;
  posts_per_week: number;
  median_engagement: number | null;
  /** Engagement per impression (measured) or per view (public TikTok, YouTube); null otherwise. */
  rate: number | null;
  rate_kind: RateKind | null;
  followers: number | null;
}

/** The metrics a goal on this platform may use: each one has a figure, and the basis allows it. */
export function metricsFor(f: Pick<PlatformFigures, "basis" | "median_engagement" | "rate" | "rate_kind" | "followers">): GoalMetric[] {
  const solid = f.basis === "measured" || f.basis === "public";
  return GOAL_METRICS.filter((m) => {
    if (m === "posts_per_week") return true;
    if (m === "followers") return f.followers !== null && f.followers !== undefined;
    if (m === "median_engagement") return solid && f.median_engagement !== null && f.median_engagement !== undefined;
    return solid && f.rate_kind !== null && f.rate !== null && f.rate !== undefined;
  });
}

/** Today's figure for a goal's metric. */
export function baselineFor(f: PlatformFigures | undefined, metric: GoalMetric): number | null {
  if (!f) return null;
  if (metric === "posts_per_week") return f.posts_per_week;
  if (metric === "median_engagement") return f.median_engagement;
  if (metric === "engagement_rate") return f.rate;
  return f.followers;
}

/** One platform's basis in words, for the page's data line and the writer. */
export function basisWords(f: Pick<PlatformFigures, "platform" | "basis" | "followers" | "posts">): string {
  if (f.basis === "measured") return `${f.platform} from Sprout`;
  if (f.basis === "none") return `${f.platform}: no public posts found`;
  const thin = f.basis === "thin" ? `, ${f.posts} in 90 days` : "";
  const followers = f.followers === null ? ", no follower count" : "";
  return `${f.platform} public posts${thin}${followers}`;
}

/** "Data: Instagram from Sprout | TikTok public posts | LinkedIn public posts, no follower count". */
export function dataLine(figures: Array<Pick<PlatformFigures, "platform" | "basis" | "followers" | "posts">>): string {
  return figures.length ? `Data: ${figures.map(basisWords).join(" | ")}` : "";
}

/** "Based on public posts from 5 Aug to 2 Nov 2026", the deck's one factual line; "" when every platform is measured. */
export function publicWindowLine(figures: Array<Pick<PlatformFigures, "basis">>, window: { start: string; end: string } | null): string {
  if (!window || !figures.some((f) => f.basis === "public" || f.basis === "thin")) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const words = (d: string, year: boolean) => {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return `${day} ${months[m - 1]}${year ? ` ${y}` : ""}`;
  };
  const sameYear = window.start.slice(0, 4) === window.end.slice(0, 4);
  return `Based on public posts from ${words(window.start, !sameYear)} to ${words(window.end, true)}`;
}
