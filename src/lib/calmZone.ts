// Where the words go on a picture-only design.
//
// The image model is asked to keep one flat colour field for the headline, but
// where it puts that field varies: a full-width navy band, a red block in the
// upper third, the left half of a 9:16 frame. Typing the headline at a fixed
// height lands it half on the field and half on the photograph, so the field
// is found instead: the largest rectangle of the picture whose luminance
// barely changes from cell to cell. Pure arithmetic over a small luminance
// grid, so it can be tested without a canvas.

export interface CalmZone {
  /** Edges as percentages of the canvas. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Mean luminance of the zone, 0 (black) to 1 (white). */
  luminance: number;
}

/**
 * A cell is calm when it differs little from its right and lower neighbours.
 * `tolerance` is in luminance units; 0.045 lets a subtle ribbed or paper
 * texture through and stops at any real edge.
 */
export function calmMask(lum: ArrayLike<number>, cols: number, rows: number, tolerance = 0.045): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = lum[i];
      const right = c + 1 < cols ? lum[i + 1] : v;
      const down = r + 1 < rows ? lum[i + cols] : v;
      const left = c > 0 ? lum[i - 1] : v;
      const up = r > 0 ? lum[i - cols] : v;
      mask[i] =
        Math.abs(v - right) <= tolerance &&
        Math.abs(v - down) <= tolerance &&
        Math.abs(v - left) <= tolerance &&
        Math.abs(v - up) <= tolerance
          ? 1
          : 0;
    }
  }
  return mask;
}

/**
 * The largest all-calm rectangle in the mask (the histogram method, one pass
 * per row), as cell indices. Returns null when nothing qualifies.
 */
export function largestCalmRect(
  mask: Uint8Array,
  cols: number,
  rows: number,
): { c0: number; c1: number; r0: number; r1: number; area: number } | null {
  const heights = new Int32Array(cols);
  let best: { c0: number; c1: number; r0: number; r1: number; area: number } | null = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = mask[r * cols + c] ? heights[c] + 1 : 0;
    // Largest rectangle under the histogram `heights`.
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c < cols ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const c0 = stack.length ? stack[stack.length - 1] + 1 : 0;
        const c1 = c - 1;
        const area = height * (c1 - c0 + 1);
        if (height > 0 && (!best || area > best.area)) {
          best = { c0, c1, r0: r - height + 1, r1: r, area };
        }
      }
      stack.push(c);
    }
  }
  return best;
}

/**
 * The zone to type into, or null when the picture has no field large enough.
 *
 * The rectangle has to cover at least `minArea` of the canvas (default 9%),
 * be at least 30% wide and 10% tall — anything smaller is a gap between
 * things, not a field made for type.
 */
export function findCalmZone(
  lum: ArrayLike<number>,
  cols: number,
  rows: number,
  opts: { tolerance?: number; minArea?: number } = {},
): CalmZone | null {
  const mask = calmMask(lum, cols, rows, opts.tolerance);
  const rect = largestCalmRect(mask, cols, rows);
  if (!rect) return null;
  const w = rect.c1 - rect.c0 + 1;
  const h = rect.r1 - rect.r0 + 1;
  if (rect.area < (opts.minArea ?? 0.09) * cols * rows) return null;
  if (w < 0.3 * cols || h < 0.1 * rows) return null;
  let sum = 0;
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) sum += lum[r * cols + c];
  return {
    left: (rect.c0 / cols) * 100,
    right: ((rect.c1 + 1) / cols) * 100,
    top: (rect.r0 / rows) * 100,
    bottom: ((rect.r1 + 1) / rows) * 100,
    luminance: sum / (w * h),
  };
}

/** Mean luminance of a region given in percentages, for choosing type colour. */
export function regionLuminance(
  lum: ArrayLike<number>,
  cols: number,
  rows: number,
  region: { left: number; right: number; top: number; bottom: number },
): number {
  const c0 = Math.max(0, Math.floor((region.left / 100) * cols));
  const c1 = Math.min(cols - 1, Math.ceil((region.right / 100) * cols) - 1);
  const r0 = Math.max(0, Math.floor((region.top / 100) * rows));
  const r1 = Math.min(rows - 1, Math.ceil((region.bottom / 100) * rows) - 1);
  let sum = 0;
  let n = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { sum += lum[r * cols + c]; n++; }
  return n ? sum / n : 0.5;
}

/** White on anything darker than mid-grey, near-black otherwise. */
export function inkFor(luminance: number): string {
  return luminance < 0.55 ? "#ffffff" : "#111111";
}
