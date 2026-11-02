// supabase/functions/_shared/sprout/posts.ts
//
// A brand's published posts, as Sprout's analytics/posts endpoint lists
// them with their text: the post record the design discovery
// (brand-references/discover.ts) and the reports read, asked the same way
// (the same filters, fields, sort and page size, under the account's
// customer). Pages are read 200 ms apart, as the reports' Sprout reader
// reads them, and at most three (a bounded 150-post sample, as discovery
// takes). The Sprout auto-onboarding job and the lifecycle's website step
// read posts here.

import { defaultSproutCustomerId } from "./customer.ts";
import { sproutAccessToken } from "./profiles.ts";

const API_BASE = "https://api.sproutsocial.com/v1";

/** How far back a brand's posts are read. */
export const POSTS_WINDOW_DAYS = 90;
/** At most this many pages of 50. */
export const POST_PAGES = 3;
const PAGE_SIZE = 50;
const PAGE_GAP_MS = 200;

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

/** The posts the profiles published between since and until (whole days, UTC), newest-first by Sprout's own sort. */
export async function listBrandPosts(profileIds: string[], o: {
  since: Date;
  until: Date;
  customerId?: string;
  fetchImpl?: typeof fetch;
  token?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SproutPost[]> {
  const ids = [...new Set(profileIds.map(String).filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return [];
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? sleepMs;
  const token = await (o.token ?? (() => sproutAccessToken(f)))();
  const customer = o.customerId || defaultSproutCustomerId();
  const posts: SproutPost[] = [];
  for (let page = 1; page <= POST_PAGES; page++) {
    if (page > 1) await sleep(PAGE_GAP_MS);
    const response = await f(`${API_BASE}/${encodeURIComponent(customer)}/analytics/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: [`customer_profile_id.eq(${ids.join(", ")})`, `created_time.in(${day(o.since)}T00:00:00...${day(o.until)}T23:59:59)`],
        fields: ["created_time", "perma_link", "text", "customer_profile_id", "network"],
        metrics: ["lifetime.impressions"], sort: ["lifetime.impressions:desc"], timezone: "UTC", page, limit: PAGE_SIZE,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
      throw new SproutPostsError(response.status, `Sprout's post list did not answer (${response.status}).`, detail);
    }
    const data = await response.json();
    // deno-lint-ignore no-explicit-any
    for (const p of (Array.isArray(data?.data) ? data.data : []) as any[]) {
      const profile = p.customer_profile_id ?? p.dimensions?.customer_profile_id;
      posts.push({ text: String(p.text ?? ""), created_time: p.created_time ? String(p.created_time) : null, perma_link: p.perma_link ? String(p.perma_link) : null, profile_id: profile != null ? String(profile) : null });
    }
    if (page >= Number(data?.paging?.total_pages || 1)) break;
  }
  return posts;
}
