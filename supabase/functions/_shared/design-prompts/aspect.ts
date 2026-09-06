// supabase/functions/_shared/design-prompts/aspect.ts
//
// One place decides whether a post is vertical. The image and video generators
// each carried their own getAspectRatio, and neither looked for "Short" — so a
// YouTube Short was generated 16:9 by the video path (because the platform is
// YouTube) and 1:1 by the image path (because nothing matched at all).

/** Formats that are shot tall, whatever the platform says. */
const VERTICAL = /\b(short|shorts|reel|reels|story|stories|vertical|portrait|tiktok)\b/;
/** Formats that are shot wide even on a platform that usually goes tall. */
const HORIZONTAL = /\b(landscape|horizontal|widescreen|article|banner|cover photo)\b/;
/** A moving format, as opposed to a still or a document. */
const MOVING = /\b(video|clip|footage|animation)\b/;
/** Platforms whose video is vertical by default, so a plain "Video" is tall. */
const VERTICAL_VIDEO_PLATFORM = /\b(tiktok|instagram|snapchat)\b/;

/**
 * Whether this post should be composed tall (9:16).
 *
 * Format wins over platform: "Short" on YouTube is vertical even though a
 * YouTube video is normally wide, and "Landscape" on TikTok is wide even though
 * TikTok is normally tall.
 *
 * A format that only says "Video" says nothing about shape, so the platform
 * decides — vertical on TikTok, Instagram and Snapchat, wide on YouTube,
 * Facebook and LinkedIn. That fallback applies to MOVING formats only: an
 * Instagram "Single Image" or "Carousel" stays square.
 */
export function isVerticalFormat(platform?: string | null, format?: string | null): boolean {
  const fmt = String(format || "").toLowerCase();
  if (HORIZONTAL.test(fmt)) return false;
  if (VERTICAL.test(fmt)) return true;

  const plat = String(platform || "").toLowerCase();
  if (MOVING.test(fmt)) return VERTICAL_VIDEO_PLATFORM.test(plat);
  // No format at all: fall back to what the platform mostly publishes.
  if (!fmt.trim()) return /\b(tiktok|snapchat)\b/.test(plat);
  return false;
}

/**
 * Aspect ratio for a generated video. Veo accepts 16:9 and 9:16 only, so every
 * post resolves to one of the two.
 */
export function videoAspectRatio(platform?: string | null, format?: string | null): string {
  return isVerticalFormat(platform, format) ? "9:16" : "16:9";
}

/**
 * Aspect ratio for a generated still. Gemini's image model takes a wider set,
 * so a feed post can stay square and Pinterest can stay 2:3.
 */
export function imageAspectRatio(platform?: string | null, format?: string | null): string {
  if (isVerticalFormat(platform, format)) return "9:16";
  const plat = String(platform || "").toLowerCase();
  const fmt = String(format || "").toLowerCase();
  if (!platform && !format) return "1:1";
  if (/pinterest/.test(plat)) return "2:3";
  if (/linkedin|youtube/.test(plat) || /article|landscape|widescreen|banner/.test(fmt)) return "16:9";
  return "1:1";
}
