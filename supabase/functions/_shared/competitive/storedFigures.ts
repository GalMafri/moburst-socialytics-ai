// A stored competitive report's client figures, worked out again from the
// posts the report itself collected (the "socialposts" snapshot), when they
// were stored before the product's current rules.
//
// Reports collected before 19 Oct 2026 counted Sprout's ad rows as posts
// (Bader Law, September 2026: 29 "fa:" rows, 42 Facebook posts where 13 were
// published), and before 20 Oct stored no impressions for YouTube, whose
// reach is its views. The posts behind those totals are in the snapshot, so
// the client's Sprout figures for the report's period are counted again from
// them: published posts only, views as YouTube's impressions, the same
// summing as ownedSource.ts. The client's post sample (weekday and hour
// counts, hashtags, formats, top posts) is rebuilt from the same posts with
// the code the workflow uses (postSample.ts). The previous period's posts
// are not in the snapshot: a platform whose post count changed loses its
// previous count rather than keep one that counted ads.
//
// Nothing else changes: competitors, RivalIQ's figures, the text.

import { inclusiveDays, isPublishedReportPost } from "./reportMetrics.ts";
import { companyPostSample, postsInPeriod } from "./postSample.ts";
import { ownedPostTotals } from "./ownedSource.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const day = (v: unknown) => String(v || "").slice(0, 10);

export type StoredFiguresResult = {
  report_data: Any;
  changed: boolean;
  /** What was counted again, for the audit record. */
  changes: Array<{ network: string; field: string; before: unknown; after: unknown }>;
  /** The client company as stored before, when it changed. */
  original_client?: Any;
};

/**
 * The report with its client's Sprout figures counted again from its own
 * stored posts, or the report unchanged when its figures already follow the
 * rules, it has no Sprout figures, or its posts were not stored.
 */
export function clientFiguresFromStoredPosts(reportData: Any, postsSnapshot: Any): StoredFiguresResult {
  const unchanged: StoredFiguresResult = { report_data: reportData, changed: false, changes: [] };
  const companies: Any[] = reportData?.aggregates?.companies;
  if (!Array.isArray(companies)) return unchanged;
  const index = companies.findIndex((c) => c?.is_client);
  const client = companies[index];
  const owned = client?.owned_metrics;
  if (!owned || owned.coverage !== "complete" || owned.published_posts_only) return unchanged;
  const period = reportData?.period || reportData?.aggregates?.period;
  const days = inclusiveDays(period?.start, period?.end);
  const raw: Any[] = Array.isArray(postsSnapshot?.socialPosts) ? postsSnapshot.socialPosts : [];
  const clientId = String(client.company_id ?? "");
  if (!days || !clientId) return unchanged;
  // Every stored post of the client, as the workflow's sample read them; its Sprout rows in the period.
  const mine = raw.filter((p) => String(p?.companyId) === clientId);
  const sprout = mine.filter((p) => (p?.source === "sprout" || String(p?.postId || "").startsWith("sprout:")) && day(p?.publishedAt) >= period.start && day(p?.publishedAt) <= period.end);
  if (!sprout.length) return unchanged;

  const changes: StoredFiguresResult["changes"] = [];
  const by_network: Record<string, Any> = {};
  for (const [network, stored] of Object.entries(owned.by_network || {}) as [string, Any][]) {
    const rows = sprout.filter((p) => String(p.channel || "").toLowerCase() === network);
    const published = rows.filter((p) => isPublishedReportPost(p));
    // Counted as the owned source counts them (ownedPostTotals); a network with no stored posts keeps what was stored.
    const totals = ownedPostTotals(published);
    const posts = rows.length ? totals.posts : stored?.posts?.current;
    const engagement = rows.length ? totals.engagement : stored?.engagement?.current;
    const impressions = rows.length ? totals.impressions : stored?.impressions?.current;
    const postsChanged = posts !== stored?.posts?.current;
    const next = {
      ...stored,
      posts: { current: posts, previous: postsChanged ? null : stored?.posts?.previous ?? null },
      engagement: { current: engagement, previous: stored?.engagement?.previous ?? null },
      impressions: { current: impressions, previous: stored?.impressions?.previous ?? null },
    };
    for (const field of ["posts", "engagement", "impressions"]) {
      if (next[field].current !== stored?.[field]?.current) changes.push({ network, field, before: stored?.[field]?.current ?? null, after: next[field].current });
    }
    if (postsChanged && stored?.posts?.previous != null) changes.push({ network, field: "posts_previous", before: stored.posts.previous, after: null });
    by_network[network] = next;
  }
  if (!changes.length) return unchanged;

  const ownedNow = { ...owned, by_network, published_posts_only: true, counted_from: "stored_posts" };
  // The sample the report shows for the client, from the same stored posts, ads left out.
  const counted = postsInPeriod(mine, period.start, period.end);
  const sample = companyPostSample(counted, days);
  // The rows the stored totals counted that are not posts.
  const removed = sprout.filter((p) => !isPublishedReportPost(p)).length;
  const nextClient = {
    ...client,
    ...sample,
    by_channel: sample.by_channel,
    owned_metrics: ownedNow,
  };
  const nextCompanies = companies.map((c, i) => (i === index ? nextClient : c));
  const less = (n: unknown) => (valid(n) ? Math.max(0, n - removed) : n);
  const next = {
    ...reportData,
    aggregates: { ...reportData.aggregates, companies: nextCompanies, ...(valid(reportData.aggregates?.total_posts_analyzed) ? { total_posts_analyzed: less(reportData.aggregates.total_posts_analyzed) } : {}) },
    ...(reportData.totals && valid(reportData.totals.posts_analyzed) ? { totals: { ...reportData.totals, posts_analyzed: less(reportData.totals.posts_analyzed) } } : {}),
  };
  return { report_data: next, changed: true, changes, original_client: client };
}
