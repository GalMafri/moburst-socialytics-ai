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
  return platformDesignSpec(platform, format).aspect;
}

/**
 * How a still is composed for the surface it will be published on: the
 * aspect the platform expects, the part of the frame its own interface
 * covers, and how large the headline and logo run there. The artwork prompt,
 * the review and the app's compositor all read the same spec, so a Reel is
 * not a square feed design stretched tall.
 */
export interface PlatformDesignSpec {
  label: string;
  /** The model's aspect for this surface. */
  aspect: string;
  /** Fractions of the frame the platform's own interface may cover; nothing important goes there. */
  safe: { top: number; bottom: number; left: number; right: number };
  /** Headline size as a fraction of the frame width. */
  headlineScale: number;
  /** Logo width as a fraction of the frame width. */
  logoWidth: number;
  /** One sentence for the artwork prompt. */
  note: string;
}

export function platformDesignSpec(platform?: string | null, format?: string | null): PlatformDesignSpec {
  const plat = String(platform || "").toLowerCase();
  const fmt = String(format || "").toLowerCase();
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const spec = (label: string, aspect: string, safe: PlatformDesignSpec["safe"], headlineScale: number, logoWidth: number, extra = ""): PlatformDesignSpec => ({
    label, aspect, safe, headlineScale, logoWidth,
    note: `This artwork is for ${label} at ${aspect}. The platform interface covers the top ${pct(safe.top)}, the bottom ${pct(safe.bottom)}, the left ${pct(safe.left)} and the right ${pct(safe.right)} of the frame; keep the hero subject and every important detail inside the remaining safe area, with generous margins, and let the backdrop continue to the edges. ${extra}`.trim(),
  });
  if (isVerticalFormat(platform, format)) {
    const name = /tiktok/.test(plat) ? "TikTok" : /youtube/.test(plat) ? "YouTube Shorts" : /facebook/.test(plat) ? "Facebook Stories" : /stor/.test(fmt) ? "Instagram Stories" : "Instagram Reels";
    return spec(name, "9:16", { top: 0.14, bottom: 0.22, left: 0.06, right: 0.14 }, 0.062, 0.3, "The right edge carries the platform's icon column and the bottom carries the caption, so the composition sits high and left of centre.");
  }
  if (/pinterest/.test(plat)) return spec("Pinterest", "2:3", { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 }, 0.06, 0.24);
  if (/youtube/.test(plat)) return spec("a YouTube thumbnail", "16:9", { top: 0.06, bottom: 0.14, left: 0.06, right: 0.12 }, 0.075, 0.16, "The bottom-right corner shows the duration badge.");
  if (/linkedin/.test(plat)) {
    if (/carousel|document|slide/.test(fmt)) return spec("a LinkedIn document carousel", "1:1", { top: 0.07, bottom: 0.09, left: 0.07, right: 0.07 }, 0.058, 0.22, "Slides are viewed at feed width, so type runs large and the frame is not crowded.");
    return spec("a LinkedIn feed image", "16:9", { top: 0.07, bottom: 0.07, left: 0.06, right: 0.06 }, 0.048, 0.16, "It is viewed at feed width in a wide frame, so the hero sits in one half and the other half stays open.");
  }
  if (/(x|twitter)/.test(plat)) return spec("an X post image", "16:9", { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 }, 0.048, 0.16);
  if (/article|landscape|widescreen|banner|cover/.test(fmt)) return spec("a wide banner", "16:9", { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 }, 0.048, 0.16);
  if (/instagram|facebook/.test(plat)) {
    const name = /facebook/.test(plat) ? "the Facebook feed" : /carousel/.test(fmt) ? "an Instagram carousel" : "the Instagram feed";
    return spec(name, "4:5", { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 }, 0.06, 0.22, "Portrait feed images are seen on a phone at full width, so the hero reads at a glance and the type is large.");
  }
  if (!platform && !format) return spec("a square social post", "1:1", { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 }, 0.058, 0.22);
  return spec("a square social post", "1:1", { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 }, 0.058, 0.22);
}
