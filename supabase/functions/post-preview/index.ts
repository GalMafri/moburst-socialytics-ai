// Resolve a thumbnail for a social post URL (feedback item 2).
//
// Sprout's post analytics carry text, metrics and a permalink but no media, so
// the monthly report could not show what was actually posted. This resolves a
// preview per URL and caches it in post_previews:
//   YouTube   → thumbnail from the video id (no auth needed)
//   TikTok    → public oEmbed (thumbnail_url)
//   others    → og:image / og:video from the page, best effort (Instagram and
//               Facebook frequently refuse anonymous fetches; then 'unavailable')
// Competitor posts from RivalIQ already carry an image and skip this entirely.
// Any signed-in user may call it (read-only, no client data involved).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TTL_DAYS = 14;

type Preview = { url: string; platform: string | null; media_type: string; image_url: string | null; title: string | null; status: "ok" | "unavailable" };

function platformOf(url: string): string | null {
  const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
  if (h.includes("tiktok.com")) return "tiktok";
  if (h.includes("instagram.com")) return "instagram";
  if (h.includes("facebook.com") || h.includes("fb.com")) return "facebook";
  if (h.includes("linkedin.com")) return "linkedin";
  if (h.includes("x.com") || h.includes("twitter.com")) return "x";
  return null;
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

async function ogPreview(url: string): Promise<Partial<Preview>> {
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  if (!resp.ok) return { status: "unavailable" };
  const html = (await resp.text()).slice(0, 400_000);
  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
    return (html.match(re) || html.match(re2))?.[1] || null;
  };
  const image = meta("og:image") || meta("twitter:image");
  const video = meta("og:video") || meta("og:video:url");
  const title = meta("og:title");
  if (!image && !video) return { status: "unavailable", title };
  return { image_url: image, media_type: video ? "video" : "image", title, status: "ok" };
}

async function resolve(url: string): Promise<Preview> {
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
        if (j.thumbnail_url) return { ...base, media_type: "video", image_url: j.thumbnail_url, title: j.title || null, status: "ok" };
      }
    }
    const og = await ogPreview(url);
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
    const urls: string[] = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
    const clean = [...new Set(urls.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 40);
    if (clean.length === 0) return json({ previews: {} });

    const { data: cached } = await supabase.from("post_previews").select("*").in("url", clean);
    const fresh = new Date(Date.now() - TTL_DAYS * 86400000).toISOString();
    const out: Record<string, Preview> = {};
    const todo: string[] = [];
    for (const u of clean) {
      const c = (cached || []).find((x) => x.url === u);
      if (c && c.fetched_at > fresh && (c.status === "ok" || c.status === "unavailable")) out[u] = c as Preview;
      else todo.push(u);
    }
    // Resolve misses with modest concurrency; failures are cached as unavailable
    // so a stubborn Instagram permalink is not re-fetched on every page view.
    const results = await Promise.all(todo.slice(0, 12).map(resolve));
    for (const p of results) {
      out[p.url] = p;
      await supabase.from("post_previews").upsert({ ...p, fetched_at: new Date().toISOString() }, { onConflict: "url" });
    }
    return json({ previews: out });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
