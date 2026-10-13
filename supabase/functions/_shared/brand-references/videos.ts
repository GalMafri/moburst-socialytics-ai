// supabase/functions/_shared/brand-references/videos.ts
//
// A client's own published videos, kept so a video post can be made in the
// client's own video style (Lital, 13 Oct: video must reference the client's
// existing videos). They come from Sprout's owned published posts, like the
// photo references (discover.ts): the most-seen recent video posts of the
// client's assigned profiles, downloaded once into the references bucket.

import { allowedMediaUrl } from "./mediaFetch.ts";
import { defaultSproutCustomerId } from "../sprout/customer.ts";

const DAY = 86400000;
/** How many of the client's videos are kept. */
export const VIDEO_REFS = 3;
/** A reference video larger than this is skipped. */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export interface VideoCandidate {
  source_post_id: string;
  source_url: string;
  profile_id: string;
  platform: string;
  posted_at: string;
  video_url: string;
  impressions: number;
}

export interface VideoReference {
  path: string;
  source_post_id: string;
  source_url: string;
  platform: string;
  posted_at: string;
  impressions: number;
  bytes: number;
}

/**
 * The client's own video posts with a downloadable video, most seen first.
 * Only rows from the assigned profiles count, as for photo references.
 */
export function sproutVideoCandidates(rows: any[], profileIds: string[]): VideoCandidate[] {
  const allowed = new Set(profileIds);
  const seen = new Set<string>();
  return rows.flatMap((p): VideoCandidate[] => {
    const profile = String(p.customer_profile_id ?? p.dimensions?.customer_profile_id ?? "");
    if (!allowed.has(profile) || p.sent === false || !p.guid || !p.perma_link) return [];
    const media = (Array.isArray(p.visual_media) ? p.visual_media : []).find((m: any) =>
      String(m.media_type).toUpperCase() === "VIDEO" && typeof m.media_url === "string");
    if (!media || seen.has(media.media_url)) return [];
    try { allowedMediaUrl(media.media_url); } catch { return []; }
    seen.add(media.media_url);
    return [{
      source_post_id: String(p.guid), source_url: String(p.perma_link), profile_id: profile,
      platform: String(p.network || ""), posted_at: String(p.created_time || ""), video_url: media.media_url,
      impressions: Number(p.metrics?.["lifetime.impressions"] ?? 0) || 0,
    }];
  }).sort((a, b) => b.impressions - a.impressions || b.posted_at.localeCompare(a.posted_at));
}

/** Download one provider-hosted video, following only allowed redirects, within the size cap. */
async function videoBytes(value: string): Promise<Uint8Array> {
  let url = allowedMediaUrl(value);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(url.href, { redirect: "manual", signal: AbortSignal.timeout(60000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Video redirect has no destination");
      url = allowedMediaUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`Video unavailable (${response.status})`);
    const type = (response.headers.get("content-type") || "").split(";")[0];
    if (!/^video\/(mp4|quicktime)$/.test(type)) { await response.body?.cancel(); throw new Error(`Not a video file (${type})`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty video");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > MAX_VIDEO_BYTES) { await reader.cancel(); throw new Error("Video too large"); }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return bytes;
  }
  throw new Error("Too many video redirects");
}

/**
 * Find and keep the client's own videos (up to VIDEO_REFS), returning what was
 * kept. The caller stores the list on the client.
 */
export async function discoverVideoReferences(db: any, client: { id: string; sprout_customer_id?: string | null }): Promise<{ refs: VideoReference[]; posts: number; candidates: number; skipped: string[] }> {
  const { data: profiles, error } = await db.from("sprout_profiles").select("sprout_profile_id").eq("client_id", client.id).eq("is_active", true);
  if (error) throw new Error("Could not read assigned social accounts");
  const ids = (profiles || []).map((p: any) => String(p.sprout_profile_id));
  if (!ids.length) return { refs: [], posts: 0, candidates: 0, skipped: ["no assigned social accounts"] };
  const customer = String(client.sprout_customer_id || defaultSproutCustomerId());
  const token = await (await fetch("https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("SPROUT_CLIENT_ID") || "", client_secret: Deno.env.get("SPROUT_CLIENT_SECRET") || "", grant_type: "client_credentials", scope: "organization_id" }),
    signal: AbortSignal.timeout(15000),
  })).json();
  if (!token?.access_token) throw new Error("The social account connection did not answer.");
  const start = new Date(Date.now() - 180 * DAY).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const posts: any[] = [];
  for (let page = 1; page <= 4; page++) {
    const resp = await fetch(`https://api.sproutsocial.com/v1/${encodeURIComponent(customer)}/analytics/posts`, {
      method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filters: [`customer_profile_id.eq(${ids.join(",")})`, `created_time.in(${start}T00:00:00...${end}T23:59:59)`],
        fields: ["guid", "customer_profile_id", "network", "created_time", "perma_link", "content_category", "visual_media"],
        metrics: ["lifetime.impressions"], sort: ["lifetime.impressions:desc"], timezone: "UTC", page, limit: 50 }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || !Array.isArray(result.data)) throw new Error(`Published-post lookup failed (${resp.status}).`);
    posts.push(...result.data);
    if (page >= Number(result.paging?.total_pages || 1)) break;
  }
  const candidates = sproutVideoCandidates(posts, ids);
  console.info("[video-references] shape", JSON.stringify({ posts: posts.length, candidates: candidates.length,
    categories: [...new Set(posts.map((p) => p.content_category))],
    media: posts.flatMap((p) => (p.visual_media || []).slice(0, 1).map((m: any) => ({ type: m.media_type, host: (() => { try { return new URL(m.media_url).hostname; } catch { return null; } })() }))).slice(0, 12) }));
  const refs: VideoReference[] = [];
  const skipped: string[] = [];
  for (const c of candidates) {
    if (refs.length >= VIDEO_REFS) break;
    try {
      const bytes = await videoBytes(c.video_url);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))).map((b) => b.toString(16).padStart(2, "0")).join("");
      const path = `${client.id}/video-${hash.slice(0, 32)}.mp4`;
      const { error: up } = await db.storage.from("design-references").upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (up) throw new Error(`Storage: ${up.message}`);
      refs.push({ path, source_post_id: c.source_post_id, source_url: c.source_url, platform: c.platform, posted_at: c.posted_at, impressions: c.impressions, bytes: bytes.length });
    } catch (e) {
      skipped.push(`${c.platform} ${c.source_post_id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
  return { refs, posts: posts.length, candidates: candidates.length, skipped };
}
