// supabase/functions/_shared/sprout/publishing.ts
//
// Sending one post to Sprout, as Sprout documents its Publishing API
// (https://api.sproutsocial.com/docs, read 2 Nov 2026). Each request below
// names the section it follows:
//
//   "Accessing the APIs > Obtaining JSON Web Token (JWT) Access Token": the
//     machine-to-machine token, form-encoded client id, secret,
//     grant_type=client_credentials and scope=organization_id.
//   "Endpoints > Requests > Request Headers": Authorization: Bearer, Accept
//     and Content-Type application/json.
//   "Customer Profiles Endpoint" (GET /v1/<customer>/metadata/customer): each
//     profile's "groups", the group ids it belongs to.
//   "Simple Media Upload" (POST /v1/<customer>/media/): multipart/form-data
//     with a media_url part (Link Download); the answer's data[0].media_id.
//   "Publishing Post Endpoints" (POST /v1/<customer>/publishing/posts):
//     group_id, customer_profile_ids, is_draft, text, media as
//     {media_id, media_type}, delivery {scheduled_times, type: "SCHEDULED"};
//     the answer's data[] is one post per profile, with its id at
//     internal.publishing.publishing_post_id.
//
// Two documented limits shape what the app can do (section "Limitations"):
// the API creates posts in draft status only ("is_draft": true is required),
// so a post sent from here lands on Sprout's Publishing Calendar as a draft
// for its time and goes out once someone schedules or sends it in Sprout;
// and there is no immediate mode, only scheduled times, which must be in the
// future and are rounded down to the minute.

const TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const API_BASE = "https://api.sproutsocial.com/v1";
const WAITS_MS = [1_000, 3_000];

export type SproutMediaType = "PHOTO" | "VIDEO" | "DOCUMENT";

/** What Sprout answered when it did not do what was asked; status 0 when it never answered. */
export class SproutRefusal extends Error {
  constructor(public step: "token" | "profiles" | "media" | "post", public status: number, message: string, public detail = "") {
    super(message);
  }
}

export interface SendOptions {
  /** Statuses that mean Sprout did nothing with the request, so it is sent again. */
  resendOn: number[];
  /** A request that got no answer is sent again only when repeating it is harmless. */
  network: boolean;
  timeoutMs?: number;
  waits?: number[];
}

/** One request to Sprout, sent again after a passing refusal ("HTTP Status Codes": 429, 5xx). */
export async function sproutRequest(fetchImpl: typeof fetch, url: string, init: RequestInit, opts: SendOptions): Promise<Response> {
  const waits = opts.waits ?? WAITS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000) });
      if (!opts.resendOn.includes(r.status) || attempt >= waits.length) return r;
      await r.body?.cancel();
    } catch (e) {
      if (!opts.network || attempt >= waits.length) throw e;
    }
    if (waits[attempt]) await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
  }
}

const TRANSIENT = [429, 500, 502, 503, 504];

async function refusal(step: SproutRefusal["step"], r: Response, what: string): Promise<SproutRefusal> {
  const detail = (await r.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 500);
  return new SproutRefusal(step, r.status, `${what} (${r.status}).`, detail);
}

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);
}

/** The machine-to-machine access token. Asking again is harmless. */
export async function publishingToken(fetchImpl: typeof fetch = fetch, waits?: number[]): Promise<string> {
  const clientId = env("SPROUT_CLIENT_ID");
  const clientSecret = env("SPROUT_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new SproutRefusal("token", 0, "The Sprout connection is not configured.");
  const r = await sproutRequest(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "organization_id" }),
  }, { resendOn: TRANSIENT, network: true, waits });
  if (!r.ok) throw await refusal("token", r, "Sprout did not give an access token");
  const data = await r.json().catch(() => null);
  if (!data?.access_token) throw new SproutRefusal("token", r.status, "Sprout gave no access token.");
  return String(data.access_token);
}

const jsonHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" });

/**
 * The Sprout group to create the post in: the first group the profile
 * belongs to. Null when the profile is in no group, or not on the account.
 */
export async function profileGroupId(fetchImpl: typeof fetch, customerId: string, token: string, profileId: number | string, waits?: number[]): Promise<string | null> {
  const r = await sproutRequest(fetchImpl, `${API_BASE}/${encodeURIComponent(customerId)}/metadata/customer`, {
    method: "GET",
    headers: jsonHeaders(token),
  }, { resendOn: TRANSIENT, network: true, waits });
  if (!r.ok) throw await refusal("profiles", r, "Sprout's profile list did not answer");
  const data = await r.json().catch(() => null);
  // deno-lint-ignore no-explicit-any
  const profile = ((data?.data ?? []) as any[]).find((p) => String(p?.customer_profile_id) === String(profileId));
  const groups = Array.isArray(profile?.groups) ? profile.groups : [];
  return groups.length ? String(groups[0]) : null;
}

const VIDEO = /\.(mp4|mov|m4v|webm|avi|mpg|mpeg|mkv|hevc|avc|av1)(\?|#|$)/i;
const DOCUMENT = /\.pdf(\?|#|$)/i;

/** The media_type Sprout takes for a file: PHOTO, VIDEO or DOCUMENT. */
export function mediaTypeOf(url: string): SproutMediaType {
  if (DOCUMENT.test(url)) return "DOCUMENT";
  if (VIDEO.test(url) || /^data:video\//i.test(url)) return "VIDEO";
  return "PHOTO";
}

/**
 * Hands Sprout a file by its web address ("Link Download via Simple File
 * Upload"). Sprout answers once it has downloaded the file, so this waits
 * longer than other requests. Uploading again only leaves an unused upload,
 * which Sprout drops after 24 hours, so it repeats freely.
 */
export async function uploadMediaFromUrl(fetchImpl: typeof fetch, customerId: string, token: string, url: string, waits?: number[]): Promise<{ media_id: string; media_type: SproutMediaType; expiration_time: string | null }> {
  const r = await sproutRequest(fetchImpl, `${API_BASE}/${encodeURIComponent(customerId)}/media/`, {
    method: "POST",
    // No Content-Type: fetch writes multipart/form-data with its boundary.
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: (() => { const form = new FormData(); form.append("media_url", url); return form; })(),
  }, { resendOn: TRANSIENT, network: true, timeoutMs: 60_000, waits });
  if (!r.ok) throw await refusal("media", r, "Sprout did not take a file");
  const data = await r.json().catch(() => null);
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  if (!item?.media_id) throw new SproutRefusal("media", r.status, "Sprout gave no media id for a file.");
  return { media_id: String(item.media_id), media_type: mediaTypeOf(url), expiration_time: item.expiration_time ? String(item.expiration_time) : null };
}

/** A send time as Sprout keeps it: UTC, whole minutes (Sprout rounds seconds down). */
export function sproutMinute(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) throw new Error("The date and time are not complete.");
  return new Date(Math.floor(at / 60_000) * 60_000).toISOString().replace(".000Z", "Z");
}

/**
 * Publish now. Sprout has no immediate mode, only scheduled times in the
 * future, rounded down to the minute: the earliest it accepts is the first
 * whole minute at least a minute away, so the time is still ahead when
 * Sprout reads it.
 */
export function earliestSendTime(now: Date = new Date()): string {
  return new Date(Math.ceil((now.getTime() + 60_000) / 60_000) * 60_000).toISOString().replace(".000Z", "Z");
}

export interface DraftPost {
  groupId: string;
  profileId: number;
  text: string;
  /** UTC, whole minutes (sproutMinute or earliestSendTime). */
  sendAt: string;
  media: Array<{ media_id: string; media_type: SproutMediaType }>;
}

/** The request body "Create Publishing Post" documents. */
export function draftPostBody(p: DraftPost): Record<string, unknown> {
  const groupId = /^\d+$/.test(p.groupId) ? Number(p.groupId) : p.groupId;
  return {
    group_id: groupId,
    customer_profile_ids: [p.profileId],
    // Required: Sprout's API creates draft posts only.
    is_draft: true,
    ...(p.text ? { text: p.text } : {}),
    ...(p.media.length ? { media: p.media.map((m) => ({ media_id: m.media_id, media_type: m.media_type })) } : {}),
    delivery: { scheduled_times: [p.sendAt], type: "SCHEDULED" },
  };
}

export interface CreatedPost {
  publishingPostId: string;
  permaLink: string | null;
  scheduledTime: string | null;
}

/**
 * Creates the post. Sprout answers with one post per profile (fan-out); the
 * profile's own entry carries the post's id. A profile Sprout dropped (media
 * its network does not take) has no entry, and no post was made for it.
 * Sent again only when Sprout said it did nothing (a rate limit, unavailable),
 * never after a lost answer, so a post is never made twice.
 */
export async function createDraftPost(fetchImpl: typeof fetch, customerId: string, token: string, post: DraftPost, waits?: number[]): Promise<CreatedPost> {
  const r = await sproutRequest(fetchImpl, `${API_BASE}/${encodeURIComponent(customerId)}/publishing/posts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(draftPostBody(post)),
  }, { resendOn: [429, 503], network: false, waits });
  if (!r.ok) throw await refusal("post", r, "Sprout did not create the post");
  const data = await r.json().catch(() => null);
  // deno-lint-ignore no-explicit-any
  const mine = ((data?.data ?? []) as any[]).find((d) => String(d?.customer_profile_id) === String(post.profileId));
  const publishing = mine?.internal?.publishing;
  if (!publishing?.publishing_post_id) throw new SproutRefusal("post", r.status, "Sprout made no post for the profile.", JSON.stringify(data ?? null).slice(0, 500));
  return {
    publishingPostId: String(publishing.publishing_post_id),
    permaLink: publishing.perma_link ? String(publishing.perma_link) : null,
    scheduledTime: publishing.deliveries?.[0]?.scheduled_time ? String(publishing.deliveries[0].scheduled_time) : null,
  };
}
