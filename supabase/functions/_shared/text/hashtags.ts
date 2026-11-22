/**
 * A post's hashtags in the one shape the calendar holds: a list of text
 * (calendar_posts.hashtags is text[]). Some prompts ask the model for hashtags
 * as one string, so a string is split on spaces and commas, as the screens
 * already did when saving; a list keeps its non-empty text entries; anything
 * else is no hashtags.
 *
 * QA, 22 Nov 2026: regenerate-post-copy answered "#a #b" as it came from the
 * model, and the calendar's copy editor and Send to Sprout called .some/.map
 * on it (the 18 Nov production TypeError). Shared by the edge functions and
 * the screens, so both read the same list.
 */
export function hashtagList(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value.filter((h) => typeof h === "string" || typeof h === "number").map(String)
    : typeof value === "string" ? [value] : [];
  // An entry can hold several tags ("#a #b"); a tag listed twice is kept once.
  const tags = entries.flatMap((e) => e.split(/[\s,]+/)).map((h) => h.trim()).filter(Boolean);
  return [...new Set(tags)];
}
