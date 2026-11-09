// supabase/functions/_shared/reports/mediaKind.ts
//
// What kind of post a post is, and its label: the one reading the screens
// use for a post's type (src/components/competitive/PostVisual.tsx
// re-exports these) and the one a report's facts use in their words
// (facts.ts), so a fact never names a raw post type ("INSTAGRAM_MEDIA").
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

export function mediaKind(value: string | null | undefined, url?: string | null): MediaKind {
  const v = String(value || "").toLowerCase();
  if (v.includes("video") || v.includes("reel") || v.includes("short") || v.includes("igtv")) return "video";
  // A LinkedIn document post and a PDF carousel are their own thing: they
  // used to be folded into "text", which read as a post with no creative.
  // Checked before carousel, since "pdf_carousel" is a document.
  if (v.includes("document") || v.includes("pdf")) return "document";
  if (v.includes("carousel") || v.includes("album") || v.includes("multi") || v.includes("sidecar")) return "carousel";
  if (v.includes("link") || v.includes("article") || v.includes("share")) return "link";
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
