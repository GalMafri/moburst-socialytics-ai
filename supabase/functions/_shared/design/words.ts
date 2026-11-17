// supabase/functions/_shared/design/words.ts
//
// Words and pictographs (17 Nov 2026). A design's headline is words. An emoji
// is a picture: the image model draws whichever one it likes and the reader
// names whichever one it sees, so a headline that carried one could never
// match what was drawn, and every design for it was made again until its
// option failed (a real request of 17 Nov: three paid designs, each read with
// a blue heart where the headline had a light blue one). Pictographs are left
// out where a headline is taken from the plan and where the words on a design
// are compared. They stay in the post's copy, where they belong.

/**
 * An emoji and what rides on one: a symbol shown as a picture, skin tones,
 * joiners and the keycap mark. The marks a brand name carries (the registered,
 * trademark and copyright signs) are text and stay.
 */
const PICTOGRAPH = /\p{Extended_Pictographic}️|[\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}‍️⃣]/gu;

/** The text with its pictographs taken out and its spacing made single. */
export function wordsOnly(s: string): string {
  return s.replace(PICTOGRAPH, " ").replace(/\s+/g, " ").trim();
}
