// A Story's design is posted by hand from the Instagram or Facebook app, or
// Meta Business Suite (Stories for Facebook and Instagram, 2 Nov 2026), so
// its panel gives the file to download. What a Story is lives with the edge
// functions (supabase/functions/_shared/design/story.ts, re-exported by
// src/lib/platform.ts); this is the part only the screen needs.

/** The line under a Story's design. */
export const STORY_POSTED_BY_HAND = "Stories are posted by hand from the Instagram or Facebook app, or from Meta Business Suite. Download the design to post it.";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** "pay-the-pyper-story-2026-11-05.png": the brand, the word story and the post's date. */
export function storyFileName(brand: string | null | undefined, date: string | null | undefined): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) ? `-${date}` : "";
  return `${slug(String(brand ?? "")) || "brand"}-story${day}.png`;
}

/**
 * A public storage file's address that downloads it under this name. A
 * browser ignores <a download> across origins and opens the file in a tab;
 * Supabase Storage's own download option sends it as an attachment instead.
 * Any other address is left as it is.
 */
export function storageDownloadUrl(url: string, filename: string): string {
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/storage/v1/object/public/")) return url;
    u.searchParams.set("download", filename);
    return u.toString();
  } catch {
    return url;
  }
}
