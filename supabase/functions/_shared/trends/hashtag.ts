// One hashtag rule everywhere: a hashtag is # followed by letters, digits or
// underscores only. The Client setup add box and the Instagram source make a
// tag with asHashtag/hashtagText; trend_term_add does the same in the database
// (20261108110000_trend_reads_fix.sql); the profile writer and the coverage
// rewrite accept only a tag that matches HASHTAG.

/** A hashtag as every Trends step requires it. */
export const HASHTAG = /^#[\p{L}0-9_]+$/u;

/** The tag's text without its #: everything that is not a letter, a digit or an underscore taken out. "" when nothing is left. */
export function hashtagText(typed: string): string {
  return String(typed ?? "").replace(/[^\p{L}0-9_]/gu, "");
}

/** A typed hashtag as one tag: one # and its text, or "" when nothing is left. */
export function asHashtag(typed: string): string {
  const text = hashtagText(typed);
  return text ? `#${text}` : "";
}
