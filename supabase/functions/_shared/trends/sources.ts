// The six trend sources (spec section 2). Each is one Apify actor: what it is
// asked for, and how a row of its answer becomes the shared post shape. A
// source that breaks is replaced here without touching anything else.
//
// TikTok, Instagram and LinkedIn take every search in one run. YouTube,
// Pinterest and Facebook take one search per run, so they get one small run
// per search. Actor inputs as each actor's schema read on 1 Nov 2026.

import type { Term, TrendFormat, TrendPlatform, TrendPost } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** At most this many searches per platform a week, about 25 posts each: 200 posts at most. */
export const MAX_SEARCHES = 8;
export const POSTS_PER_SEARCH = 25;
export const MAX_POSTS_PER_PLATFORM = 200;

export interface SearchOptions {
  /** Two-letter country of the client, when it has one. */
  region?: string;
  language: string;
  /** The week being collected, YYYY-MM-DD. */
  windowStart: string;
  windowEnd: string;
}

/** One actor run: its input, and the search it ran ("" when the run took every search and each row names its own). */
export interface SourceRun {
  search: string;
  input: Record<string, unknown>;
}

export interface TrendSource {
  actor: { id: string; name: string; timeoutSecs?: number; memoryMbytes?: number };
  inputs(searches: string[], o: SearchOptions): SourceRun[];
  /** A row of the answer as a post; null for a row that is not a post. */
  normalize(row: unknown, search: string): TrendPost | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** How much a post was engaged with, the same way on every platform. */
export function engagementOf(p: Pick<TrendPost, "likes" | "comments" | "shares" | "saves" | "views">): number {
  return p.likes + 2 * p.comments + 3 * p.shares + p.saves + p.views / 1000;
}

function post(platform: TrendPlatform, fields: Omit<TrendPost, "platform" | "engagement">): TrendPost | null {
  if (!/^https:\/\//.test(fields.url)) return null;
  const { handle, ...rest } = fields;
  const h = (handle ?? "").replace(/^@/, "");
  const p: TrendPost = { platform, ...rest, ...(h ? { handle: h } : {}), engagement: 0 };
  p.engagement = engagementOf(p);
  return p;
}

const searchesOf = (searches: string[]) => searches.map((s) => s.trim()).filter(Boolean).slice(0, MAX_SEARCHES);
const onePerSearch = (searches: string[], input: (s: string) => Record<string, unknown>): SourceRun[] => searchesOf(searches).map((s) => ({ search: s, input: input(s) }));

/** Seconds in a YouTube length like "57:47" or "1:02:03". */
function seconds(length: unknown): number {
  const parts = text(length).split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

export const TREND_SOURCES: Record<TrendPlatform, TrendSource> = {
  tiktok: {
    actor: { id: "5K30i8aFccKNF5ICs", name: "apidojo/tiktok-scraper" },
    inputs(searches, o) {
      const keywords = searchesOf(searches);
      if (!keywords.length) return [];
      return [{
        search: "",
        input: {
          keywords, dateRange: "THIS_WEEK", sortType: "MOST_LIKED", ...(o.region ? { location: o.region } : {}),
          maxItems: Math.min(MAX_POSTS_PER_PLATFORM, keywords.length * POSTS_PER_SEARCH), includeSearchKeywords: true,
        },
      }];
    },
    normalize(r: Any, search) {
      if (!r || typeof r !== "object") return null;
      return post("tiktok", {
        url: text(r.postPage) || text(r.webVideoUrl), author: text(r.channel?.username) || text(r.authorMeta?.name),
        text: text(r.title) || text(r.text), posted_at: iso(r.uploadedAtFormatted) ?? iso(r.createTimeISO) ?? iso(r.uploadedAt),
        format: "short_video", views: num(r.views ?? r.playCount), likes: num(r.likes ?? r.diggCount), comments: num(r.comments ?? r.commentCount),
        shares: num(r.shares ?? r.shareCount), saves: num(r.bookmarks ?? r.collectCount), search: text(r.keyword) || text(r.inputSource) || search,
        handle: text(r.channel?.username) || text(r.authorMeta?.name),
      });
    },
  },

  instagram: {
    actor: { id: "reGe1ST3OBgYZSsZJ", name: "apify/instagram-hashtag-scraper" },
    inputs(searches) {
      const hashtags = searchesOf(searches).map((h) => h.replace(/^#/, ""));
      if (!hashtags.length) return [];
      return [{ search: "", input: { hashtags, keywordSearch: false, resultsLimit: POSTS_PER_SEARCH, resultsType: "posts" } }];
    },
    normalize(r: Any, search) {
      if (!r || typeof r !== "object" || r.type === "carousel_item") return null;
      const url = text(r.shortCode) ? `https://www.instagram.com/p/${text(r.shortCode)}/` : (/instagram\.com\/(p|reel)\//.test(text(r.url)) ? text(r.url) : "");
      const tag = text(r.inputUrl).match(/\/explore\/tags\/([^/?#]+)/)?.[1];
      const kind = text(r.type).toLowerCase();
      const format: TrendFormat = kind === "sidecar" ? "carousel" : kind === "video" ? "short_video" : "image";
      return post("instagram", {
        url, author: text(r.ownerUsername) || text(r.owner?.username), text: text(r.caption),
        posted_at: iso(r.timestamp), format, views: num(r.videoViewCount ?? r.videoPlayCount), likes: num(r.likesCount),
        comments: num(r.commentsCount), shares: 0, saves: 0, search: tag ? `#${decodeURIComponent(tag).toLowerCase()}` : search,
      });
    },
  },

  linkedin: {
    actor: { id: "buIWk2uOUzTmcLsuB", name: "harvestapi/linkedin-post-search" },
    inputs(searches) {
      const searchQueries = searchesOf(searches);
      if (!searchQueries.length) return [];
      // The actor sorts by relevance or date only; the filter ranks by engagement afterward.
      return [{ search: "", input: { searchQueries, maxPosts: POSTS_PER_SEARCH, postedLimit: "week", sortBy: "relevance" } }];
    },
    normalize(r: Any, search) {
      if (!r || typeof r !== "object" || (r.type && r.type !== "post")) return null;
      const images = Array.isArray(r.postImages) ? r.postImages.length : 0;
      const format: TrendFormat = r.postVideo?.videoUrl ? "short_video" : r.document ? "carousel" : images > 1 ? "carousel" : images === 1 ? "image" : "text";
      return post("linkedin", {
        url: text(r.linkedinUrl) || text(r.shareLinkedinUrl), author: text(r.author?.name), text: text(r.content),
        posted_at: iso(r.postedAt?.date) ?? iso(r.postedAt?.timestamp), format, views: 0, likes: num(r.engagement?.likes),
        comments: num(r.engagement?.comments), shares: num(r.engagement?.shares), saves: 0, search: text(r.query?.search) || search,
        handle: text(r.author?.publicIdentifier) || text(r.author?.universalName),
      });
    },
  },

  youtube: {
    actor: { id: "nfyn3ecod9uCDaoVH", name: "api-ninja/youtube-search-scraper" },
    inputs(searches, o) {
      // The actor refuses fewer than 20 results a run.
      return onePerSearch(searches, (query) => ({
        query, type: "video", maxResults: POSTS_PER_SEARCH, sortBy: "popularity", uploadDate: "week",
        ...(o.region ? { geo: o.region } : {}), lang: o.language,
      }));
    },
    normalize(r: Any, search) {
      if (!r || typeof r !== "object" || !text(r.videoId)) return null;
      const short = text(r.type) === "shorts" || (seconds(r.lengthText) > 0 && seconds(r.lengthText) <= 60);
      const id = text(r.videoId);
      return post("youtube", {
        url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
        author: text(r.channelTitle) || text(r.channelHandle), text: [text(r.title), text(r.description)].filter(Boolean).join("\n"),
        posted_at: iso(r.publishedAt) ?? iso(r.publishDate), format: short ? "short_video" : "long_video",
        views: num(r.viewCount), likes: num(r.likeCount), comments: num(r.commentCount), shares: 0, saves: 0, search,
        handle: text(r.channelHandle),
      });
    },
  },

  pinterest: {
    actor: { id: "rusvWpGtw0MugV2j4", name: "epctex/pinterest-scraper" },
    inputs(searches) {
      // Search links in startUrls came back empty on 1 Nov; the search field works, one keyword a run.
      return onePerSearch(searches, (s) => ({ search: s, maxItems: POSTS_PER_SEARCH, getDetails: false }));
    },
    normalize(r: Any, search) {
      if (!r || typeof r !== "object" || (r.type && r.type !== "pin")) return null;
      return post("pinterest", {
        url: text(r.url), author: text(r.pinner?.username) || text(r.pinner?.full_name),
        text: [text(r.grid_title) || text(r.title), text(r.description)].filter(Boolean).join("\n"),
        // A pin's date is when it was pinned, not when its idea was posted; the spec ranks pins by saves instead.
        posted_at: null, format: "pin", views: 0, likes: num(r.like_count), comments: 0, shares: 0,
        saves: num(r.aggregated_pin_data?.aggregated_stats?.saves ?? r.repin_count), search: text(r.inputSource) || search,
        handle: text(r.pinner?.username),
      });
    },
  },

  facebook: {
    actor: { id: "TMBawM4LZpKN15DZX", name: "scraper_one/facebook-posts-search" },
    inputs(searches, o) {
      return onePerSearch(searches, (query) => ({ query, resultsCount: POSTS_PER_SEARCH, searchType: "top", startDate: o.windowStart, endDate: o.windowEnd }));
    },
    normalize(r: Any, search) {
      if (!r || typeof r !== "object") return null;
      const kinds = Array.isArray(r.attachments) ? r.attachments.map((a: Any) => text(a?.type)) : [];
      const format: TrendFormat = kinds.includes("video") ? "short_video" : kinds.filter((k: string) => k === "photo").length > 1 ? "carousel" : kinds.includes("photo") ? "image" : "text";
      return post("facebook", {
        url: text(r.url), author: text(r.author?.name), text: text(r.postText), posted_at: iso(r.timestamp), format,
        views: 0, likes: num(r.reactionsCount), comments: num(r.commentsCount), shares: num(r.sharesCount), saves: 0, search,
      });
    },
  },
};

const byTerm = (a: Term, b: Term) => a.term.toLowerCase().localeCompare(b.term.toLowerCase());

/** Each term once, by its trimmed lowercase text. */
function uniqueTerms(terms: Term[]): Term[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What a person added, in a fixed order: always searched, first. */
const personTerms = (terms: Term[]): Term[] => uniqueTerms(terms).filter((t) => t.source === "person").sort(byTerm).slice(0, MAX_SEARCHES);

/** A person's searches first, then the others in their order, each once, at most MAX_SEARCHES. */
export function fillAfter(person: string[], rest: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...person, ...rest]) {
    const search = typeof s === "string" ? s.trim() : "";
    const key = search.toLowerCase();
    if (!search || seen.has(key)) continue;
    seen.add(key);
    out.push(search);
  }
  return out.slice(0, MAX_SEARCHES);
}

/**
 * The week's searches from a list of terms. What a person added is always
 * searched, first. The profile's own terms fill the rest; when they do not
 * all fit, they take turns week by week in a fixed order, so each is
 * searched within a few weeks and the same week always searches the same
 * terms, whatever order the rows were read in. A coverage rewrite, when there
 * is one, takes the place of the profile's own terms (ruled 2 Nov 2026).
 */
function pickSearches(terms: Term[], weekStart: string, rewritten: string[] | null): string[] {
  const unique = uniqueTerms(terms);
  const person = personTerms(unique);
  if (rewritten) return fillAfter(person.map((t) => t.term), rewritten);
  const rest = unique.filter((t) => t.source !== "person").sort(byTerm);
  const slots = MAX_SEARCHES - person.length;
  let turn = rest;
  if (rest.length > slots && slots > 0) {
    const week = Math.floor(Date.parse(`${weekStart}T00:00:00Z`) / (7 * 86_400_000));
    const start = Number.isFinite(week) ? (week * slots) % rest.length : 0;
    turn = [...rest.slice(start), ...rest.slice(0, start)];
  }
  return searchesOf([...person, ...turn.slice(0, Math.max(slots, 0))].map((t) => t.term));
}

type SearchTerms = { topics: Term[]; hashtags: Record<string, Term[]> };
const termsOf = (platform: TrendPlatform, terms: SearchTerms): Term[] => (platform === "instagram" ? terms.hashtags.instagram ?? [] : terms.topics);

/**
 * What a platform searches for in the week starting weekStart (YYYY-MM-DD):
 * Instagram by the profile's hashtags, the others by its topics. A coverage
 * rewrite of a platform's searches replaces the profile's own terms there;
 * what a person added is still searched first.
 */
export function searchesFor(platform: TrendPlatform, terms: SearchTerms, overrides: Record<string, string[]>, weekStart = ""): string[] {
  const replaced = overrides?.[platform];
  return pickSearches(termsOf(platform, terms), weekStart, Array.isArray(replaced) && replaced.length ? replaced : null);
}

/** The searches a person added for a platform, which a coverage rewrite never takes the place of. */
export function personSearches(platform: TrendPlatform, terms: SearchTerms): string[] {
  return searchesOf(personTerms(termsOf(platform, terms)).map((t) => t.term));
}
