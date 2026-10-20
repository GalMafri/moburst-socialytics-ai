// The post sample a competitive report shows for each company: posts counted
// by weekday and hour, hashtags, formats, channels and the top posts. One
// implementation for the n8n Aggregate Competitive Data node (its code is
// this file followed by n8n/code/competitive-aggregate.js) and for the app,
// which rebuilds a stored report's client sample when the stored posts held
// rows that are not posts (storedFigures.ts).
//
// Every name declared here is exported and distinct: in the n8n node the
// file shares one scope with the node's own code.

import { isPublishedReportPost, postEngagementRate } from "./reportMetrics.ts";

// deno-lint-ignore no-explicit-any
type AnyPost = any;
// deno-lint-ignore no-explicit-any
type AnySample = any;

/**
 * The posts a report counts: dated inside the period (both dates included),
 * from the companies it compares, each post once, and never a row that is
 * not a post (Sprout's ads). X omits publishedAt in RivalIQ; its native post
 * id encodes the creation time: Twitter's published Snowflake implementation
 * uses a 22-bit shift and epoch 1288834974657. Dates are never inferred from
 * RivalIQ's own decimal postId.
 * https://github.com/twitter-archive/snowflake/blob/snowflake-2010/src/main/scala/com/twitter/service/snowflake/IdWorker.scala
 */
export function postsInPeriod(rawPosts: AnyPost[], start: string, end: string, allowedIds?: Set<string> | null): AnyPost[] {
  const dated = (post: AnyPost) => {
    if (post.publishedAt || post.published_at || post.created || post.created_at || post.date) return post;
    if (!["twitter", "x"].includes(String(post.channel || post.network || post.platform || "").toLowerCase())) return post;
    const id = post.postNativeId || post.nativeId;
    if (typeof id !== "string" || !/^[1-9]\d{14,18}$/.test(id)) return post;
    const value = BigInt(id);
    if (value > BigInt("9223372036854775807")) return post;
    const timestamp = Number((value >> BigInt(22)) + BigInt(1288834974657));
    if (timestamp > Date.now()) return post;
    return { ...post, publishedAt: new Date(timestamp).toISOString(), publication_date_source: "x_native_post_id" };
  };
  const seen = new Set<string>();
  return (rawPosts || []).map(dated).filter((post) => {
    if (allowedIds && !allowedIds.has(String(post.companyId))) return false;
    if (!isPublishedReportPost(post)) return false;
    const date = String(post.publishedAt || post.published_at || post.created || post.created_at || post.date || "").slice(0, 10);
    if (!date || date < start || date > end) return false;
    const key = String(post.postId || post.postLink || JSON.stringify([post.companyId, date, post.message]));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** An empty sample bucket, for a company or one of its channels. */
export function emptyPostSample(): AnySample {
  return { post_count: 0, likely_boosted_posts: 0, engagement_sum: 0, views_total: 0, views_observed: 0, impressions_total: 0, by_weekday: {}, by_hour: {}, hashtags: {}, media_types: {}, top_posts: [] };
}

/** Add one post to a bucket and return its channel. */
export function addPostToSample(agg: AnySample, p: AnyPost): string {
  const text = (s: unknown) => String(s || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  const amount = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : 0));
  // A missing provider observation is unknown, not a measured zero.
  const field = (k: string) => { if (!p || p[k] == null || p[k] === "") return null; const n = Number(p[k]); return isFinite(n) ? n : null; };
  // RivalIQ's paid signal on Facebook posts is a string: "Likely Boosted", "Not Likely Boosted" or "No Prediction".
  const boosted = typeof p.facebookLikelyBoosted === "string" ? p.facebookLikelyBoosted.trim().toLowerCase() === "likely boosted" : p.facebookLikelyBoosted === true;
  agg.post_count += 1;
  if (boosted) agg.likely_boosted_posts += 1;
  const engagement = amount(p.engagementTotal) || amount(p.engagement_total) || (amount(p.applause) + amount(p.conversation) + amount(p.amplification));
  const views = field("views") ?? field("youtubeViews") ?? field("tiktokViews") ?? field("facebookPostViews");
  const impressions = field("estimatedImpressions");
  // RivalIQ presenceReach is follower count near publication, not post reach.
  const followers_at_publication = field("presenceReach");
  agg.engagement_sum += engagement; agg.views_total += views || 0; if (views != null) agg.views_observed += 1; agg.impressions_total += impressions;
  const created = p.publishedAt || p.published_at || p.created || p.created_at || p.date;
  if (created) {
    const d = new Date(created);
    if (!isNaN(d.getTime())) {
      const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
      agg.by_weekday[wd] = (agg.by_weekday[wd] || 0) + 1;
      const hr = String(d.getUTCHours());
      agg.by_hour[hr] = (agg.by_hour[hr] || 0) + 1;
    }
  }
  const caption = text(p.message || p.text || p.caption || p.content || "");
  for (const t of (caption.match(/#[\p{L}0-9_]+/gu) || [])) agg.hashtags[t.toLowerCase()] = (agg.hashtags[t.toLowerCase()] || 0) + 1;
  const mtype = p.type || p.post_type || p.media_type || "unknown";
  agg.media_types[mtype] = (agg.media_types[mtype] || 0) + 1;
  const channel = p.channel || p.network || p.platform || "unknown";
  if (agg.channels) agg.channels[channel] = (agg.channels[channel] || 0) + 1;
  // One rate definition (reportMetrics.ts engagementRate): per impression, or per view on video, else none.
  const post = { source: p.source || "rivaliq", source_profile_name: p.source_profile_name || null, actual_impressions: field("ownedImpressions"), authorship: p.authorship || null, engagement, est_impressions: impressions, followers_at_publication, views, applause: field("applause"), conversation: field("conversation"), amplification: field("amplification"), text: caption.slice(0, 220), url: p.postLink || p.permalink || p.url || p.link || null, image: p.image || p.imageLarge || null, created: created || null, media_type: mtype, channel, likely_boosted: boosted, boosted_prediction: typeof p.facebookLikelyBoosted === "string" ? p.facebookLikelyBoosted : null };
  agg.top_posts.push({ ...post, engagement_rate: postEngagementRate(post) });
  return channel;
}

/** The n most frequent keys of a count map. */
export function topCounts(obj: Record<string, number>, n: number): Array<{ key: string; count: number }> {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
}

/** Close a bucket over a period of `days` days: averages, mixes and the five top posts. */
export function finalizePostSample(b: AnySample, days: number): AnySample {
  if (!b.views_observed) b.views_total = null;
  delete b.views_observed;
  b.engagement_avg = b.post_count ? Math.round((b.engagement_sum / b.post_count) * 10) / 10 : 0;
  // Rates come from the company's period figures; a post sample has no rate of its own.
  b.engagement_rate_avg = null;
  b.impressions_avg = b.post_count ? Math.round(b.impressions_total / b.post_count) : 0;
  b.cadence_per_week = Math.round(((b.post_count / days) * 7) * 10) / 10;
  b.top_hashtags = topCounts(b.hashtags, 10);
  b.media_type_mix = topCounts(b.media_types, 8);
  b.top_posts = b.top_posts.sort((x: AnyPost, y: AnyPost) => y.engagement - x.engagement).slice(0, 5);
  delete b.hashtags; delete b.media_types; delete b.engagement_sum;
  return b;
}

/**
 * One company's whole sample from its posts in the period: the company
 * bucket, its channel mix, and a bucket per channel. Rows that are not
 * posts (Sprout's ads) are left out. observed_post_count is the sample's
 * own count; the period totals (post_count, cadence, rates) come from the
 * company's figures when the report is read.
 */
export function companyPostSample(posts: AnyPost[], days: number): AnySample {
  const company = { ...emptyPostSample(), channels: {} as Record<string, number>, by_channel: {} as Record<string, AnySample> };
  for (const p of posts) {
    if (!isPublishedReportPost(p)) continue;
    const channel = addPostToSample(company, p);
    if (!company.by_channel[channel]) company.by_channel[channel] = emptyPostSample();
    addPostToSample(company.by_channel[channel], p);
  }
  finalizePostSample(company, days);
  const channel_mix = topCounts(company.channels, 8);
  // deno-lint-ignore no-unused-vars
  const { channels, ...rest } = company;
  return {
    ...rest,
    observed_post_count: company.post_count,
    channel_mix,
    by_channel: Object.fromEntries(Object.entries(company.by_channel).map(([key, b]) => {
      const done = finalizePostSample(b, days);
      return [key, { ...done, observed_post_count: done.post_count }];
    })),
  };
}
