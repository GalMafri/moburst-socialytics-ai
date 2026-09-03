// The one way posts are shown across the app: a real thumbnail of the creative
// (image, video frame or carousel cover), the platform, the media type, and a
// click-through to the original post.
//
// Every tile has the same fixed frame so cards line up; inside it the creative
// keeps its own format (a 9:16 Reel stands tall, a 16:9 YouTube thumbnail sits
// wide, a square stays square) over a soft blurred backdrop of itself.
//
// Competitor posts arrive from RivalIQ with an `image` URL already attached.
// Client posts come from Sprout, which carries no media, so their thumbnails
// are resolved by the post-preview edge function and cached in post_previews;
// `usePostPreviews` batches that lookup for a whole list of posts.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Play, Layers, Image as ImageIcon, ExternalLink } from "lucide-react";

export type MediaKind = "video" | "carousel" | "image" | "text";

export type PostPreview = {
  url: string;
  platform: string | null;
  media_type: string | null;
  image_url: string | null;
  title: string | null;
  status: "ok" | "unavailable" | "miss" | "pending" | "error";
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
  twitter: "X",
  pinterest: "Pinterest",
  threads: "Threads",
};

export function normalizePlatform(value: string | null | undefined): string {
  const v = String(value || "").toLowerCase().trim();
  if (!v) return "";
  if (v.includes("insta")) return "instagram";
  if (v.includes("tik")) return "tiktok";
  if (v.includes("face") || v === "fb") return "facebook";
  if (v.includes("linked")) return "linkedin";
  if (v.includes("you")) return "youtube";
  if (v === "x" || v.includes("twitter")) return "x";
  if (v.includes("pin")) return "pinterest";
  if (v.includes("thread")) return "threads";
  return v;
}

export function platformLabel(value: string | null | undefined): string {
  const key = normalizePlatform(value);
  return PLATFORM_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Post");
}

export function platformFromUrl(url: string | null | undefined): string {
  const u = String(url || "").toLowerCase();
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("twitter.com") || u.includes("x.com")) return "x";
  return "";
}

export function mediaKind(value: string | null | undefined, url?: string | null): MediaKind {
  const v = String(value || "").toLowerCase();
  if (v.includes("video") || v.includes("reel") || v.includes("short") || v.includes("igtv")) return "video";
  if (v.includes("carousel") || v.includes("album") || v.includes("multi") || v.includes("sidecar")) return "carousel";
  if (v.includes("photo") || v.includes("image") || v.includes("picture")) return "image";
  if (v.includes("text") || v.includes("status") || v.includes("link")) return "text";
  const p = platformFromUrl(url);
  if (p === "tiktok" || p === "youtube") return "video";
  if (String(url || "").includes("/reel/")) return "video";
  return "image";
}

export function mediaLabel(kind: MediaKind): string {
  return kind === "video" ? "Video" : kind === "carousel" ? "Carousel" : kind === "text" ? "Text" : "Image";
}

export type PreviewHint = { url: string | null | undefined; image?: string | null; mediaType?: string | null };

/**
 * Resolves thumbnails for a set of posts through the post-preview function.
 * Pass every post you plan to render (a URL, or a URL plus the creative you
 * already know, so an expiring CDN link can be copied into our storage); the
 * hook dedupes, skips empty values and caches results for the session.
 */
export function usePostPreviews(items: Array<string | PreviewHint | null | undefined>, enabled = true) {
  const list = useMemo(() => {
    const map = new Map<string, { url: string; image: string | null; media_type: string | null }>();
    for (const it of items) {
      const h = typeof it === "string" ? { url: it } : it;
      const u = h?.url;
      if (u && /^https?:\/\//i.test(u) && !map.has(u)) map.set(u, { url: u, image: h?.image ?? null, media_type: h?.mediaType ?? null });
    }
    return Array.from(map.values()).sort((a, b) => a.url.localeCompare(b.url));
  }, [items]);

  const query = useQuery({
    queryKey: ["post-previews", list.map((x) => x.url)],
    queryFn: async () => {
      const out: Record<string, PostPreview> = {};
      for (let i = 0; i < list.length; i += 40) {
        const chunk = list.slice(i, i + 40);
        const { data, error } = await supabase.functions.invoke("post-preview", { body: { posts: chunk } });
        if (error) throw error;
        Object.assign(out, (data as any)?.previews || {});
      }
      return out;
    },
    enabled: enabled && list.length > 0,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return { previews: query.data || {}, isLoading: query.isLoading, error: query.error };
}

// Video frames load only when the tile is near the viewport, and at most a
// few at a time. Storage shares its HTTP/2 connection with the Supabase API,
// and a dozen parallel media streams starve everything else on the page.
const MAX_CONCURRENT_VIDEO_LOADS = 3;
let activeVideoLoads = 0;
const videoLoadQueue: Array<() => void> = [];
function scheduleVideoLoad(start: () => Promise<void>) {
  const run = () => {
    activeVideoLoads += 1;
    start().finally(() => {
      activeVideoLoads -= 1;
      const next = videoLoadQueue.shift();
      if (next) next();
    });
  };
  if (activeVideoLoads < MAX_CONCURRENT_VIDEO_LOADS) run();
  else videoLoadQueue.push(run);
}

type PostVisualProps = {
  url?: string | null;
  /** A thumbnail already known for the post (RivalIQ `image`). */
  image?: string | null;
  /** A resolved preview from usePostPreviews, if any. */
  preview?: PostPreview | null;
  mediaType?: string | null;
  platform?: string | null;
  className?: string;
  /** Hide the platform and type badges (for very small tiles). */
  compact?: boolean;
  /** Tailwind aspect class for the fixed frame. Defaults to 4:5; compact tiles default to square. */
  frame?: string;
  /** Kept for callers; the fixed frame already bounds the height. */
  maxHeight?: string;
};

/**
 * Thumbnail tile in a fixed frame, linking to the original post. The creative
 * keeps its own format inside the frame; a labelled placeholder takes the
 * frame when no creative could be resolved.
 */
export function PostVisual({ url, image, preview, mediaType, platform, className = "", compact = false, frame }: PostVisualProps) {
  // Sources in order of preference: the resolved preview first (a durable copy
  // in our storage when the original is an expiring CDN link), then the
  // creative the report already carries. A source that fails to load hands
  // over to the next one; the placeholder comes last.
  const candidates = useMemo(() => {
    const list: string[] = [];
    for (const c of [preview?.image_url, image]) if (c && !list.includes(c)) list.push(c);
    return list;
  }, [preview?.image_url, image]);
  const [failed, setFailed] = useState<string[]>([]);
  const src = candidates.find((c) => !failed.includes(c)) || null;
  const fail = () => { if (src) setFailed((f) => [...f, src]); };
  // RivalIQ hands back the video file itself for Instagram Reels; a muted
  // <video> shows its first frame where an <img> would fail.
  const isVideoFile = !!src && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(src);
  const kind = mediaKind(mediaType || preview?.media_type, url);
  const plat = normalizePlatform(platform || preview?.platform || platformFromUrl(url));
  const aspect = frame || (compact ? "aspect-square" : "aspect-[4/5]");
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src || !isVideoFile) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      scheduleVideoLoad(() => new Promise<void>((done) => {
        if (cancelled || !videoRef.current) return done();
        const v = videoRef.current;
        const finish = () => { v.removeEventListener("loadeddata", finish); v.removeEventListener("error", finish); done(); };
        v.addEventListener("loadeddata", finish);
        v.addEventListener("error", finish);
        setTimeout(finish, 20000);
        v.preload = "metadata";
        v.src = `${src}#t=0.1`;
        v.load();
      }));
    }, { rootMargin: "300px" });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [src, isVideoFile]);

  const body = (
    <>
      {src && !isVideoFile && (
        <img src={src} alt="" aria-hidden referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover scale-110 blur-2xl opacity-50" />
      )}
      {src && isVideoFile ? (
        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          onError={fail}
          className="absolute inset-0 h-full w-full object-contain pointer-events-none"
        />
      ) : src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={fail}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] text-muted-foreground">
          {kind === "video" ? <Play className="h-7 w-7" /> : kind === "carousel" ? <Layers className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}
          {!compact && <span className="text-xs">{url ? `Open on ${platformLabel(plat)}` : "No link"}</span>}
        </div>
      )}
      {src && kind === "video" && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-11 w-11 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center"><Play className="h-5 w-5 text-white ml-0.5" fill="white" /></span>
        </span>
      )}
      {!compact && (
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2 text-[11px] font-medium">
          {plat ? <span className="px-2 py-0.5 rounded-full bg-black/60 text-white backdrop-blur-sm">{platformLabel(plat)}</span> : <span />}
          <span className="px-2 py-0.5 rounded-full bg-black/60 text-white backdrop-blur-sm inline-flex items-center gap-1">
            {kind === "video" ? <Play className="h-3 w-3" /> : kind === "carousel" ? <Layers className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
            {mediaLabel(kind)}
          </span>
        </div>
      )}
      {url && !compact && (
        <span className="absolute bottom-2 right-2 h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );
  // Callers that pass a width class keep it; everyone else gets the full column.
  const width = /(^|\s)(w-|max-w-|flex-)/.test(className) ? "" : "w-full";
  const base = `group relative block ${width} ${aspect} overflow-hidden rounded-[12px] bg-black/50 ${className}`;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={base} aria-label="Open the original post">
        {body}
      </a>
    );
  }
  return <div className={base}>{body}</div>;
}
