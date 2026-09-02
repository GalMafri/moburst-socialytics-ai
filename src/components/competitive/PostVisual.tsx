// The one way posts are shown across the app: a real thumbnail of the creative
// (image, video frame or carousel cover), the platform, the media type, and a
// click-through to the original post.
//
// Competitor posts arrive from RivalIQ with an `image` URL already attached.
// Client posts come from Sprout, which carries no media, so their thumbnails
// are resolved by the post-preview edge function and cached in post_previews;
// `usePostPreviews` batches that lookup for a whole list of URLs.

import { useMemo, useState } from "react";
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
  status: "ok" | "miss" | "pending" | "error";
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

/**
 * Resolves thumbnails for a set of post URLs through the post-preview
 * function. Pass every URL you plan to render; the hook dedupes, skips empty
 * values and caches results for the session.
 */
export function usePostPreviews(urls: Array<string | null | undefined>, enabled = true) {
  const list = useMemo(() => {
    const set = new Set<string>();
    for (const u of urls) if (u && /^https?:\/\//i.test(u)) set.add(u);
    return Array.from(set).sort();
  }, [urls]);

  const query = useQuery({
    queryKey: ["post-previews", list],
    queryFn: async () => {
      const out: Record<string, PostPreview> = {};
      for (let i = 0; i < list.length; i += 40) {
        const chunk = list.slice(i, i + 40);
        const { data, error } = await supabase.functions.invoke("post-preview", { body: { urls: chunk } });
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

type PostVisualProps = {
  url?: string | null;
  /** A thumbnail already known for the post (RivalIQ `image`). */
  image?: string | null;
  /** A resolved preview from usePostPreviews, if any. */
  preview?: PostPreview | null;
  mediaType?: string | null;
  platform?: string | null;
  /** Tailwind aspect class. Defaults to 4:5, the most common feed format. */
  aspectClass?: string;
  className?: string;
  /** Hide the platform and type badges (for very small tiles). */
  compact?: boolean;
};

/**
 * Thumbnail tile linking to the original post. Falls back to a labelled
 * placeholder when no creative could be resolved, so lists stay aligned.
 */
export function PostVisual({ url, image, preview, mediaType, platform, aspectClass = "aspect-[4/5]", className = "", compact = false }: PostVisualProps) {
  const [broken, setBroken] = useState(false);
  const src = !broken ? image || preview?.image_url || null : null;
  const kind = mediaKind(mediaType || preview?.media_type, url);
  const plat = normalizePlatform(platform || preview?.platform || platformFromUrl(url));
  const body = (
    <>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] text-muted-foreground">
          {kind === "video" ? <Play className="h-7 w-7" /> : kind === "carousel" ? <Layers className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}
          {!compact && <span className="text-xs">{url ? "Preview unavailable" : "No link"}</span>}
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
  const base = `group relative block overflow-hidden rounded-[12px] bg-[rgba(255,255,255,0.04)] ${aspectClass} ${className}`;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={base} aria-label="Open the original post">
        {body}
      </a>
    );
  }
  return <div className={base}>{body}</div>;
}
