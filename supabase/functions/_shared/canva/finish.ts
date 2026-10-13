// supabase/functions/_shared/canva/finish.ts
//
// The decisions behind finishing a design in Canva, kept free of Deno and of
// any network import so they can be tested.
//
// A design arrives as one flat image whose logo was drawn by the image model
// at the client's habitual spot. Canva's Magic Layers splits it into layers:
// pictures, live text, and the drawn logo (usually its wordmark as text plus
// the mark as a small picture). Finishing means three exact operations on
// those layers, never on pixels:
//   1. delete the drawn logo's layers;
//   2. set every copy layer to the post's exact copy;
//   3. place the client's logo file where the drawn logo was.

export type Anchor = "left" | "center" | "right";

/** Where the client habitually puts its logo, as fractions of the frame. */
export interface Placement {
  anchor: Anchor;
  /** Logo width as a share of the frame width. */
  width: number;
  /** Top edge as a share of the frame height. */
  top: number;
  /** Left edge as a share of the frame width (anchor "left"); for "right", the right margin. */
  left?: number;
}

export type Box = [number, number, number, number]; // x0, y0, x1, y1 in page pixels

export interface Layer {
  id: string;
  box: Box | null;
  /** Present for text layers. */
  text?: string;
}

/** How far around the habitual spot a drawn logo may have landed. */
export const PLACEMENT_PAD = 60;
/** A layer belongs to the logo when this share of it lies in the logo region. */
export const LOGO_SHARE = 0.7;
/** A pixel counts as changed by the logo's removal above this channel difference. */
export const INK_THRESHOLD = 24;

/** The region around the client's habitual logo spot, padded for the model's drift. */
export function placementRegion(p: Placement, logoW: number, logoH: number, pageW: number, pageH: number, pad = PLACEMENT_PAD): Box {
  const w = p.width * pageW;
  const h = (w * logoH) / logoW;
  let x: number;
  if (p.anchor === "center") x = (pageW - w) / 2;
  else if (p.anchor === "left") x = (p.left ?? 0) * pageW;
  else x = pageW - (p.left ?? 0) * pageW - w;
  const y = p.top * pageH;
  return [x - pad, y - pad, x + w + pad, y + h + pad];
}

/** A Canva editing-transaction element's box, or null for the page background. */
export function elementBox(el: { containerElement?: { position: { top: number; left: number }; dimension: { width: number; height: number } } }): Box | null {
  const ce = el.containerElement;
  if (!ce) return null;
  const { top, left } = ce.position;
  return [left, top, left + ce.dimension.width, top + ce.dimension.height];
}

export function insideShare(b: Box, region: Box): number {
  const ix = Math.max(0, Math.min(b[2], region[2]) - Math.max(b[0], region[0]));
  const iy = Math.max(0, Math.min(b[3], region[3]) - Math.max(b[1], region[1]));
  const area = Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1]));
  return (ix * iy) / area;
}

/** A word reduced to what a misread cannot change: letters and digits, lower case. */
export function normWord(w: string): string {
  return w.toLowerCase().replace(/’/g, "'").replace(/[^0-9a-z]/g, "");
}

/**
 * The drawn logo's layers: anything mostly inside the logo region, except a
 * text layer made only of copy words (a headline can start just below a logo).
 */
export function pickLogoLayers(layers: Layer[], region: Box, copy: string[]): Layer[] {
  const copyWords = new Set(copy.join(" ").split(/\s+/).map(normWord).filter(Boolean));
  return layers.filter((l) => {
    if (!l.box || insideShare(l.box, region) < LOGO_SHARE) return false;
    if (l.text !== undefined) {
      const words = l.text.split(/\s+/).map(normWord).filter(Boolean);
      if (words.length && words.every((w) => copyWords.has(w))) return false;
    }
    return true;
  });
}

export type CopyOp = { type: "replace_text"; element_id: string; text: string };

/**
 * Every copy layer set to the post's exact words, keeping the design's line
 * breaks. Layers are read top to bottom, then left to right, and take the
 * copy's words in order, as many as each line holds.
 *
 * When the design's text does not hold the same number of words as the copy,
 * nothing is changed and the reason is returned: a design that dropped or
 * added words is not finished by guessing.
 */
export function copyOperations(texts: Layer[], copy: string[]): { ops: CopyOp[] } | { error: string } {
  const words = copy.join(" ").split(/\s+/).filter(Boolean);
  const ordered = [...texts].sort((a, b) => (a.box?.[1] ?? 0) - (b.box?.[1] ?? 0) || (a.box?.[0] ?? 0) - (b.box?.[0] ?? 0));
  const held = ordered.reduce((n, t) => n + (t.text ?? "").split(/\s+/).filter(Boolean).length, 0);
  if (held !== words.length) return { error: `The copy has ${words.length} words; the design's text holds ${held}.` };
  const ops: CopyOp[] = [];
  let k = 0;
  for (const t of ordered) {
    const lines = (t.text ?? "").split("\n").map((line) => {
      const n = line.split(/\s+/).filter(Boolean).length;
      const out = words.slice(k, k + n).join(" ");
      k += n;
      return out;
    });
    const next = lines.join("\n");
    if (next !== t.text) ops.push({ type: "replace_text", element_id: t.id, text: next });
  }
  return { ops };
}

/**
 * The drawn logo's exact ink: the pixels that changed when its layers were
 * deleted, looked for only inside those layers' boxes. Both images are RGBA
 * renders of the same design at the same size, before and after the delete.
 */
export function inkBox(before: ArrayLike<number>, after: ArrayLike<number>, width: number, height: number, boxes: Box[], threshold = INK_THRESHOLD): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    const bx0 = Math.max(0, Math.floor(b[0]) - 4), by0 = Math.max(0, Math.floor(b[1]) - 4);
    const bx1 = Math.min(width - 1, Math.ceil(b[2]) + 4), by1 = Math.min(height - 1, Math.ceil(b[3]) + 4);
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = (y * width + x) * 4;
        const d = Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]), Math.abs(before[i + 2] - after[i + 2]));
        if (d > threshold) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/** The logo file's frame: the drawn logo's width and centre, the file's own proportions. */
export function logoRect(ink: Box, logoW: number, logoH: number): { left: number; top: number; width: number; height: number } {
  const width = ink[2] - ink[0] + 1;
  const height = (width * logoH) / logoW;
  const cy = (ink[1] + ink[3]) / 2;
  return { left: ink[0], top: Math.round((cy - height / 2) * 10) / 10, width, height: Math.round(height * 10) / 10 };
}

// ── A clean background under the live text ─────────────────────────────────
//
// Magic Layers turns the drawn lettering into live text layers and fills in
// the background behind it, but traces of the drawn letters stay in that
// background, and the exact copy set in Canva's matched font does not always
// cover them (ghosted letters, 13 Oct). The areas the drawn text and logo
// occupied are redrawn from their surroundings, pasted back onto the original
// image so nothing else changes, and that image becomes the page background.

/** Margin around drawn text and logo that is redrawn, for glows and shadows around the letters. */
export const CLEAN_PAD = 16;

/** The areas to redraw: every text layer's box and the drawn logo's, padded and kept on the page. */
export function cleanRegions(boxes: Box[], pageW: number, pageH: number, pad = CLEAN_PAD): Box[] {
  return boxes.map(([x0, y0, x1, y1]) => [
    Math.max(0, Math.floor(x0 - pad)),
    Math.max(0, Math.floor(y0 - pad)),
    Math.min(pageW, Math.ceil(x1 + pad)),
    Math.min(pageH, Math.ceil(y1 + pad)),
  ] as Box).filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
}

/** How far into a region a pixel is, 0 outside; regions fade in over `feather` pixels at their edges. */
function weightAt(x: number, y: number, regions: Box[], feather: number): number {
  let w = 0;
  for (const [x0, y0, x1, y1] of regions) {
    if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
    const d = Math.min(x - x0, y - y0, x1 - 1 - x, y1 - 1 - y);
    w = Math.max(w, feather > 0 ? Math.min(1, (d + 1) / feather) : 1);
    if (w >= 1) break;
  }
  return w;
}

/**
 * The original image with only the regions taken from the redrawn one
 * (feathered at their edges), so every pixel outside them is unchanged.
 */
export function pasteRegions(original: ArrayLike<number>, redrawn: ArrayLike<number>, width: number, height: number, regions: Box[], feather = 6): Uint8ClampedArray {
  const out = new Uint8ClampedArray(original as ArrayLike<number>);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = weightAt(x, y, regions, feather);
      if (w <= 0) continue;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(original[i + c] * (1 - w) + redrawn[i + c] * w);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** OpenAI's mask: transparent where the image is redrawn, opaque where it is kept. */
export function cleanMask(width: number, height: number, regions: Box[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x0, y0, x1, y1] of regions) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[(y * width + x) * 4 + 3] = 0;
  }
  return out;
}

export const CLEAN_PROMPT =
  "Remove every letter, word, number and logo inside the transparent areas, with their glows and shadows. " +
  "Fill those areas with exactly what continues around them: the same background, light, texture and objects. " +
  "Keep everything else exactly as it is. Add no text.";
