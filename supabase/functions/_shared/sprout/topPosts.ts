// A client's top posts for a window, read live from Sprout (sprout-analytics).
//
// Posts are ranked by reach with the owned source's rule (ownedPostReach in
// competitive/ownedSource.ts): lifetime impressions, or on YouTube, where
// Sprout reports none, lifetime video views. Each network is asked for its
// own posts, sorted by the measure that network ranks on, so a YouTube
// channel's best videos are not cut off behind other networks' impressions,
// and one network's failed read costs only that network's posts.
//
// Sprout carries the creative of a post as visual_media; each post returns
// its picture (thumbnail_url) and media type so a page can copy it into our
// storage through post-preview, where the network's own page cannot be read.

import { ownedPostReach } from "../competitive/ownedSource.ts";
import { networkKey } from "./publishRules.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sprout answers untyped JSON.
type Any = any;

/** One Sprout analytics call: the path after the customer id, and its body. */
export type SproutPostCall = (path: string, body: unknown) => Promise<Any>;

export interface TopPostProfile {
  sprout_profile_id: number | string;
  network_type?: string | null;
}

export interface TopPost {
  permalink: string | null;
  text: string;
  posted_at: string | null;
  post_type: string | null;
  profile_id: number | string | null;
  /** Lifetime impressions as Sprout reports them (0 where it reports none, as on YouTube). */
  impressions: number;
  reactions: number;
  comments: number;
  shares: number;
  link_clicks: number;
  video_views: number;
  /** What the post is ranked on: impressions, or views for a YouTube post. */
  reach: number;
  /** The post's own picture, where Sprout gave one. */
  thumbnail_url: string | null;
  media_type: string | null;
}

/** How many posts a window shows. */
export const TOP_POSTS = 10;
/** How many posts each network is asked for. */
const PER_NETWORK = 20;

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : 0);
const VIDEO = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;

/** The measure Sprout sorts a network's posts on: the one the network is ranked by. */
export const sortMeasure = (network: string) => (network === "youtube" ? "lifetime.video_views" : "lifetime.impressions");

/** The request for one network's posts published in the window. */
export function topPostsRequest(profileIds: Array<number | string>, network: string, start: string, end: string) {
  return {
    timezone: "UTC",
    filters: [`customer_profile_id.eq(${profileIds.join(", ")})`, `created_time.in(${start}T00:00:00...${end}T23:59:59)`],
    metrics: ["lifetime.impressions", "lifetime.reactions", "lifetime.comments_count", "lifetime.shares_count", "lifetime.post_link_clicks", "lifetime.video_views"],
    fields: ["created_time", "perma_link", "text", "post_type", "visual_media"],
    sort: [`${sortMeasure(network)}:desc`],
    page: 1,
    limit: PER_NETWORK,
  };
}

/** A post's picture and media type from its visual_media (a video's file is not a picture). */
export function postCreative(row: Any): { thumbnail_url: string | null; media_type: string | null } {
  const list: Any[] = Array.isArray(row?.visual_media) ? row.visual_media : [];
  const media = list.find((m) => m && (m.thumbnail_url || m.media_url));
  if (!media) return { thumbnail_url: null, media_type: null };
  const url = media.thumbnail_url || (String(media.media_type || "").toLowerCase().includes("video") || VIDEO.test(String(media.media_url)) ? null : media.media_url);
  return { thumbnail_url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null, media_type: media.media_type ? String(media.media_type) : null };
}

/** One Sprout post row as a top post, for a post on the given network. */
export function topPostFromRow(row: Any, network: string): TopPost {
  const impressions = num(row.metrics?.["lifetime.impressions"]);
  const video_views = num(row.metrics?.["lifetime.video_views"]);
  const reach = ownedPostReach({ channel: network, ownedImpressions: network === "youtube" ? null : impressions, views: video_views }) ?? 0;
  return {
    permalink: row.perma_link || row.permalink || null,
    text: row.text || "",
    posted_at: row.created_time || null,
    post_type: row.post_type || null,
    profile_id: row.dimensions?.customer_profile_id ?? row.customer_profile_id ?? null,
    impressions,
    reactions: num(row.metrics?.["lifetime.reactions"]),
    comments: num(row.metrics?.["lifetime.comments_count"]),
    shares: num(row.metrics?.["lifetime.shares_count"]),
    link_clicks: num(row.metrics?.["lifetime.post_link_clicks"]),
    video_views,
    reach,
    ...postCreative(row),
  };
}

/** Posts by reach, highest first; equal reach keeps the newer post first. */
export function rankTopPosts<T extends { reach: number; posted_at: string | null }>(posts: T[], limit = TOP_POSTS): T[] {
  return [...posts].sort((a, b) => b.reach - a.reach || String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? ""))).slice(0, limit);
}

/**
 * The window's top posts across a client's profiles. A network whose read
 * fails is named in `failed` and the other networks' posts are kept.
 */
export async function readTopPosts(call: SproutPostCall, profiles: TopPostProfile[], start: string, end: string): Promise<{ posts: TopPost[]; failed: string[] }> {
  const groups = new Map<string, Array<number | string>>();
  for (const p of profiles) {
    const id = Number(p.sprout_profile_id);
    if (!Number.isFinite(id)) continue;
    const key = networkKey(p.network_type) || "other";
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const networks = [...groups.keys()];
  const results = await Promise.allSettled(networks.map((n) => call("analytics/posts", topPostsRequest(groups.get(n)!, n, start, end))));
  const posts: TopPost[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected" || !Array.isArray(r.value?.data)) {
      console.error(`[sprout-analytics] ${networks[i]} posts query failed:`, r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : r.reason) : "no data");
      failed.push(networks[i]);
      return;
    }
    for (const row of r.value.data) posts.push(topPostFromRow(row, networks[i]));
  });
  return { posts: rankTopPosts(posts), failed };
}
