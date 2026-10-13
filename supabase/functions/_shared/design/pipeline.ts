// supabase/functions/_shared/design/pipeline.ts
//
// How a design is made, without Canva (Lital, 13 Oct: "drop canva"):
//   1. generate: the image model designs the whole post, headline included,
//      on a canvas that carries the client's logo file, with the client's own
//      posts as its visual language (brief.ts). It is drawn at twice the
//      page's size so the post stays sharp.
//   2. unlogo:   the same picture redrawn whole with every logo and brand
//                mark taken out (a whole redraw: patching boxes left blocks
//                and stray letters on 13 Oct).
//   3. finish:   the client's logo file laid at the client's habitual spot
//                and size, then brought down to the delivered size.
//   4. verify:   the words on the finished post are read back and must be the
//                headline's words exactly; otherwise the post is designed again.
//
// Free of Deno and network imports so it can be tested.

/** The instruction for step 2. */
export function removePrompt(brand: string): string {
  return `Remove every logo and brand mark of ${brand} from this image: its wordmark and symbol, and any copy of the symbol anywhere else, including on objects, signs, clothing or screens. ` +
    "Where each was, continue exactly what is behind it or the surface it was on. " +
    "Keep everything else exactly as it is: every word of the text with its spelling, font, size, color and position, the picture, the layout, the colors, the light and the sharpness. Add nothing.";
}

/** The instruction for step 4. */
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

/** Text compared the way a reader sees it: case, quote style, dash style and spacing do not count. */
export function readable(s: string): string {
  return s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

/** Whether the words on the post are the headline's words, in order, with nothing added or missing. */
export function copyMatches(read: string[], headline: string[]): boolean {
  return readable(read.join(" ")) === readable(headline.join(" "));
}
