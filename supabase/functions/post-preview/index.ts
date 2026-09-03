// Resolve a thumbnail for a social post URL (feedback item 2).
//
// Sprout's post analytics carry text, metrics and a permalink but no media, so
// the monthly report could not show what was actually posted. This resolves a
// preview per URL and caches it in post_previews:
//   YouTube   → thumbnail from the video id (no auth needed)
//   TikTok    → public oEmbed (thumbnail_url)
//   RivalIQ   → the creative RivalIQ already fetched for every company in a
//               landscape (passed in by the caller, or found in the cached
//               socialposts snapshots by permalink)
//   others    → og:image / og:video from the page, best effort (Instagram,
//               Facebook and LinkedIn refuse anonymous fetches)
// Instagram and Facebook image links are signed and expire after a few days,
// so those are copied into the public generated-media bucket and the durable
// copy is what gets cached. Any signed-in user may call this (read-only data).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
// Facebook and LinkedIn serve their Open Graph tags (and Facebook its crawler
// image host) to link-preview crawlers only.
const CRAWLER_UA = "Twitterbot/1.0";
const OK_TTL_MS = 30 * 86400000;
const MISS_TTL_MS = 60 * 60000;
const BUCKET = "generated-media";
// Object names carry the byte length, and the folder is versioned: the storage
// CDN caches by path for up to an hour, so a path must never change content.
const FOLDER = "post-thumbnails/v2";
const MAX_PER_CALL = 40;
const CONCURRENCY = 8;

type Preview = { url: string; platform: string | null; media_type: string; image_url: string | null; title: string | null; status: "ok" | "unavailable" };
type Hint = { url: string; image?: string | null; media_type?: string | null };
type Db = ReturnType<typeof createClient>;

function platformOf(url: string): string | null {
  const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
  if (h.includes("tiktok.com")) return "tiktok";
  if (h.includes("instagram.com")) return "instagram";
  if (h.includes("facebook.com") || h.includes("fb.com") || h.includes("fb.watch")) return "facebook";
  if (h.includes("linkedin.com")) return "linkedin";
  if (h.includes("x.com") || h.includes("twitter.com")) return "x";
  return null;
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

const isVideoFile = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);
// Signed CDN links that stop working after hours or days; always copied into the bucket.
const isExpiringCdn = (u: string) => /cdninstagram\.com|fbcdn\.net|scontent[-.]|lookaside\.fbsbx\.com|media\.licdn\.com|tiktokcdn(-[a-z]+)?\.com/i.test(u);
// LinkedIn answers some posts with its generic logo instead of the creative.
const isGenericPlaceholder = (u: string) => /static\.licdn\.com\/aero-v1\/sc\/h\//i.test(u);

function mediaTypeOf(t: string | null | undefined): string {
  const s = String(t || "").toLowerCase();
  if (s.includes("video") || s.includes("reel")) return "video";
  if (s.includes("carousel") || s.includes("album")) return "carousel";
  if (s.includes("photo") || s.includes("image")) return "image";
  return "unknown";
}

async function sha1(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Copy an expiring image into the public bucket; returns the durable URL or null. */
async function persist(supabase: Db, sourceUrl: string, postUrl: string): Promise<string | null> {
  try {
    // Facebook's crawler image host only answers link-preview crawlers.
    const crawlerFirst = /lookaside\.fbsbx\.com|media\.licdn\.com/i.test(sourceUrl);
    let r = await fetch(sourceUrl, { headers: { "User-Agent": crawlerFirst ? CRAWLER_UA : UA, Accept: "image/*" } });
    if (!r.ok) r = await fetch(sourceUrl, { headers: { "User-Agent": crawlerFirst ? UA : CRAWLER_UA, Accept: "image/*" } });
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 8_000_000) return null;
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const path = `${FOLDER}/${await sha1(postUrl)}-${bytes.length}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: ct, upsert: true, cacheControl: "31536000" });
    if (error) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || null;
  } catch {
    return null;
  }
}

/**
 * Instagram serves Reels as signed video files that browsers cannot load
 * cross-site. The opening bytes (progressive MP4, index first) are enough for
 * a first frame (Chrome needs the first GOP, which can sit past 1MB), so a 2MB
 * slice is copied into the bucket and served from there with a long cache
 * lifetime (the object name is a hash of the post URL).
 */
async function persistVideoHead(supabase: Db, sourceUrl: string, postUrl: string): Promise<string | null> {
  try {
    const r = await fetch(sourceUrl, { headers: { "User-Agent": UA, Range: "bytes=0-1999999" } });
    if (!(r.status === 200 || r.status === 206)) return null;
    const ct = (r.headers.get("content-type") || "video/mp4").split(";")[0].trim();
    if (!ct.startsWith("video/")) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 10_000 || bytes.length > 2_100_000) return null;
    const path = `${FOLDER}/${await sha1(postUrl)}-${bytes.length}.mp4`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true, cacheControl: "31536000" });
    if (error) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || null;
  } catch {
    return null;
  }
}

/**
 * Instagram exposes the full-size creative of any public post, photo or Reel,
 * behind a redirect at /p/<shortcode>/media/?size=l. The target is a signed
 * CDN link, so it is copied into the bucket right away.
 */
function instagramShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i);
  return m ? m[1] : null;
}

async function instagramMedia(supabase: Db, url: string): Promise<string | null> {
  const code = instagramShortcode(url);
  if (!code) return null;
  const r = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`, { headers: { "User-Agent": UA }, redirect: "manual" });
  const target = r.headers.get("location");
  if (!(r.status >= 300 && r.status < 400) || !target || !/^https?:\/\//i.test(target)) return null;
  return (await persist(supabase, target, url)) || target;
}

async function ogPreview(url: string, userAgent: string = UA): Promise<Partial<Preview>> {
  const resp = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html" }, redirect: "follow" });
  if (!resp.ok) return { status: "unavailable" };
  const html = (await resp.text()).slice(0, 400_000);
  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
    return (html.match(re) || html.match(re2))?.[1] || null;
  };
  const rawImage = meta("og:image") || meta("twitter:image");
  const image = rawImage && !isGenericPlaceholder(rawImage) ? rawImage : null;
  const video = meta("og:video") || meta("og:video:url");
  const title = meta("og:title");
  if (!image && !video) return { status: "unavailable", title };
  return { image_url: image, media_type: video ? "video" : "image", title, status: "ok" };
}

/**
 * RivalIQ already fetched the creative for every company in a landscape,
 * including the client. Its raw socialposts responses are cached in
 * rivaliq_snapshots, so a client's post can be matched there by permalink
 * instead of scraping a login-walled page.
 */
async function rivaliqLookup(supabase: Db, url: string): Promise<{ image: string; media_type: string; title: string | null } | null> {
  const variants = [...new Set([url, url.replace(/\/+$/, ""), url.endsWith("/") ? url : url + "/"])];
  for (const v of variants) {
    const { data } = await supabase
      .from("rivaliq_snapshots")
      .select("payload")
      .eq("endpoint", "socialposts")
      .contains("payload", { socialPosts: [{ postLink: v }] })
      .order("fetched_at", { ascending: false })
      .limit(1);
    const posts: any[] = (data?.[0] as any)?.payload?.socialPosts || [];
    const post = posts.find((p) => p?.postLink === v);
    const image = post?.imageLarge || post?.image;
    if (image) return { image, media_type: mediaTypeOf(post.type), title: post.message ? String(post.message).slice(0, 140) : null };
  }
  return null;
}

async function resolve(supabase: Db, hint: Hint): Promise<Preview> {
  const url = hint.url;
  const platform = platformOf(url);
  const base: Preview = { url, platform, media_type: "unknown", image_url: null, title: null, status: "unavailable" };
  try {
    if (platform === "youtube") {
      const id = youtubeId(url);
      if (id) return { ...base, media_type: "video", image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, status: "ok" };
    }
    if (platform === "tiktok") {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA } });
      if (r.ok) {
        const j = await r.json();
        if (j.thumbnail_url) {
          // TikTok thumbnails are signed and expire within a day; keep a copy.
          const durable = await persist(supabase, j.thumbnail_url, url);
          return { ...base, media_type: "video", image_url: durable || j.thumbnail_url, title: j.title || null, status: "ok" };
        }
      }
    }
    let image = hint.image || null;
    let media_type = mediaTypeOf(hint.media_type);
    let title: string | null = null;
    if (platform === "instagram") {
      // A poster image beats a video slice: lighter, and it covers Reels
      // that RivalIQ has no creative for.
      const poster = await instagramMedia(supabase, url).catch(() => null);
      if (poster) {
        const kind = media_type !== "unknown" ? media_type : (/\/(reel|reels|tv)\//i.test(url) || (image && isVideoFile(image)) ? "video" : "image");
        return { ...base, media_type: kind, image_url: poster, title, status: "ok" };
      }
    }
    if (!image) {
      const hit = await rivaliqLookup(supabase, url).catch(() => null);
      if (hit) { image = hit.image; media_type = hit.media_type; title = hit.title; }
    }
    if (image) {
      // Reels arrive as the video file itself; the client renders a frame from it.
      if (isVideoFile(image)) {
        const durable = isExpiringCdn(image) ? await persistVideoHead(supabase, image, url) : null;
        return { ...base, media_type: "video", image_url: durable || image, title, status: "ok" };
      }
      const durable = isExpiringCdn(image) ? await persist(supabase, image, url) : null;
      return { ...base, media_type: media_type === "unknown" ? "image" : media_type, image_url: durable || image, title, status: "ok" };
    }
    const og = await ogPreview(url, platform === "facebook" || platform === "linkedin" ? CRAWLER_UA : UA);
    if (og.status === "ok" && og.image_url) {
      const durable = isExpiringCdn(og.image_url) ? await persist(supabase, og.image_url, url) : null;
      return { ...base, ...og, image_url: durable || og.image_url } as Preview;
    }
    return { ...base, ...og, media_type: og.media_type || base.media_type } as Preview;
  } catch {
    return base;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Sign-in required." }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: who } = await supabase.auth.getUser(auth.slice(7));
    if (!who?.user) return json({ error: "Invalid or expired session." }, 401);

    const body = await req.json();
    const hints = new Map<string, Hint>();
    const add = (h: Hint) => {
      const u = String(h.url || "").trim();
      if (/^https?:\/\//i.test(u) && !hints.has(u) && hints.size < MAX_PER_CALL) hints.set(u, { url: u, image: h.image || null, media_type: h.media_type || null });
    };
    if (Array.isArray(body.posts)) for (const p of body.posts) if (p && typeof p === "object") add({ url: p.url, image: p.image ?? p.image_url ?? null, media_type: p.media_type ?? p.mediaType ?? null });
    if (Array.isArray(body.urls)) for (const u of body.urls) add({ url: String(u || "") });
    if (body.url) add({ url: String(body.url) });
    const all = [...hints.keys()];
    if (all.length === 0) return json({ previews: {} });

    const { data: cached } = await supabase.from("post_previews").select("*").in("url", all);
    const now = Date.now();
    const out: Record<string, Preview> = {};
    const todo: Hint[] = [];
    for (const u of all) {
      const c = (cached || []).find((x) => x.url === u) as (Preview & { fetched_at: string }) | undefined;
      const age = c ? now - new Date(c.fetched_at).getTime() : Infinity;
      // A miss is retried after an hour, or straight away when the caller now knows the creative.
      const hintedCreative = !!hints.get(u)?.image;
      const valid = c && ((c.status === "ok" && age < OK_TTL_MS) || (c.status !== "ok" && age < MISS_TTL_MS && !hintedCreative));
      // A cached hit that still points at an expiring CDN link (image or video) is re-resolved so it gets a durable copy.
      if (valid && !(c!.status === "ok" && c!.image_url && isExpiringCdn(c!.image_url))) out[u] = c as Preview;
      else todo.push(hints.get(u)!);
    }
    const results: Preview[] = [];
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      results.push(...(await Promise.all(todo.slice(i, i + CONCURRENCY).map((h) => resolve(supabase, h)))));
    }
    if (results.length > 0) {
      const stamp = new Date().toISOString();
      await supabase.from("post_previews").upsert(results.map((p) => ({ ...p, fetched_at: stamp })), { onConflict: "url" });
      for (const p of results) out[p.url] = p;
    }
    return json({ previews: out });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
