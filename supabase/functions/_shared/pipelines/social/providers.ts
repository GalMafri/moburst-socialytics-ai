// The social report's providers besides Claude and Apify: Sprout Social (the
// four analytics reads) and Gamma (the deck from the existing template), each
// as its n8n node calls it (SZbRTV7yOdXTNHHf 5f8d3abc).
//
// Sprout: the same requests, under the account every client's profiles live
// under (_shared/sprout/customer.ts, 1676448 as n8n fixes it), paged as n8n's
// HTTP node pages them (page 1, 2, ... in the body, until the answer's paging
// says it is the last page, 200 ms apart). A refused or dropped request is
// tried three times, 5 s apart, as the nodes' retry does; then it throws, and
// the step runner tries the step again later.
//
// Gamma: one POST per deck, never repeated blindly (n8n's node does not retry
// it: a POST whose answer was lost may already be making a deck); then the
// generation is read every 30 s, up to 20 times (Check Gamma State). A read
// that fails three times answers { error }, as n8n's node continues with its
// error and the report says the deck did not complete.

import { sproutAccessToken } from "../../sprout/profiles.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const SPROUT_API = "https://api.sproutsocial.com/v1";
export const GAMMA_API = "https://public-api.gamma.app/v1.0";
/** The deck template, as "Create Gamma Presentation" names it. */
export const GAMMA_TEMPLATE_ID = "g_ix9srva6gx7iiso";
/** The wait between two looks at a generation (n8n's Wait node). */
export const GAMMA_POLL_SECONDS = 30;

const PROFILE_METRICS = ["impressions", "reactions", "post_link_clicks", "video_views", "comments_count", "shares_count", "likes", "post_content_clicks", "post_content_clicks_other", "saves", "story_replies", "posts_sent_count"];
const POST_METRICS = [
  "lifetime.impressions", "lifetime.impressions_organic", "lifetime.impressions_paid", "lifetime.engagements", "lifetime.reactions", "lifetime.likes",
  "lifetime.comments_count", "lifetime.shares_count", "lifetime.post_link_clicks", "lifetime.post_content_clicks", "lifetime.video_views", "lifetime.video_view_time",
  "lifetime.sentiment_comments_positive_count", "lifetime.sentiment_comments_negative_count", "lifetime.sentiment_comments_neutral_count",
];
const PREVIOUS_POST_METRICS = ["lifetime.impressions", "lifetime.engagements", "lifetime.reactions", "lifetime.likes", "lifetime.comments_count", "lifetime.shares_count", "lifetime.post_link_clicks", "lifetime.post_content_clicks", "lifetime.video_views"];
const POST_FIELDS = ["created_time", "perma_link", "text", "post_type", "content_category", "network", "visual_media"];
const PREVIOUS_POST_FIELDS = ["created_time", "perma_link", "text", "post_type", "network", "visual_media"];

export type SproutRead = "current" | "posts" | "previous" | "previous_posts";
export const SPROUT_READS: readonly SproutRead[] = ["current", "posts", "previous", "previous_posts"];

/** The four requests, as the four n8n HTTP nodes build them (before the page). */
export function sproutRequests(setup: Any, combined: Any): Record<SproutRead, { path: "profiles" | "posts"; body: Record<string, unknown> }> {
  const ids = `customer_profile_id.eq(${setup.profile_ids.join(", ")})`;
  const timezone = combined?.timezone || "UTC";
  return {
    current: { path: "profiles", body: { filters: [ids, `reporting_period.in(${setup.current_month_start}...${setup.current_month_end})`], metrics: PROFILE_METRICS } },
    posts: {
      path: "posts",
      body: { timezone, filters: [ids, `created_time.in(${setup.current_month_start}T00:00:00...${setup.current_month_end}T23:59:59)`], metrics: POST_METRICS, fields: POST_FIELDS, sort: ["lifetime.impressions:desc"], limit: 50 },
    },
    previous: { path: "profiles", body: { filters: [ids, `reporting_period.in(${setup.previous_month_start}...${setup.previous_month_end})`], metrics: PROFILE_METRICS } },
    previous_posts: {
      path: "posts",
      body: { timezone, filters: [ids, `created_time.in(${setup.previous_month_start}T00:00:00...${setup.previous_month_end}T23:59:59)`], metrics: PREVIOUS_POST_METRICS, fields: PREVIOUS_POST_FIELDS, sort: ["lifetime.impressions:desc"], limit: 50 },
    },
  };
}

export interface SproutReader {
  /** Every page of one analytics read, as n8n's pagination gives them. */
  pages(path: "profiles" | "posts", body: Record<string, unknown>): Promise<Any[]>;
}

const MAX_PAGES = 100;
const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A Sprout reader with the app's Sprout connection. */
export function sproutReader(o: { customerId: string; signal?: AbortSignal; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void>; token?: () => Promise<string> }): SproutReader {
  const f: Fetch = o.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = o.sleep ?? sleepMs;
  let token: Promise<string> | null = null;
  const tokenOf = () => (token ??= (o.token ?? (() => sproutAccessToken(f as typeof fetch)))());
  const page = async (path: string, body: Record<string, unknown>, n: number): Promise<Any> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await f(`${SPROUT_API}/${encodeURIComponent(o.customerId)}/analytics/${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${await tokenOf()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, page: n }),
          ...(o.signal ? { signal: o.signal } : {}),
        });
        if (r.ok) return await r.json();
        const detail = (await r.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
        throw new Error(`Sprout ${path} answered ${r.status}: ${detail}`);
      } catch (e) {
        if (o.signal?.aborted || attempt >= 3) throw e;
        await sleep(5000);
      }
    }
  };
  return {
    async pages(path, body) {
      const out: Any[] = [];
      for (let n = 1; n <= MAX_PAGES; n++) {
        if (n > 1) await sleep(200);
        const answer = await page(path, body, n);
        out.push(answer);
        if (!answer?.paging || Number(answer.paging.current_page) >= Number(answer.paging.total_pages)) return out;
      }
      return out;
    },
  };
}

// ── Gamma ──────────────────────────────────────────────────────────────────

export interface GammaClient {
  /** Starts the deck from the template; answers Gamma's body ({ generationId }). Throws when Gamma refused it. */
  create(prompt: string): Promise<Any>;
  /** The generation as Gamma reports it, or { error } after three failed reads. */
  read(generationId: string): Promise<Any>;
}

export function gammaClient(o: { apiKey: string; signal?: AbortSignal; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> }): GammaClient {
  const f: Fetch = o.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = o.sleep ?? sleepMs;
  const headers = { "X-API-KEY": o.apiKey, "Content-Type": "application/json" };
  const redact = (t: string) => (o.apiKey ? t.split(o.apiKey).join("[redacted]") : t);
  return {
    async create(prompt) {
      const r = await f(`${GAMMA_API}/generations/from-template`, {
        method: "POST", headers,
        body: JSON.stringify({ gammaId: GAMMA_TEMPLATE_ID, prompt, sharingOptions: { workspaceAccess: "view" } }),
        ...(o.signal ? { signal: o.signal } : {}),
      });
      if (!r.ok) throw new Error(`Gamma answered ${r.status}: ${redact(await r.text().catch(() => "")).slice(0, 300)}`);
      return await r.json();
    },
    async read(generationId) {
      let last = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const r = await f(`${GAMMA_API}/generations/${encodeURIComponent(generationId)}`, { headers, ...(o.signal ? { signal: o.signal } : {}) });
          if (r.ok) return await r.json();
          last = `Gamma answered ${r.status}: ${redact(await r.text().catch(() => "")).slice(0, 300)}`;
        } catch (e) {
          if (o.signal?.aborted) throw e;
          last = e instanceof Error ? e.message : String(e);
        }
        if (attempt < 3) await sleep(5000);
      }
      return { error: { message: last } };
    },
  };
}
