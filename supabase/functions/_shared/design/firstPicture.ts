// supabase/functions/_shared/design/firstPicture.ts
//
// The delivered picture is the model's first picture (17 Nov 2026, spec
// 2026-11-16-logo-tone-design.md, section 14). Taking the model's logo
// drawing out sends the whole picture back through the image model, and the
// whole picture comes back redrawn: the photo parts are grittier and a few
// pixels off. So the cleaned picture is never the base. The base is the
// first picture, pixel for pixel, and the cleaned picture is used in exactly
// one place: the slot's rectangle, where the drawing was found and removed.
//
//   where          the slot, a known rectangle, with a margin around it.
//                  Nothing else is ever taken from the cleaned picture, so
//                  the words and the photo outside it are the first
//                  picture's own pixels by construction;
//   the join       the patch is brought to the first picture's color by
//                  what the two pictures differ by on the ring around it,
//                  and fades into the first picture across that ring;
//   when it fails  the ring is where both pictures should show the same
//                  thing. When they do not (on average, or on more than a
//                  few cells, as with text the redraw moved), no clean join
//                  exists, and no picture is composed: the design keeps the cleaned
//                  picture as its base, as before this rule.
//
// Nothing here looks for what else the removal took out. A mark it removed
// somewhere else is still on the composed picture, the existing read for
// marks finds it there, and the design then goes on from its cleaned
// picture (firstPictureJob.ts).
//
// Every number is a count of pixels or a difference of color levels (0 to
// 255), measured on real designs (the spec has the measurements).
//
// Free of Deno and network imports: the picture service runs it, and the
// tests and the proof script read it.

import type { FirstPictureFacts, Rect } from "../picture/contract.ts";
import type { Raster } from "./logoTone.ts";

/** The numbers of the rule. */
export type FirstPictureRule = {
  /** Side of a cell in pixels. The ring is read as the mean color of each cell, so single-pixel grain does not decide. */
  cell: number;
  /** Cells added around the slot, where the cleaned pixels are used whole. */
  grow: number;
  /** Cells of the ring around that, across which the patch fades into the first picture. */
  feather: number;
  /** The join is clean when the two pictures, after the color correction, differ on the ring by at most this many levels on average. */
  joinMax: number;
  /** A ring cell is apart when, after the color correction, the two pictures differ on it by more than this many levels. */
  apartLevel: number;
  /** The join is clean only when at most this many ring cells are apart. */
  apartCells: number;
};

/**
 * `apartLevel` and `apartCells` catch what the mean cannot: a few strokes of
 * text or a hard edge that the redraw moved inside the ring, which would be
 * delivered doubled. Measured on the rings of the three real removals of
 * two live designs: 0 cells over 48 levels (the largest cell differences
 * are 32.4, 21.3 and 6.9). Measured with a thin line of text 12 pixels
 * under the slot of a real pair, moved 3 pixels: 12 to 200 cells over 48,
 * with means of 4.4 to 17 that pass `joinMax`.
 */
export const FIRST_PICTURE_RULE: FirstPictureRule = { cell: 4, grow: 2, feather: 4, joinMax: 20, apartLevel: 48, apartCells: 4 };

/**
 * How far from the slot's rectangle, in pixels, a pixel can be changed: the
 * margin, the ring, and under two cells for the cell grid (the slot's edge
 * rounded out to a cell, and the fade ending between two cells' centers).
 * Every pixel farther away, across or down, is the first picture's own.
 */
export function patchReach(rule: FirstPictureRule = FIRST_PICTURE_RULE): number {
  return (rule.grow + rule.feather + 2) * rule.cell;
}

/** What composing found, as the picture service answers it (picture/contract.ts, FirstPictureFacts). */
export type ComposeFacts = FirstPictureFacts;
type NotComposed = NonNullable<FirstPictureFacts["why"]>;

const places = (n: number, k: number) => Math.round(n * 10 ** k) / 10 ** k;

/** The mean color of one cell of a picture. A cell cut by the picture's edge is the mean of the pixels it has. */
function cellMean(r: Raster, cell: number, cx: number, cy: number): [number, number, number] {
  const x1 = Math.min(r.width, (cx + 1) * cell), y1 = Math.min(r.height, (cy + 1) * cell);
  let red = 0, green = 0, blue = 0, n = 0;
  for (let y = cy * cell; y < y1; y++) {
    for (let x = cx * cell; x < x1; x++) {
      const p = (y * r.width + x) * 4;
      red += r.data[p]; green += r.data[p + 1]; blue += r.data[p + 2]; n++;
    }
  }
  return [red / n, green / n, blue / n];
}

/** The middle value of a list (the lower of the two for an even count). The list is sorted in place. */
function middle(values: number[]): number {
  values.sort((x, y) => x - y);
  return values[(values.length - 1) >> 1];
}

/**
 * The first picture with the cleaned picture's slot, or no picture. `slot`
 * is the logo's slot in the pictures' own pixels. When a picture is
 * composed it is `first` itself, changed in place inside `facts.box` only
 * (two full pictures are in memory already; a third is not needed): no
 * pixel farther than `patchReach` from the slot is written. When none is
 * composed, `first` is not changed and `facts.why` says why.
 */
export function composeFirst(first: Raster, cleaned: Raster, slot: Rect, rule: FirstPictureRule = FIRST_PICTURE_RULE): { picture: Raster | null; facts: ComposeFacts } {
  const none = (why: NotComposed, join = 0) => ({ picture: null, facts: { made: false, why, share: 0, join } });
  if (first.width !== cleaned.width || first.height !== cleaned.height || !first.width || !first.height) return none("size");
  const W = first.width, H = first.height, S = rule.cell;
  const cw = Math.ceil(W / S), ch = Math.ceil(H / S);

  // The slot: every cell it touches on the picture.
  const sx0 = Math.max(0, Math.floor(slot.x / S)), sy0 = Math.max(0, Math.floor(slot.y / S));
  const sx1 = Math.min(cw - 1, Math.floor((slot.x + slot.width - 1) / S)), sy1 = Math.min(ch - 1, Math.floor((slot.y + slot.height - 1) / S));
  if (sx0 > sx1 || sy0 > sy1) return none("slot");

  // How much of the cleaned picture a cell takes: all of it in the slot and `grow` cells around it, then less with each cell of the ring, nothing beyond.
  const take = (cx: number, cy: number): number => {
    const x = Math.min(cw - 1, Math.max(0, cx)), y = Math.min(ch - 1, Math.max(0, cy));
    const away = Math.max(sx0 - x, x - sx1, sy0 - y, y - sy1) - rule.grow;
    return away <= 0 ? 1 : away > rule.feather ? 0 : 1 - away / (rule.feather + 1);
  };
  // The patch's cells: the slot, its margin, the ring, and one cell beyond in which the fade ends.
  const out = rule.grow + rule.feather + 1;
  const bx0 = Math.max(0, sx0 - out), by0 = Math.max(0, sy0 - out), bx1 = Math.min(cw - 1, sx1 + out), by1 = Math.min(ch - 1, sy1 + out);

  // The ring: where both pictures should show the same thing.
  const ring: Array<[number, number, number]> = [];
  for (let cy = by0; cy <= by1; cy++) {
    for (let cx = bx0; cx <= bx1; cx++) {
      const t = take(cx, cy);
      if (t <= 0 || t >= 1) continue;
      const a = cellMean(first, S, cx, cy), b = cellMean(cleaned, S, cx, cy);
      ring.push([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    }
  }
  // A slot with no ring on the picture has nothing of the first picture around it to join.
  if (!ring.length) return none("slot");
  // The color correction: what the first picture has more than the cleaned one on the ring, each channel's middle value.
  const offset = [0, 1, 2].map((c) => middle(ring.map((d) => d[c])));
  // The join: what is left between the two pictures on the ring after the correction, on the worst channel of each cell.
  let left = 0, apart = 0;
  for (const d of ring) {
    const by = Math.max(Math.abs(d[0] - offset[0]), Math.abs(d[1] - offset[1]), Math.abs(d[2] - offset[2]));
    left += by;
    if (by > rule.apartLevel) apart++;
  }
  const join = places(left / ring.length, 2);
  // Refused on the mean, or on cells that are far apart: strokes or an edge the redraw moved inside the ring would be delivered doubled.
  if (join > rule.joinMax || apart > rule.apartCells) return none("join", join);

  // The composed picture: inside the patch, the cleaned pixel with the correction, taken by the share its place has between the cells' centers.
  const box: Rect = { x: bx0 * S, y: by0 * S, width: Math.min(W, (bx1 + 1) * S) - bx0 * S, height: Math.min(H, (by1 + 1) * S) - by0 * S };
  const d = first.data, e = cleaned.data;
  for (let y = box.y; y < box.y + box.height; y++) {
    const fy = (y + 0.5) / S - 0.5, gy = Math.floor(fy), ty = fy - gy;
    for (let x = box.x; x < box.x + box.width; x++) {
      const fx = (x + 0.5) / S - 0.5, gx = Math.floor(fx), tx = fx - gx;
      const t = (take(gx, gy) * (1 - tx) + take(gx + 1, gy) * tx) * (1 - ty) + (take(gx, gy + 1) * (1 - tx) + take(gx + 1, gy + 1) * tx) * ty;
      if (t <= 0) continue;
      const p = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = e[p + c] + offset[c];
        d[p + c] = Math.max(0, Math.min(255, Math.round(d[p + c] + t * (v - d[p + c]))));
      }
    }
  }
  let cells = 0;
  for (let cy = by0; cy <= by1; cy++) for (let cx = bx0; cx <= bx1; cx++) if (take(cx, cy) > 0) cells++;
  return { picture: first, facts: { made: true, share: places(cells / (cw * ch), 4), join, box } };
}
