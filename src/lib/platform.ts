// Platform keys and names come from the one display layer (src/lib/display.ts).
// These names stay so existing imports keep working; there is one implementation.
export { PLATFORM_NAMES as PLATFORM_LABELS, platformKey as normalizePlatform, platformName as platformLabel } from "./display";
import { platformKey as normalizePlatform } from "./display";

/**
 * Whether a planned post is meant to be a moving clip rather than a still.
 * Drives which generator a post opens on: a "Reel" recommendation asks for a
 * video, and offering only the image designer there quietly produces the wrong
 * asset. Kept beside the other platform helpers so it stays free of the
 * Supabase client and can be unit tested.
 */
/** A post made of words alone (a text-only tweet, say): it has no design. */
export function isTextOnlyFormat(format: string | null | undefined): boolean {
  return /^\s*text(\s*only)?\s*$|text[-\s]only/i.test(String(format || ""));
}

export function isVideoFormat(format: string | null | undefined, platform?: string | null): boolean {
  const f = String(format || "").toLowerCase();
  if (/\b(video|reel|reels|short|shorts|igtv|clip|tiktok)\b/.test(f)) return true;
  // A story is a still unless it says otherwise; TikTok and YouTube are not.
  const p = normalizePlatform(platform);
  if (!f && (p === "tiktok" || p === "youtube")) return true;
  return false;
}
