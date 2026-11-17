// supabase/functions/_shared/design/firstPicture.ts
//
// The delivered picture is the model's first picture (17 Nov 2026, spec
// 2026-11-16-logo-tone-design.md, section 14). Taking the model's logo
// drawing out sends the whole picture back through the image model, and the
// whole picture comes back redrawn: the photo parts are grittier and a few
// pixels off. So the cleaned picture is never the base. The base is the
// first picture, pixel for pixel, and the cleaned picture is used in exactly
// one place: the rectangle where the logo was removed.
//
//   where          the slot's rectangle, with a margin around it, when it is
//                  a fact that the logo was removed there. Either the search
//                  found the drawing at that rectangle, or (a slot at the
//                  canvas rectangle, where the search did not recognize the
//                  drawing) the two pictures themselves show the removal
//                  inside it; the rectangle is then carried out, side by
//                  side, as far as that removal runs past it, because a
//                  drawing the search did not recognize is often larger or
//                  lower than the canvas had it. Nothing else is ever taken
//                  from the cleaned picture, so the words and the photo outside it are the
//                  first picture's own pixels by construction;
//   the join       the patch is brought to the first picture's color by
//                  what the two pictures differ by on the ring around it,
//                  and fades into the first picture across that ring;
//   when it fails  the ring is where both pictures should show the same
//                  thing. When they do not (on average, or on more than a
//                  few cells, as with text the redraw moved), no clean join
//                  exists, and no picture is composed. What the design
//                  does then is the worker's rule (firstPictureJob.ts).
//
// Nothing here looks for what else the removal took out. A mark it removed
// somewhere else is still on the composed picture, and the existing read
// for marks finds it there. What the design does then is the worker's rule
// too (firstPictureJob.ts).
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
  /** A rectangle the search did not find the drawing at is where the logo was removed only when at least this share of its cells are apart. */
  removedShare: number;
};

/**
 * `apartLevel` and `apartCells` catch what the mean cannot: a few strokes of
 * text or a hard edge that the redraw moved inside the ring, which would be
 * delivered doubled. Measured on the rings of the three real removals of
 * two live designs: 0 cells over 48 levels (the largest cell differences
 * are 32.4, 21.3 and 6.9). Measured with a thin line of text 12 pixels
 * under the slot of a real pair, moved 3 pixels: 12 to 200 cells over 48,
 * with means of 4.4 to 17 that pass `joinMax`.
 *
 * `removedShare` is the same measure read the other way: inside the
 * rectangle a removed logo leaves many cells apart, a redraw alone leaves
 * few. Measured on four removals of three live designs (cells over 48
 * levels, before the correction): where the logo was removed, 28.3%, 27.8%,
 * 43.9% and 35.0% of the rectangle's cells (the last is a slot at the
 * canvas rectangle, a logo the model drew in another color). The same
 * rectangle laid everywhere else on those pictures, some 60,000 to 72,000
 * places each: at most 1.6%, 2.4%, 8.4% (a croissant's crust) and 15.3% (a
 * block of list text the removal softened). The line is one fifth.
 * On that fourth design the canvas rectangle is 544x143 at (816, 109) and
 * the model drew its logo 607x157 at (781, 146): with the canvas rectangle
 * alone the ring crosses the lower line of the logo and the join reads 44.
 * Carried out to where the removal ends (35 pixels left, 27 right, 50 down)
 * the ring is clean.
 */
export const FIRST_PICTURE_RULE: FirstPictureRule = { cell: 4, grow: 2, feather: 4, joinMax: 20, apartLevel: 48, apartCells: 4, removedShare: 0.2 };

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

type Cells = { x0: number; y0: number; x1: number; y1: number };

/**
 * Where the logo was removed, in cells: the one decision every composed
 * picture starts from. `slot` is the slot's cells and `far` says whether
 * the two pictures are far apart on a cell.
 *
 * A found drawing's rectangle is that place as it is: the search is the
 * fact. A rectangle the search did not find the drawing at is that place
 * only when at least `removedShare` of its cells are far apart, and it is
 * then carried out on each side, a line of cells at a time, while the line
 * just past that side still has a cell far apart, by the rectangle's
 * shorter side at most. A side that stops at the limit with the removal
 * still running leaves cells far apart on the ring, and the join refuses.
 *
 * `removed` is the share of the slot's own cells that are far apart, for
 * both kinds. `cells` is null when the rectangle is not such a place.
 */
function removedAt(slot: Cells, found: boolean, far: (cx: number, cy: number) => boolean, cw: number, ch: number, rule: FirstPictureRule): { cells: Cells | null; removed: number } {
  let apart = 0;
  for (let cy = slot.y0; cy <= slot.y1; cy++) for (let cx = slot.x0; cx <= slot.x1; cx++) if (far(cx, cy)) apart++;
  const removed = places(apart / ((slot.x1 - slot.x0 + 1) * (slot.y1 - slot.y0 + 1)), 4);
  if (found) return { cells: slot, removed };
  if (removed < rule.removedShare) return { cells: null, removed };
  const most = Math.min(slot.x1 - slot.x0 + 1, slot.y1 - slot.y0 + 1);
  const c = { ...slot };
  const across = (cy: number) => { for (let cx = c.x0; cx <= c.x1; cx++) if (far(cx, cy)) return true; return false; };
  const down = (cx: number) => { for (let cy = c.y0; cy <= c.y1; cy++) if (far(cx, cy)) return true; return false; };
  for (let moved = true; moved;) {
    moved = false;
    if (c.y0 > 0 && slot.y0 - c.y0 < most && across(c.y0 - 1)) { c.y0--; moved = true; }
    if (c.y1 < ch - 1 && c.y1 - slot.y1 < most && across(c.y1 + 1)) { c.y1++; moved = true; }
    if (c.x0 > 0 && slot.x0 - c.x0 < most && down(c.x0 - 1)) { c.x0--; moved = true; }
    if (c.x1 < cw - 1 && c.x1 - slot.x1 < most && down(c.x1 + 1)) { c.x1++; moved = true; }
  }
  return { cells: c, removed };
}

/**
 * The first picture with the cleaned picture's pixels where the logo was
 * removed, or no picture. `slot` is the logo's slot in the pictures' own
 * pixels, and `found` says the search found the drawing there. Where the
 * logo was removed is decided once (`removedAt`); when the slot is no such
 * place nothing is composed, with `why` "removal". When a picture is
 * composed it is `first` itself, changed in place inside `facts.box` only
 * (two full pictures are in memory already; a third is not needed). For a
 * found drawing no pixel farther than `patchReach` from the slot is
 * written. When none is composed, `first` is not changed and `facts.why`
 * says why.
 */
export function composeFirst(first: Raster, cleaned: Raster, slot: Rect, found: boolean, rule: FirstPictureRule = FIRST_PICTURE_RULE): { picture: Raster | null; facts: ComposeFacts } {
  const none = (why: NotComposed, measured: { join?: number; removed?: number } = {}) => ({ picture: null, facts: { made: false, why, share: 0, join: measured.join ?? 0, ...(measured.removed === undefined ? {} : { removed: measured.removed }) } });
  if (first.width !== cleaned.width || first.height !== cleaned.height || !first.width || !first.height) return none("size");
  const W = first.width, H = first.height, S = rule.cell;
  const cw = Math.ceil(W / S), ch = Math.ceil(H / S);

  // The slot: every cell it touches on the picture.
  const cells: Cells = {
    x0: Math.max(0, Math.floor(slot.x / S)), y0: Math.max(0, Math.floor(slot.y / S)),
    x1: Math.min(cw - 1, Math.floor((slot.x + slot.width - 1) / S)), y1: Math.min(ch - 1, Math.floor((slot.y + slot.height - 1) / S)),
  };
  if (cells.x0 > cells.x1 || cells.y0 > cells.y1) return none("slot");

  // What the first picture has more than the cleaned one on a cell, read once for each cell that is asked about.
  const read = new Map<number, [number, number, number]>();
  const apartOn = (cx: number, cy: number): [number, number, number] => {
    const key = cy * cw + cx;
    let d = read.get(key);
    if (!d) {
      const a = cellMean(first, S, cx, cy), b = cellMean(cleaned, S, cx, cy);
      read.set(key, d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    }
    return d;
  };
  const by = (d: [number, number, number], offset: number[]) => Math.max(Math.abs(d[0] - offset[0]), Math.abs(d[1] - offset[1]), Math.abs(d[2] - offset[2]));

  // Where the logo was removed.
  const place = removedAt(cells, found, (cx, cy) => by(apartOn(cx, cy), [0, 0, 0]) > rule.apartLevel, cw, ch, rule);
  const removed = place.removed;
  if (!place.cells) return none("removal", { removed });
  const { x0: sx0, y0: sy0, x1: sx1, y1: sy1 } = place.cells;

  // How much of the cleaned picture a cell takes: all of it in that rectangle and `grow` cells around it, then less with each cell of the ring, nothing beyond.
  const take = (cx: number, cy: number): number => {
    const x = Math.min(cw - 1, Math.max(0, cx)), y = Math.min(ch - 1, Math.max(0, cy));
    const away = Math.max(sx0 - x, x - sx1, sy0 - y, y - sy1) - rule.grow;
    return away <= 0 ? 1 : away > rule.feather ? 0 : 1 - away / (rule.feather + 1);
  };
  // The patch's cells: the rectangle, its margin, the ring, and one cell beyond in which the fade ends.
  const out = rule.grow + rule.feather + 1;
  const bx0 = Math.max(0, sx0 - out), by0 = Math.max(0, sy0 - out), bx1 = Math.min(cw - 1, sx1 + out), by1 = Math.min(ch - 1, sy1 + out);

  // The ring: where both pictures should show the same thing.
  const ring: Array<[number, number, number]> = [];
  for (let cy = by0; cy <= by1; cy++) {
    for (let cx = bx0; cx <= bx1; cx++) {
      const t = take(cx, cy);
      if (t > 0 && t < 1) ring.push(apartOn(cx, cy));
    }
  }
  // A slot with no ring on the picture has nothing of the first picture around it to join.
  if (!ring.length) return none("slot");
  // The color correction: what the first picture has more than the cleaned one on the ring, each channel's middle value.
  const offset = [0, 1, 2].map((c) => middle(ring.map((d) => d[c])));
  // The join: what is left between the two pictures on the ring after the correction, on the worst channel of each cell.
  let left = 0, apart = 0;
  for (const d of ring) {
    const rest = by(d, offset);
    left += rest;
    if (rest > rule.apartLevel) apart++;
  }
  const join = places(left / ring.length, 2);
  // Refused on the mean, or on cells that are far apart: strokes or an edge the redraw moved inside the ring would be delivered doubled.
  if (join > rule.joinMax || apart > rule.apartCells) return none("join", { join, removed });

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
  let taken = 0;
  for (let cy = by0; cy <= by1; cy++) for (let cx = bx0; cx <= bx1; cx++) if (take(cx, cy) > 0) taken++;
  return { picture: first, facts: { made: true, share: places(taken / (cw * ch), 4), join, removed, box } };
}
