// Platform names as they arrive from RivalIQ, Sprout and post URLs, normalised to one
// key per network and to a display label. Pure module: safe to import from libraries
// and tests without pulling in the Supabase client.

export const PLATFORM_LABELS: Record<string, string> = {
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

/**
 * Whether a planned post is meant to be a moving clip rather than a still.
 * Drives which generator a post opens on: a "Reel" recommendation asks for a
 * video, and offering only the image designer there quietly produces the wrong
 * asset. Kept beside the other platform helpers so it stays free of the
 * Supabase client and can be unit tested.
 */
export function isVideoFormat(format: string | null | undefined, platform?: string | null): boolean {
  const f = String(format || "").toLowerCase();
  if (/\b(video|reel|reels|short|shorts|igtv|clip|tiktok)\b/.test(f)) return true;
  // A story is a still unless it says otherwise; TikTok and YouTube are not.
  const p = normalizePlatform(platform);
  if (!f && (p === "tiktok" || p === "youtube")) return true;
  return false;
}
