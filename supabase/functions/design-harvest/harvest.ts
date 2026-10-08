// The Sprout harvest: a client's own published posts into the design-references
// bucket and brand_assets, one row per file, with the Sprout facts as provenance.
// Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, sections 1 and 11.
//
// This replaces the sampling that _shared/brand-references/discover.ts did for
// the old synthesis: the same token, the same analytics/posts request, but no
// cap of eight, every album slide rather than one, a 180-day window, and video
// posts kept as their thumbnail. Idempotent on (client_id, sha256), so a run
// that stops partway resumes on the next call: every file already on record is
// skipped after its download.
//
// Posts come from Sprout only; there is no other source in this file. Every
// row is bound to the client's saved active profile ids, never another
// client's, and received rows (sent === false) are refused as before.
//
// Everything the function touches from outside is a dependency, so Vitest
// drives it with fakes and no test reaches the network.

import { defaultSproutCustomerId } from "../_shared/sprout/customer.ts";

export interface Classification {
  usable: boolean;
  confidence: number;
  reason: string;
}

export interface HarvestDeps {
  /** A service-role supabase client (brand_assets has no write policy for users). */
  // deno-lint-ignore no-explicit-any
  db: any;
  sproutToken(): Promise<string>;
  /** The provider's media only; the caller validates hosts (mediaFetch.ts). */
  fetchImage(url: string): Promise<{ bytes: Uint8Array; mime: string }>;
  /** The vision check on one still. Video thumbnails are never classified. */
  classify(bytes: Uint8Array, mime: string, clientName: string): Promise<Classification>;
  now(): Date;
  /** The Sprout analytics/posts request. Defaults to fetch; tests hand in a fake. */
  send?: typeof fetch;
}

export interface HarvestResult {
  /** Owned posts that offered at least one file. */
  posts: number;
  /** Stills stored this run. */
  slides: number;
  /** Video thumbnails stored this run. */
  videos: number;
  /** Files not stored: already on record, rejected by the check, or failed to download. */
  skipped: number;
  stored: number;
}

interface Candidate {
  kind: "post" | "video";
  url: string;
  source_post_id: string;
  source_url: string;
  profile_id: string;
  platform: string;
  posted_at: string;
  slide_index: number;
  impressions: number | null;
  text: string | null;
}

export const SPROUT_API_BASE = "https://api.sproutsocial.com/v1";
export const WINDOW_DAYS = 180;
export const PAGE_LIMIT = 50;
export const MAX_PAGES = 10;
export const MIN_CONFIDENCE = 0.8;
export const BUCKET = "design-references";
const TEXT_CHARS = 500;
const DAY = 86400000;
const CONCURRENCY = 4;

export function usable(value: Classification | null | undefined): boolean {
  return value?.usable === true && typeof value?.confidence === "number" && value.confidence >= MIN_CONFIDENCE
    && typeof value?.reason === "string" && value.reason.length > 0;
}

/**
 * The files one page of analytics/posts offers, bound to the saved profiles.
 * PHOTO and ALBUM posts give every PHOTO entry, slide_index being its position
 * in the post; a VIDEO post gives its first entry's thumbnail (or the media
 * url when there is none). Anything else (links, text) is not a design.
 */
// deno-lint-ignore no-explicit-any
export function sproutFiles(rows: any[], profileIds: string[]): Candidate[] {
  const allowed = new Set(profileIds);
  const out: Candidate[] = [];
  for (const p of rows) {
    const profile = String(p.customer_profile_id ?? p.dimensions?.customer_profile_id ?? "");
    if (!allowed.has(profile) || p.sent === false || !p.guid || !p.perma_link) continue;
    const category = String(p.content_category ?? "").toUpperCase();
    const media = Array.isArray(p.visual_media) ? p.visual_media : [];
    const base = {
      source_post_id: String(p.guid), source_url: String(p.perma_link), profile_id: profile,
      platform: String(p.network ?? ""), posted_at: String(p.created_time ?? ""),
      impressions: numberOrNull(p.metrics?.["lifetime.impressions"]),
      text: typeof p.text === "string" && p.text.length ? p.text.slice(0, TEXT_CHARS) : null,
    };
    if (category === "PHOTO" || category === "ALBUM") {
      media.forEach((m: any, slide_index: number) => {
        if (String(m?.media_type ?? "").toUpperCase() !== "PHOTO" || typeof m.media_url !== "string") return;
        out.push({ ...base, kind: "post", url: m.media_url, slide_index });
      });
    } else if (category === "VIDEO") {
      const first = media[0];
      const url = typeof first?.thumbnail_url === "string" ? first.thumbnail_url : typeof first?.media_url === "string" ? first.media_url : null;
      if (url) out.push({ ...base, kind: "video", url, slide_index: 0 });
    }
  }
  return out;
}

function numberOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extensionOf(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

async function responseJson(response: Response, label: string) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = [body.message, body.error?.message, ...(Array.isArray(body.errors) ? body.errors.map((e: any) => e.message) : [])]
      .filter((s) => typeof s === "string").join(" ").replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
    throw new Error(`${label} failed (${response.status}). ${detail || "Retry after checking the connection."}`);
  }
  return response.json();
}

/** Every owned post of the window, newest impressions first, at most MAX_PAGES pages of PAGE_LIMIT. */
async function sproutPosts(deps: HarvestDeps, customer: string, profileIds: string[]): Promise<any[]> {
  const send = deps.send ?? fetch;
  const token = await deps.sproutToken();
  const now = deps.now();
  const start = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const posts: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await responseJson(await send(`${SPROUT_API_BASE}/${encodeURIComponent(customer)}/analytics/posts`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: [`customer_profile_id.eq(${profileIds.join(",")})`, `created_time.in(${start}T00:00:00...${end}T23:59:59)`],
        fields: ["guid", "customer_profile_id", "network", "created_time", "perma_link", "content_category", "visual_media", "text"],
        metrics: ["lifetime.impressions"], sort: ["lifetime.impressions:desc"], timezone: "UTC", page, limit: PAGE_LIMIT,
      }),
      signal: AbortSignal.timeout(15000),
    }), "Published-post lookup");
    if (!Array.isArray(result.data)) throw new Error("Published-post lookup returned invalid data");
    posts.push(...result.data);
    if (page >= Number(result.paging?.total_pages || 1)) break;
  }
  return posts;
}

export async function harvestClient(deps: HarvestDeps, clientId: string): Promise<HarvestResult> {
  const { db } = deps;
  const { data: client, error: clientError } = await db.from("clients").select("id, name, sprout_customer_id").eq("id", clientId).maybeSingle();
  if (clientError) throw new Error("Could not read the client");
  if (!client) throw new Error("Client not found");
  const { data: profiles, error: profilesError } = await db.from("sprout_profiles").select("sprout_profile_id")
    .eq("client_id", clientId).eq("is_active", true);
  if (profilesError) throw new Error("Could not read assigned social accounts");
  const ids: string[] = (profiles || []).map((p: any) => String(p.sprout_profile_id));
  if (!ids.length) throw new Error("Assign the client’s social accounts and save; their published posts are read from there.");
  const customer = String(client.sprout_customer_id || defaultSproutCustomerId());

  const posts = await sproutPosts(deps, customer, ids);
  const files = sproutFiles(posts, ids);
  const result: HarvestResult = { posts: new Set(files.map((f) => f.source_post_id)).size, slides: 0, videos: 0, skipped: 0, stored: 0 };

  // One download per distinct url within a run; cross-posted images share one.
  const seenUrl = new Set<string>();
  const queue = files.filter((f) => (seenUrl.has(f.url) ? false : (seenUrl.add(f.url), true)));

  for (let at = 0; at < queue.length; at += CONCURRENCY) {
    await Promise.all(queue.slice(at, at + CONCURRENCY).map(async (file) => {
      try {
        const image = await deps.fetchImage(file.url);
        const hash = await sha256(image.bytes);
        const { data: existing, error: existsError } = await db.from("brand_assets").select("id")
          .eq("client_id", clientId).eq("sha256", hash).maybeSingle();
        if (existsError) throw new Error("Could not read brand assets");
        if (existing) { result.skipped++; return; }

        let classification: Classification | null = null;
        if (file.kind === "post") {
          classification = await deps.classify(image.bytes, image.mime, String(client.name ?? ""));
          if (!usable(classification)) { result.skipped++; return; }
        }

        const path = `${clientId}/post-${hash}.${extensionOf(image.mime)}`;
        const { error: uploadError } = await db.storage.from(BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: true });
        if (uploadError) throw new Error("Reference storage failed");
        const { url: _url, kind, ...facts } = file;
        const { error: insertError } = await db.from("brand_assets").insert({
          client_id: clientId, kind, path, sha256: hash,
          provenance: { source: "sprout", ...facts, classification: classification?.reason ?? null, confidence: classification?.confidence ?? null },
        });
        if (insertError) {
          // Another worker filed the same bytes first: on record either way.
          if (insertError.code === "23505") { result.skipped++; return; }
          throw new Error(insertError.message || "Could not record the asset");
        }
        if (kind === "video") result.videos++; else result.slides++;
        result.stored++;
      } catch (error) {
        console.warn("[design-harvest] skipped", file.source_post_id, error instanceof Error ? error.message : "unknown");
        result.skipped++;
      }
    }));
  }
  return result;
}
