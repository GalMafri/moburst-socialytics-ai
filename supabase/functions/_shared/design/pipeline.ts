// supabase/functions/_shared/design/pipeline.ts
//
// How a design is made, without Canva (Lital, 13 Oct: "drop canva"):
//   1. generate: the image model designs the whole post, headline included,
//      on a canvas that carries the client's logo file, with the client's own
//      posts as its visual language (brief.ts). It is drawn at twice the
//      page's size so the post stays sharp.
//   2. locate:   where the model drew the logo, at the client's usual spot and
//                at a size the client uses (logoMatch.ts). A design without
//                one there is designed again.
//   3. unlogo:   the same picture redrawn whole with every logo and brand
//                mark taken out, then read for any other brand's marks
//                (marks); marks found are named in the next removal, twice at
//                most, before the post is designed again. The redraw is
//                whole (patching boxes left blocks
//                and stray letters on 13 Oct). The logo's place stays clear:
//                a frame line broken around the logo in the brand's style
//                stays broken (closing it put the line through Bader's logo).
//   4. finish:   the client's logo file laid exactly where and at the size the
//                model drew it, so the design keeps the room it made for it,
//                then brought down to the delivered size.
//   5. verify:   the words on the finished post are read back and must be the
//                headline's words exactly, and nothing may touch or cross the
//                logo (seen at full size around its known place); otherwise
//                the post is designed again. A carousel whose cover is designed
//                again has its other slides designed again from the new cover.
//
// Free of Deno and network imports so it can be tested.

/** The instruction for step 3. */
export function removePrompt(brand: string, alsoRemove?: string | null): string {
  return `Remove every logo and brand mark of ${brand} from this image: its wordmark and symbol, and any copy of the symbol anywhere else, including on objects, signs, clothing or screens. ` +
    "Where each was, continue only the background or surface around it, so its place stays clear; a line, rule, border or frame that stopped at a mark still stops there, leaving the same gap. " +
    "Also remove the logos, emblems, stripes and lettering of any other brand, on clothing, shoes, balls, equipment, signs or boards, continuing the plain surface beneath. " +
    (alsoRemove ? `In particular remove this, leaving the surface plain: ${alsoRemove}. ` : "") +
    "Keep everything else exactly as it is: every word of the text with its spelling, font, size, color and position, the picture, the layout, the colors, the light and the sharpness. Add nothing.";
}

/**
 * The instruction for reading the logo-free picture for any other brand's
 * marks (14 Oct: three stripes and a swoosh-like stripe on football boots
 * stayed after the general removal).
 */
export function marksPrompt(brand: string): string {
  return `This social post for ${brand} should carry no other brand's marks. ` +
    "Does any clothing, shoe, ball, equipment, sign or object in it show a real brand's logo, name, emblem or signature pattern, such as stripes, a swoosh, a formstrip, a crest or a monogram? " +
    "The post's own headline and words are fine. " +
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

/** Text compared the way a reader sees it: case, quote style, dash style and spacing do not count. */
export function readable(s: string): string {
  return s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

/** Whether the words on the post are the headline's words, in order, with nothing added or missing. */
export function copyMatches(read: string[], headline: string[]): boolean {
  return readable(read.join(" ")) === readable(headline.join(" "));
}
