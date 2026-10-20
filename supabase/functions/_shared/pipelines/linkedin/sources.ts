// The verified public LinkedIn source, ported from n8n.
//
// Two n8n workflows collect public LinkedIn company posts with the same
// Apify actor and the same checks:
//   * "Socialytics - Verified LinkedIn Source" (xm3ZFPjysyQCkWsc, live
//     version 29ba2340): nodes Prepare Source Request and Verify Source
//     Posts. The competitor feed refresh calls it.
//   * "Socialytics - Competitive Analysis (RivalIQ) - v1" (EBiAwSay3H2R8krv,
//     live version 079ef9fd): nodes Prepare LinkedIn Sources and Merge
//     LinkedIn Posts, which also count the previous period of equal length
//     and read each company's follower count as a dated snapshot.
// Both node pairs are here as plain functions, line for line. The repo's
// mirrors (n8n/linkedin-source-workflow.json, n8n/code/prepare-linkedin-
// sources.js, n8n/code/merge-linkedin-posts.js) hold the same code as the
// live versions; a test runs them side by side with these functions.
//
// The checks: only reviewed company pages; a post's author must be that page
// (or the same numeric company id, or a collaboration the page's own header
// shows); reposts dropped; every post needs its date, its link and all
// three public engagement counts; a page that reaches the 150-post limit
// fails rather than reporting a partial period.

// deno-lint-ignore no-explicit-any
type Any = any;

/** harvestapi/linkedin-company-posts, as both n8n Apify nodes run it. */
export const LINKEDIN_ACTOR = {
  id: "WI0tj4Ieb5Kq458gB",
  name: "harvestapi/linkedin-company-posts",
  timeoutSecs: 240,
  memoryMbytes: 512,
} as const;

/** Posts the actor returns per company page at most; reaching it means the period was not fully read. */
export const LINKEDIN_MAX_POSTS = 150;

export type LinkedInSourceRef = { company_id: string; name: string; profile_url: string };
export type Period = { start: string; end: string };

/** The actor's input: the reviewed pages, from a date, without comments, reactions or reposts. */
export function linkedInActorInput(sources: LinkedInSourceRef[], postedLimitDate: string) {
  return {
    targetUrls: sources.map((s) => s.profile_url),
    maxPosts: LINKEDIN_MAX_POSTS,
    postedLimitDate,
    scrapeComments: false,
    scrapeReactions: false,
    includeReposts: false,
    includeQuotePosts: true,
  };
}

/** A LinkedIn company page URL in its one canonical form, or "". */
export function linkedInProfile(value: unknown): string {
  const m = String(value || "").match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9_-]+)(?:\/|\?|$)/i);
  return m ? "https://www.linkedin.com/company/" + m[1].toLowerCase() : "";
}

/** What the collection was asked for: n8n's Prepare Source Request (and Prepare LinkedIn Sources) output. */
export interface LinkedInPlan {
  range_start: string;
  range_end: string;
  sources: LinkedInSourceRef[];
  has_sources: boolean;
  /** The competitive workflow also counts this period (null when the range is not a number of days). */
  previous_period?: Period | null;
  input: ReturnType<typeof linkedInActorInput>;
}

/** Prepare Source Request (xm3ZFPjysyQCkWsc): the feed refresh's request, checked. */
export function prepareSourceRequest(body: { sources?: unknown; period?: Partial<Period> } | null | undefined): LinkedInPlan {
  const period = (body?.period || {}) as Partial<Period>;
  const start = Date.parse(period.start + "T00:00:00Z");
  const end = Date.parse(period.end + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 365 * 86400000) throw new Error("Invalid LinkedIn source period.");
  const sources = body?.sources as LinkedInSourceRef[];
  if (!Array.isArray(sources) || !sources.length || sources.length > 10 || sources.some((s) => !s.company_id || !/^https:\/\/www\.linkedin\.com\/company\/[a-z0-9_-]+$/.test(s.profile_url || ""))) throw new Error("Verified LinkedIn company sources are required.");
  if (new Set(sources.map((s) => s.profile_url)).size !== sources.length || new Set(sources.map((s) => s.company_id)).size !== sources.length) throw new Error("Duplicate LinkedIn source identities.");
  return { range_start: period.start!, range_end: period.end!, sources, has_sources: true, input: linkedInActorInput(sources, period.start!) };
}

/**
 * Prepare LinkedIn Sources (EBiAwSay3H2R8krv): the reviewed LinkedIn page of
 * each confirmed competitor (and of the client when its posts do not come
 * from Sprout), matched to the landscape by website.
 */
export function prepareCompetitiveLinkedInSources(cfg: { range_start: string; range_end: string }, body: Any, landscape: Any): LinkedInPlan {
  const host = (value: unknown) => String(value || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  const sources: LinkedInSourceRef[] = [];
  const add = (company: Any, handles: Any[]) => {
    const urls = [...new Set((handles || []).filter((h: Any) => ["linkedin", "linkedin_company"].includes(h.platform || h.network_type)).map((h: Any) => linkedInProfile(h.url || h.native_link) || (/^[a-z0-9_-]+$/i.test(h.handle || "") ? linkedInProfile("https://www.linkedin.com/company/" + h.handle) : "")).filter(Boolean))] as string[];
    if (urls.length > 1) throw new Error(company.name + " has multiple reviewed LinkedIn company pages. Choose one primary profile.");
    if (urls.length === 1) sources.push({ company_id: String(company.id), name: company.name, profile_url: urls[0] });
  };
  const own = landscape.companies.find((c: Any) => String(c.id) === String(landscape.client_company_id));
  if (own && body?.owned_source !== "sprout") add(own, body?.client_profiles || []);
  for (const selected of body?.competitors || []) {
    const company = landscape.companies.find((c: Any) => host(c.url) === host(selected.website_url));
    if (!company) throw new Error("LinkedIn source company is not in the verified selection.");
    add(company, selected.handles);
  }
  if (new Set(sources.map((s) => s.profile_url)).size !== sources.length) throw new Error("The same LinkedIn page is assigned to different companies.");
  const days = Math.round((Date.parse(cfg.range_end) - Date.parse(cfg.range_start)) / 86400000) + 1;
  const previous_period = Number.isFinite(days) && days > 0 ? {
    start: new Date(Date.parse(cfg.range_start) - days * 86400000).toISOString().slice(0, 10),
    end: new Date(Date.parse(cfg.range_start) - 86400000).toISOString().slice(0, 10),
  } : null;
  return { range_start: cfg.range_start, range_end: cfg.range_end, sources, previous_period, has_sources: sources.length > 0, input: linkedInActorInput(sources, previous_period?.start || cfg.range_start) };
}

export interface VerifiedLinkedIn {
  posts: Any[];
  /** Per company id: the source, the period, posts, engagement and coverage (and the previous period, follower snapshot). */
  metrics: Record<string, Any>;
}

/**
 * Verify Source Posts (xm3ZFPjysyQCkWsc) and Merge LinkedIn Posts
 * (EBiAwSay3H2R8krv) in one: the actor's dataset checked row by row.
 *
 * opts.previous: the competitive workflow's previous period (its rows are
 * counted into metrics[...].previous and never become posts); undefined for
 * the feed's source, which has no previous period.
 * opts.audience: read "N followers" from the company author as a snapshot
 * dated opts.today (the competitive workflow only).
 */
export function verifyLinkedInRows(items: Any[], plan: { range_start: string; range_end: string; sources: LinkedInSourceRef[]; has_sources: boolean }, opts: { previous?: Period | null; audience?: boolean; today: string }): VerifiedLinkedIn {
  const cfg = { range_start: plan.range_start, range_end: plan.range_end };
  const rows = plan.has_sources ? (items || []).filter((j: Any) => j && typeof j === "object" && Object.keys(j).length) : [];
  const byUrl = new Map(plan.sources.map((s) => [s.profile_url, s]));
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const posts: Any[] = [];
  const metrics: Record<string, Any> = Object.fromEntries(plan.sources.map((s) => [s.company_id, { provider: "apify/harvestapi", profile_url: s.profile_url, period: { start: cfg.range_start, end: cfg.range_end }, posts: 0, engagement: 0, coverage: "complete", reposts_included: false }]));
  const previous = opts.previous ?? null;
  if (previous) for (const m of Object.values(metrics)) m.previous = { period: previous, posts: 0, engagement: 0, coverage: "complete" };
  for (const row of rows) {
    if (row.error || row.type === "error") throw new Error("LinkedIn collection returned an error; the report must not treat it as zero activity.");
    if (row.type !== "post") throw new Error("LinkedIn collection returned an unexpected result; source coverage could not be verified.");
    const source = byUrl.get(linkedInProfile(row.query?.targetUrl));
    if (!source) throw new Error("LinkedIn post query does not match a reviewed company page.");
    const headerMatches = linkedInProfile(row.header?.imageLink) === source.profile_url;
    const collaboration = headerMatches && /collaborated on this/i.test(row.header?.text || "");
    if (headerMatches && /reposted this/i.test(row.header?.text || "")) continue;
    // LinkedIn resolves numeric company URLs to a vanity slug. The immutable
    // company ID must match exactly; similar names or slugs are not evidence.
    const reviewedId = source.profile_url.match(/\/company\/(\d+)$/)?.[1];
    const sameCompanyId = reviewedId && row.author?.type === "company"
      && String(row.author.companyId || "") === reviewedId && !!linkedInProfile(row.author.linkedinUrl);
    if (linkedInProfile(row.author?.linkedinUrl) !== source.profile_url && !sameCompanyId && !collaboration) throw new Error("LinkedIn post author does not match the reviewed company page.");
    if (opts.audience) {
      // This is a profile observation at collection time, never a historical
      // follower count at the post's publication date. Ignore abbreviated counts.
      const followers = !collaboration && row.author?.type === "company" && String(row.author.info || "").match(/^([\d,]+) followers$/);
      if (followers) metrics[source.company_id].audience_snapshot = { followers: Number(followers[1].replace(/,/g, "")), as_of: opts.today, source: "apify/harvestapi" };
    }
    counts.set(source.profile_url, (counts.get(source.profile_url) || 0) + 1);
    const published = row.postedAt?.date;
    if (!published || !Number.isFinite(Date.parse(published)) || !/^https:\/\/www\.linkedin\.com\/(?:posts|feed\/update)\//.test(row.linkedinUrl || "")) throw new Error("LinkedIn post is missing its source URL or publication date.");
    const date = new Date(published).toISOString().slice(0, 10);
    if (date < (previous?.start || cfg.range_start) || date > cfg.range_end) continue;
    const key = source.company_id + ":" + String(row.id || row.linkedinUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    const values = ["likes", "comments", "shares"].map((k) => row.engagement?.[k]);
    if (values.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)) throw new Error("LinkedIn post engagement counts are incomplete.");
    const engagement = values.reduce((sum: number, n: number) => sum + n, 0);
    if (date < cfg.range_start) {
      if (previous && date <= previous.end) { metrics[source.company_id].previous.posts++; metrics[source.company_id].previous.engagement += engagement; }
      continue;
    }
    metrics[source.company_id].posts++;
    metrics[source.company_id].engagement += engagement;
    const image = row.postImages?.[0]?.url || row.document?.coverPages?.[0]?.imageUrls?.[0] || row.postVideo?.thumbnailUrl || row.article?.image?.url || null;
    posts.push({ postId: "linkedin:" + key, companyId: source.company_id, companyName: source.name, channel: "linkedin", publishedAt: new Date(published).toISOString(), message: String(row.content || ""), postLink: row.linkedinUrl, image, engagementTotal: engagement, applause: values[0], conversation: values[1], amplification: values[2], type: row.document ? "carousel" : row.postVideo ? "video" : row.article ? "link" : image ? "image" : "text", source: "apify/harvestapi", source_profile_url: source.profile_url, authorship: collaboration ? "collaboration" : "company" });
  }
  if ([...counts.values()].some((n) => n >= LINKEDIN_MAX_POSTS)) throw new Error("LinkedIn collection reached its per-company limit; this period needs a larger paginated retrieval.");
  return { posts, metrics };
}

/** The answer the feed refresh gets, as the n8n workflow's webhook answers it (_shared/competitive/linkedinSource.ts reads it). */
export function linkedInSourceAnswer(plan: LinkedInPlan, verified: VerifiedLinkedIn) {
  return { socialPosts: verified.posts, additional_metrics: verified.metrics, linkedin_sources: plan.sources, linkedin_posts: verified.posts.length };
}

/** Merge LinkedIn Posts' output: the RivalIQ posts with the verified LinkedIn posts added. */
export function mergeLinkedInPosts(rival: Any, plan: LinkedInPlan, verified: VerifiedLinkedIn) {
  return { ...rival, socialPosts: [...(rival?.socialPosts || []), ...verified.posts], additional_metrics: verified.metrics, linkedin_sources: plan.sources, linkedin_posts: verified.posts.length };
}
