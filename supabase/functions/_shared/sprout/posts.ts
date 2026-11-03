// supabase/functions/_shared/sprout/posts.ts
//
// A brand's published posts, as Sprout's analytics/posts endpoint lists
// them with their text: the post record the design discovery
// (brand-references/discover.ts) and the reports read, asked the same way
// (the same filters, fields, sort and page size, under the account's
// customer). Pages are read 200 ms apart, as the reports' Sprout reader
// reads them, and at most three (a bounded 150-post sample, as discovery
// takes). The Sprout auto-onboarding job and the lifecycle's website step
// read posts here; the website step reads 12 months, every page Sprout
// returns up to MAX_POST_PAGES (spec: docs/superpowers/specs/2026-11-03-
// onboarding-complete-design.md, section 4), while the weekly onboarding job
// keeps 90 days and three pages to fit its 90-second run.
//
// listOwnedPostRows is the lifecycle's social_read: the fields and metrics
// the owned source asks for (competitive/ownedSource.ts collectOwnedCompetitive)
// plus each post's from.profile_picture, which Sprout's Message Fields table
// documents as "URL to the profile picture", newest first.

import { defaultSproutCustomerId } from "./customer.ts";
import { sproutAccessToken } from "./profiles.ts";

const API_BASE = "https://api.sproutsocial.com/v1";

/** How far back a brand's posts are read. */
export const POSTS_WINDOW_DAYS = 90;
/** How far back the website step reads, and the social read when 90 days hold too few posts. */
export const POSTS_YEAR_DAYS = 365;
/** At most this many pages of 50. */
export const POST_PAGES = 3;
/** The most pages a longer read takes: every page Sprout returns, with a bound. */
export const MAX_POST_PAGES = 40;
const PAGE_SIZE = 50;
const PAGE_GAP_MS = 200;

/** The post fields the owned source asks for, with the boost flag and the profile picture. */
export const OWNED_POST_FIELDS = ["guid", "customer_profile_id", "network", "created_time", "perma_link", "text", "post_type", "content_category", "visual_media", "is_boosted", "from.profile_picture"];
/** The post metrics the owned source asks for. */
export const OWNED_POST_METRICS = ["lifetime.reactions", "lifetime.likes", "lifetime.comments_count", "lifetime.shares_count", "lifetime.impressions", "lifetime.video_views"];

export interface SproutPost {
  text: string;
  created_time: string | null;
  perma_link: string | null;
  profile_id: string | null;
}

export class SproutPostsError extends Error {
  constructor(public status: number, message: string, public detail: string) {
    super(message);
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ReadOptions {
  since: Date;
  until: Date;
  customerId?: string;
  /** At most this many pages of 50 (POST_PAGES unless given). */
  pages?: number;
  fetchImpl?: typeof fetch;
  token?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

/** Sprout's analytics/posts, page by page, 200 ms apart: the rows, or Sprout's refusal. */
// deno-lint-ignore no-explicit-any
async function readPostPages(profileIds: string[], o: ReadOptions, ask: Record<string, unknown>): Promise<any[]> {
  const ids = [...new Set(profileIds.map(String).filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return [];
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? sleepMs;
  const token = await (o.token ?? (() => sproutAccessToken(f)))();
  const customer = o.customerId || defaultSproutCustomerId();
  const pages = Math.max(1, Math.min(MAX_POST_PAGES, Math.floor(o.pages ?? POST_PAGES)));
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  for (let page = 1; page <= pages; page++) {
    if (page > 1) await sleep(PAGE_GAP_MS);
    const response = await f(`${API_BASE}/${encodeURIComponent(customer)}/analytics/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: [`customer_profile_id.eq(${ids.join(", ")})`, `created_time.in(${day(o.since)}T00:00:00...${day(o.until)}T23:59:59)`],
        ...ask, timezone: "UTC", page, limit: PAGE_SIZE,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
      throw new SproutPostsError(response.status, `Sprout's post list did not answer (${response.status}).`, detail);
    }
    const data = await response.json();
    rows.push(...(Array.isArray(data?.data) ? data.data : []));
    if (page >= Number(data?.paging?.total_pages || 1)) break;
  }
  return rows;
}

/** The posts the profiles published between since and until (whole days, UTC), newest-first by Sprout's own sort. */
export async function listBrandPosts(profileIds: string[], o: ReadOptions): Promise<SproutPost[]> {
  const rows = await readPostPages(profileIds, o, {
    fields: ["created_time", "perma_link", "text", "customer_profile_id", "network"], metrics: ["lifetime.impressions"], sort: ["lifetime.impressions:desc"],
  });
  return rows.map((p) => {
    const profile = p.customer_profile_id ?? p.dimensions?.customer_profile_id;
    return { text: String(p.text ?? ""), created_time: p.created_time ? String(p.created_time) : null, perma_link: p.perma_link ? String(p.perma_link) : null, profile_id: profile != null ? String(profile) : null };
  });
}

/** The profiles' posts as Sprout sends them, with the owned source's fields and metrics and the profile picture, newest first. */
// deno-lint-ignore no-explicit-any
export function listOwnedPostRows(profileIds: string[], o: ReadOptions): Promise<any[]> {
  return readPostPages(profileIds, o, { fields: OWNED_POST_FIELDS, metrics: OWNED_POST_METRICS, sort: ["created_time:desc"] });
}
