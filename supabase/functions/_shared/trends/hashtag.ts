// One hashtag rule everywhere: a hashtag is # followed by letters, digits or
// underscores only. The Client setup add box and the Instagram source make a
// tag with asHashtag/hashtagText; trend_term_add does the same in the database
// (20261108110000_trend_reads_fix.sql); the profile writer and the coverage
// rewrite accept only a tag that matches HASHTAG.

// QA 22 Nov 2026 (P52-03): a letter's marks (\p{M}: the vowel signs of
// Hindi and the other Indic scripts, offered in Client setup) are part of its
// word. Without them "#हिंदी" was refused and a typed one became "#हद".
// The database's [:alnum:] already keeps them (checked in PGlite, C.UTF-8).

/** A hashtag as every Trends step requires it. */
export const HASHTAG = /^#[\p{L}0-9_][\p{L}\p{M}0-9_]*$/u;

/** Every hashtag in a text, by the same rule. */
export const HASHTAG_IN_TEXT = /#[\p{L}0-9_][\p{L}\p{M}0-9_]*/gu;

/** The tag's text without its #: everything that is not a letter (with its marks), a digit or an underscore taken out. "" when nothing is left. */
export function hashtagText(typed: string): string {
  return String(typed ?? "").replace(/[^\p{L}\p{M}0-9_]/gu, "").replace(/^\p{M}+/u, "");
}

/** A typed hashtag as one tag: one # and its text, or "" when nothing is left. */
export function asHashtag(typed: string): string {
  const text = hashtagText(typed);
  return text ? `#${text}` : "";
}
