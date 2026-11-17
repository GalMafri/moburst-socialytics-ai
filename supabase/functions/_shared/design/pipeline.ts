// supabase/functions/_shared/design/pipeline.ts
//
// How a design is made, without Canva (Lital, 13 Oct: "drop canva"):
//   1. generate: the image model designs the whole post, headline included,
//      on a canvas that carries the client's logo file, with the client's own
//      posts for their look alone (brief.ts). It is drawn at twice the
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
//                headline's words exactly, with every label the design
//                carries (wordsMatch), and nothing may touch or cross the
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

/** The instruction for step 5. */
export function readPrompt(brand: string): string {
  return `Transcribe every piece of text in this image exactly as written, in reading order, keeping spelling, capitalization and punctuation. Leave out the ${brand} logo. Reply with JSON only: {"lines":["..."]}`;
}

/** The lines a reading returned, or null when it is not the JSON asked for. */
export function parseRead(text: string): string[] | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const lines = JSON.parse(text.slice(a, b + 1))?.lines;
    return Array.isArray(lines) ? lines.map(String) : null;
  } catch {
    return null;
  }
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

/** Text compared the way a reader sees it: case, quote style, dash style and spacing do not count, and a pictograph is no word (words.ts). */
export function readable(s: string): string {
  return wordsOnly(s).toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

/** Whether the words on the post are the headline's words, in order, with nothing added or missing. */
export function copyMatches(read: string[], headline: string[]): boolean {
  return readable(read.join(" ")) === readable(headline.join(" "));
}

/**
 * The words of a text as a design with labels is checked: runs of letters
 * and digits, lowercased, with an apostrophe inside a word kept the way
 * `readable` writes it. Everything else only separates words: bullets, check
 * marks, arrows, colons, dots, percent and other signs. "&" is the word "and".
 */
function tokens(text: string): string[] {
  return readable(text).replace(/&/g, " and ").match(/[\p{L}\p{N}\p{M}]+(?:'[\p{L}\p{N}\p{M}]+)*/gu) ?? [];
}

/** A list marker opening a line: a bare number or a single letter, then "." or ")". */
const LIST_MARKER = /^\s*(\d+|\p{L})[.)](?=\s|$)/u;

/**
 * Whether the words on the post are its headline and its labels (17 Nov
 * 2026). A design without labels is held to copyMatches as it is. A design
 * with labels is compared word by word (tokens), because a reader writes a
 * list as it sees it: with its bullets, numbers, arrows and colons, row by
 * row. A list marker opening a line of the read is left out, unless the
 * labels themselves hold that number or letter. Then the words read are the
 * headline's and the labels' words, each as often, with nothing added and
 * nothing missing, and the headline's words come in the headline's order.
 */
export function wordsMatch(read: string[], headline: string[], labels?: string[] | null): boolean {
  const labelWords = (Array.isArray(labels) ? labels : []).flatMap((l) => tokens(String(l)));
  if (!labelWords.length) return copyMatches(read, headline);
  const head = tokens(headline.join(" "));
  const inLabels = new Set(labelWords);
  const seen = read.flatMap((line) => {
    const text = readable(String(line));
    const marker = LIST_MARKER.exec(text);
    return tokens(marker && !inLabels.has(marker[1]) ? text.slice(marker[0].length) : text);
  });
  // The same words, each as often.
  const count = new Map<string, number>();
  for (const w of [...head, ...labelWords]) count.set(w, (count.get(w) ?? 0) + 1);
  for (const w of seen) {
    const left = (count.get(w) ?? 0) - 1;
    if (left < 0) return false;
    if (left) count.set(w, left); else count.delete(w);
  }
  if (count.size) return false;
  // The headline's words in the headline's order.
  let h = 0;
  for (const w of seen) if (h < head.length && w === head[h]) h++;
  return h === head.length;
}
