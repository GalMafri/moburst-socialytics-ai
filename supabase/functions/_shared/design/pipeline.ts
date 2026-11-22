// supabase/functions/_shared/design/pipeline.ts
//
// How a design is made, without Canva (Lital, 13 Oct: "drop canva"):
//   1. generate: the image model designs the whole post, headline included,
//      on a canvas that carries the client's logo file, with the client's own
//      posts as its visual language (brief.ts). It is drawn at twice the
//      page's size so the post stays sharp.
//   2. locate:   the slot, where the logo goes (logoSlot.ts, 17 Nov 2026):
//                where the model drew the logo when the search finds it at a
//                size the client uses (logoMatch.ts), else where the canvas
//                carried it. The model redraws the logo in the tone and
//                weight its picture needs, so no design is made again here.
//   3. unlogo:   the same picture redrawn whole with every logo and brand
//                mark taken out. Then (marks) the cleaned slot is measured:
//                the drawing gone, the ground under the slot, and the logo
//                file whose whole parts all show on it; and the picture is
//                read for any logo left, the client's own or another
//                brand's. Marks found are named in the next removal, twice at
//                most, before the post is designed again. The redraw is
//                whole (patching boxes left blocks
//                and stray letters on 13 Oct). The logo's place stays clear:
//                a frame line broken around the logo in the brand's style
//                stays broken (closing it put the line through Bader's logo).
//   4. finish:   the logo file chosen for the ground, laid in the slot, so
//                the design keeps the room it made for the logo, then brought
//                down to the delivered size.
//   5. verify:   the words on the finished post are read back and must be the
//                headline's words exactly (lettering printed on an object in
//                the picture is read apart, and must be real words spelled
//                right), and nothing may touch or cross the
//                logo (seen at full size around its known place); otherwise
//                the post is designed again. A carousel whose cover is designed
//                again has its other slides designed again from the new cover.
//
// Free of Deno and network imports so it can be tested.

import { wordsOnly } from "./words.ts";

/** The instruction for step 3. */
export function removePrompt(brand: string, alsoRemove?: string | null): string {
  return `Remove every logo and brand mark of ${brand} from this image: its wordmark and symbol, and any copy of the symbol anywhere else, including on objects, signs, clothing or screens. ` +
    "Where each was, continue only the background or surface around it, so its place stays clear; a line, rule, border or frame that stopped at a mark still stops there, leaving the same gap. " +
    "Also remove the logos, emblems, stripes and lettering of any other brand, on clothing, shoes, balls, equipment, signs or boards, continuing the plain surface beneath. " +
    (alsoRemove ? `In particular remove this, leaving the surface plain: ${alsoRemove}. ` : "") +
    "Keep everything else exactly as it is: every word of the text with its spelling, font, size, color and position, the picture, the layout, the colors, the light and the sharpness. Add nothing.";
}

/**
 * The instruction for reading the logo-free picture for any logo left on it
 * (14 Oct: three stripes and a swoosh-like stripe on football boots stayed
 * after the general removal). Since 17 Nov 2026 it asks about the client's
 * own logo too: the picture is read before the logo file is laid on it, so
 * a logo of the client's still on it is the model's drawing, at the slot or
 * anywhere else, and goes the way another brand's mark does.
 */
export function marksPrompt(brand: string): string {
  return `This picture is a social post for ${brand} before its logo is added, so it should carry no logo at all. ` +
    `Does it show ${brand}'s own logo, wordmark or symbol anywhere, drawn as a mark of its own or on an object? ` +
    "Or does any clothing, shoe, ball, equipment, sign or object in it show another real brand's logo, name, emblem or signature pattern, such as stripes, a swoosh, a formstrip, a crest or a monogram? " +
    `The post's own headline and words are fine, also where they name ${brand}. ` +
    'Reply with JSON only: {"marks": true or false, "where": "each mark and where it is, or empty"}';
}

/** The marks check's answer, or null when it gives none. */
export function parseMarks(text: string): { marks: boolean; where: string } | null {
  const m = /"marks"\s*:\s*"?(true|false)"?/i.exec(text);
  if (!m) return null;
  const where = /"where"\s*:\s*"([\s\S]*?)"\s*}/.exec(text);
  return { marks: m[1].toLowerCase() === "true", where: where ? where[1] : "" };
}

/** The instruction for reading every piece of text as one group: a video's title layer (video/steps.ts), which has no picture of its own. */
export function readPrompt(brand: string): string {
  return `Transcribe every piece of text in this image exactly as written, in reading order, keeping spelling, capitalization and punctuation. Leave out the ${brand} logo. Reply with JSON only: {"lines":["..."]}`;
}

/**
 * The instruction for step 5. The post's own words and the lettering printed
 * on an object in its picture are read apart (18 Nov 2026). Read as one, a
 * calendar's weekday names or a form's field labels in the scene counted as
 * words added to the headline, and a design whose headline was exact was made
 * again until its option failed (a carousel of 17 Nov: three options, each
 * ended on one slide). The headline is still compared exactly; the object's
 * lettering must be real words, spelled right.
 */
export function postReadPrompt(brand: string): string {
  return "Read the text in this social post image in two groups, each exactly as written, in reading order, keeping spelling, capitalization and punctuation. " +
    `Leave out the ${brand} logo. ` +
    '"lines": the post\'s own words, set as text on the design wherever they are: headline, other lines, captions, labels, buttons and badges. ' +
    '"scene": lettering printed on an object shown in the picture as part of that object, such as a calendar\'s days, a form\'s field names, a sign, a screen, a label, a package or a book\'s title. ' +
    '"scene_spelled": true when every piece of the scene lettering is real words or numbers spelled correctly, false when any is misspelled, half-formed or invented letters; true when there is none. ' +
    'Reply with JSON only: {"lines":["..."],"scene":["..."],"scene_spelled":true}';
}

/** What a reading returned: the post's own lines, the lettering on objects in its picture, and whether that lettering is real words spelled right. */
export type Reading = { lines: string[]; scene: string[]; sceneSpelled: boolean };

/** The reading in a reply, or null when it is not the JSON asked for. */
export function parseReading(text: string): Reading | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1));
    if (!Array.isArray(v?.lines)) return null;
    const scene = Array.isArray(v.scene) ? v.scene.map(String).filter((t: string) => t.trim()) : [];
    // Lettering whose spelling the reply does not vouch for is taken as not spelled right: the design is made again, as before the two groups.
    return { lines: v.lines.map(String), scene, sceneSpelled: scene.length === 0 || v.scene_spelled === true };
  } catch {
    return null;
  }
}

/** The lines a reading returned, or null when it is not the JSON asked for. */
export function parseRead(text: string): string[] | null {
  return parseReading(text)?.lines ?? null;
}

/**
 * Whether a reading passes: the post's own words are the headline's words
 * exactly (copyMatches), no lettering on an object in its picture repeats
 * the headline (repeatsHeadline), and any such lettering is real words
 * spelled right. "words" is the headline failing, "scene" the lettering;
 * null passes.
 */
export function readingFails(reading: Reading, headline: string[]): "words" | "scene" | null {
  if (!copyMatches(reading.lines, headline)) return "words";
  if (reading.scene.some((item) => repeatsHeadline(item, headline))) return "words";
  return reading.sceneSpelled ? null : "scene";
}

/** A text's words as a reader compares them (readable), with the punctuation around each word left off. */
function wordsOf(s: string): string[] {
  return readable(s).split(" ").map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
}

/** Whether `run` sits in `words` as consecutive words. */
function hasRun(words: string[], run: string[]): boolean {
  if (!run.length || run.length > words.length) return false;
  for (let i = 0; i + run.length <= words.length; i++) if (run.every((w, k) => words[i + k] === w)) return true;
  return false;
}

/** Words of the headline in a row that, found on an object in the picture, count as the headline drawn there too. */
export const HEADLINE_RUN = 3;

/**
 * Whether lettering on an object repeats the headline (18 Nov 2026): it
 * holds a whole line of the headline, or HEADLINE_RUN of its words in a row
 * (the headline drawn twice, once as the post's text and once on a
 * billboard). Such a design is made again for its words.
 */
export function repeatsHeadline(item: string, headline: string[]): boolean {
  const words = wordsOf(item);
  if (headline.some((line) => hasRun(words, wordsOf(line)))) return true;
  const all = wordsOf(headline.join(" "));
  for (let i = 0; i + HEADLINE_RUN <= all.length; i++) if (hasRun(words, all.slice(i, i + HEADLINE_RUN))) return true;
  return false;
}

/** The instruction for the logo part of step 5: the image is the area around the logo, at full size. */
export function logoCheckPrompt(brand: string): string {
  return `This is the area around the ${brand} logo on a social post, at full size; the logo is in the middle. ` +
    "Does a line, rule, border, frame, piece of text or distinct object touch or cross the logo's letters or symbol? " +
    "A background behind the logo is fine: photography, texture, gradients, light and soft shapes. " +
    'Reply with JSON only: {"clear": true or false, "touching": "what touches or crosses the logo, or empty"}';
}

/**
 * The logo check's answer, or null when it gives none. The description of
 * what touches the logo can quote letters and break the JSON, so the yes or
 * no is also read on its own.
 */
export function parseLogoCheck(text: string): { clear: boolean; touching: string } | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      const v = JSON.parse(text.slice(a, b + 1));
      if (typeof v?.clear === "boolean") return { clear: v.clear, touching: String(v.touching ?? "") };
    } catch { /* read the fields on their own below */ }
  }
  const clear = /"clear"\s*:\s*"?(true|false)"?/i.exec(text);
  if (!clear) return null;
  const touching = /"touching"\s*:\s*"([\s\S]*?)"\s*}/.exec(text);
  return { clear: clear[1].toLowerCase() === "true", touching: touching ? touching[1] : "" };
}

/**
 * Text compared the way a reader sees it: case, quote style, dash style and spacing do not count, and a pictograph is
 * no word (words.ts). QA 22 Nov 2026: neither do an ellipsis written as one sign or three dots, Hebrew and other
 * quote signs (geresh, gershayim, low and angle quotes), the minus and non-breaking hyphens, or marks nobody can see
 * and so no reader can return (direction marks, zero-width spaces, a soft hyphen).
 */
export function readable(s: string): string {
  return wordsOnly(s).replace(/\p{Cf}/gu, "").toLowerCase()
    .replace(/…/g, "...").replace(/[’‘‚`´׳]/g, "'").replace(/[“”„«»״]/g, '"').replace(/[–—‑−]/g, "-")
    .replace(/\s+/g, " ").trim();
}

/** Whether the words on the post are the headline's words, in order, with nothing added or missing. */
export function copyMatches(read: string[], headline: string[]): boolean {
  return readable(read.join(" ")) === readable(headline.join(" "));
}
