// supabase/functions/_shared/reports/mediaKind.ts
//
// What kind of post a post is, and its label: the one reading the screens
// use for a post's type (src/components/competitive/PostVisual.tsx
// re-exports these; the report page and Analytics pass postType) and the
// one a report's facts use in their words (facts.ts), so a fact never names
// a raw post type ("INSTAGRAM_MEDIA"). Sprout's content_category comes
// first, a type's network prefix is dropped and "link" is matched as a
// whole word, so a LinkedIn company update is never a link post.
// Free of Deno and network imports so both sides can import it.

export type MediaKind = "video" | "carousel" | "image" | "document" | "link" | "text";

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

/**
 * The type a post carries: Sprout's content_category (PHOTO, VIDEO, ALBUM,
 * LINK, TEXT, DOCUMENT) first, then its post_type
 * (LINKEDIN_COMPANY_UPDATE), then a media type (the competitor posts').
 */
export function postType(post: { content_category?: unknown; post_type?: unknown; media_type?: unknown; content_type?: unknown } | null | undefined): string {
  for (const v of [post?.content_category, post?.post_type, post?.media_type, post?.content_type]) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) return t;
  }
  return "";
}

/** A type's leading network names ("LINKEDIN_", "FB_INSTAGRAM_"): no part of what kind of post it is. */
const NETWORK_PREFIX = /^(?:(?:fb|facebook|instagram|ig|linkedin|tiktok|youtube|twitter|x|threads|pinterest)[_\s-]+)+/;

export function mediaKind(value: string | null | undefined, url?: string | null): MediaKind {
  const v = String(value || "").toLowerCase().trim().replace(NETWORK_PREFIX, "");
  const words = v.split(/[^a-z]+/).filter(Boolean);
  if (v.includes("video") || v.includes("reel") || v.includes("short") || v.includes("igtv")) return "video";
  // A LinkedIn document post and a PDF carousel are their own thing: they
  // used to be folded into "text", which read as a post with no creative.
  // Checked before carousel, since "pdf_carousel" is a document.
  if (v.includes("document") || v.includes("pdf")) return "document";
  if (v.includes("carousel") || v.includes("album") || v.includes("multi") || v.includes("sidecar")) return "carousel";
  // "link" as a whole word: "linkedin" holds it.
  if (words.includes("link") || v.includes("article") || v.includes("share")) return "link";
  if (v.includes("photo") || v.includes("image") || v.includes("picture")) return "image";
  if (v.includes("text") || v.includes("status")) return "text";
  const p = platformFromUrl(url);
  if (p === "tiktok" || p === "youtube") return "video";
  if (String(url || "").includes("/reel/")) return "video";
  return "image";
}

export function mediaLabel(kind: MediaKind): string {
  switch (kind) {
    case "video": return "Video";
    case "carousel": return "Carousel";
    case "document": return "Document";
    case "link": return "Link";
    case "text": return "Text";
    default: return "Image";
  }
}
