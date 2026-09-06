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
