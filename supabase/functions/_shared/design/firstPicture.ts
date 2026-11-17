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
// The redraw changes the whole picture a little, and on some pictures (a
// field of stars, a busy photo) more than a little. Two measures therefore
// have a second reading, against the same pair of pictures (17 Nov 2026,
// evening). Each only adds to what the fixed number already lets through,
// and what it adds is always a composed picture whose join passed:
//
//   a small logo   a slot at the canvas rectangle with under one fifth of
//                  its cells far apart is still where the logo was removed
//                  when it holds more cells far apart than any place of its
//                  size anywhere else on the picture (`floorOf`);
//   a busy ring    a ring with more than a few cells far apart is still a
//                  clean join when those cells are single points: no more
//                  than the same few of them touch another, and the ring
//                  holds no larger share of cells far apart than the ring
//                  in the middle of all rings of its size and shape laid
//                  everywhere else on the picture (`ringsElsewhere`).
//
// And one more place is looked at (18 Nov 2026). The model does not always
// draw its logo where the canvas had it, and the slot is where the brand's
// file is stamped whatever the model did. When the slot holds no removal,
// the cleaning still took the drawing out somewhere, and the whole cleaned
// picture was delivered for it:
//
//   elsewhere      what the cleaning took out is read from the pair: cells
//                  far apart around which the cleaned picture is plain
//                  (where the redraw only moved a thing, the cleaned
//                  picture shows that thing still). When all such cells
//                  that touch another lie in one rectangle no larger than
//                  a slot's place ever is, holding as many cells far apart
//                  as the rule asks of the slot and more than any block of
//                  its size elsewhere, that rectangle is the place
//                  (`composeFirst`, `takenOut`). Nothing taken out is then
//                  left outside it, the join is held to the same rule, and
//                  a join that fails is "removal", as the slot always was.
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

import type { FirstPictureFacts, FirstPictureMeasure, Rect } from "../picture/contract.ts";
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
  /**
   * A place away from the slot is patched only when the cleaned picture keeps at least this share of the first picture's detail
   * on the ring around it, at every scale it is read at (`detailOn`). Nothing is stamped over such a patch, so a cleaned picture
   * that came back smoother than the first would show there as a smooth rectangle on a grainy ground, whatever its color.
   */
  detailShare: number;
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
 *
 * The two readings against the pair itself (17 Nov 2026, evening) have no
 * number of their own. They come from four slides of one live carousel
 * drawn on a field of stars, where the model drew a thin wordmark smaller
 * than the canvas had it: 12.0%, 13.2%, 12.4% and 12.3% of the rectangle's
 * cells are far apart, under one fifth, so all four were delivered from
 * their cleaned pictures, soft all over. The same rectangle laid everywhere
 * else on those pictures (some 170,000 places each) holds at most 4.0%,
 * 6.6%, 5.0% and 3.8%. The rings around three of those removals hold 10, 7
 * and 13 cells over 48 levels, stars the redraw moved or left out, where
 * four are allowed (the fourth holds no more than four); 3, 0 and 3 of
 * them touch another. The rings of the same size and shape laid everywhere
 * else on each picture, some 157,000, hold 21, 31 and 22 in the middle: 10
 * to 30% of those rings hold fewer cells far apart than the removal's own,
 * and 7 to 10% hold four or fewer. With the logo taken off those pairs and
 * the rectangle laid at 160 other places, every one is answered "removal",
 * as before.
 * The middle ring is the measure of the points because it has no number to
 * fit: the ring holds no more of them than half of the rings like it on the
 * same pair. On a calm picture that is none, and nothing passes that four
 * cells would not.
 * The cells that touch keep the count of four because of two designs of one
 * live request drawn on gravel in dappled light, with a white wordmark the
 * search found: the redraw gave all the gravel another texture, the rings
 * hold 25 and 32 cells over 48 levels, 10 and 20 of them touching, with
 * means of 17.8 and 18.6 that pass `joinMax`, and the patch, composed, shows
 * as a rectangle of that other texture at full size. Read against the pair
 * alone they would pass (the middle rings there hold 73 and 56). They are
 * refused, as before.
 */
export const FIRST_PICTURE_RULE: FirstPictureRule = { cell: 4, grow: 2, feather: 4, joinMax: 20, apartLevel: 48, apartCells: 4, removedShare: 0.2, detailShare: 0.5 };

/**
 * The detail of a picture on some of its cells at one scale: how much its
 * pixels differ from the pixels `apart` to their right and under them, in
 * levels, on the worst channel, as the root of the mean square. Only pairs
 * with both pixels on those cells are read. It is read on the pixels
 * themselves, because a blur keeps a cell's mean and takes exactly this.
 *
 * It is read at three scales, none of them a number of its own: pixels
 * side by side, a cell apart, and two cells apart, which is half the
 * ring's width and so the farthest that still gives every pixel of the
 * ring a partner on it. A cleaned picture has to keep `detailShare` at each
 * of them, because a redraw can smooth a coarse texture away and put fresh
 * fine noise in its place: side by side it then holds as much as the first
 * picture or more, and a few pixels apart far less.
 *
 * It is a mean square (the detail's energy) and the share is of that,
 * because of the same redraws: a mean of plain differences is raised by
 * noise in every pixel as much as it is lowered by the loss of a texture's
 * few strong edges, and reads such a ground as kept. `detailShare` is one
 * half of the energy, which is 0.71 of the differences themselves.
 * Measured (the differences' share, cleaned against first, at 1, 4 and 8
 * pixels apart): a ground of grain smoothed over three pixels by three
 * 0.19, 0.33, 0.32, and over five by five less; grain with 0.45 of that
 * smoothing mixed in 0.55, 0.57, 0.57; blotches of 6 pixels smoothed with
 * fine noise added 0.43, 0.51, 0.61 and 0.33, 0.50, 0.60; blotches of 12
 * pixels 0.46, 0.56, 0.69. Every one of those showed as a smooth rectangle,
 * and the join read 1.2 to 6.1 and passed. On the live pair this path was
 * made for (a script wordmark on a plain ground, with 1.1 to 1.7 levels of
 * detail) the cleaned picture keeps 0.96, 1.07 and 1.13. Nothing measured
 * lies between 0.69 and 0.96.
 * It is one-sided: a cleaned picture with more detail than the first is
 * not refused by it (a ground given another texture is the join's to
 * refuse, by the cells that touch). And a scale at which the first picture
 * holds under one level has nothing a picture of whole levels could lose:
 * it is not held against the cleaned picture.
 */
function detailOn(r: Raster, cell: number, cw: number, cells: number[], on: Uint8Array, apart: number): number {
  const d = r.data;
  let squares = 0, pairs = 0;
  for (const at of cells) {
    const cx = at % cw, cy = (at - cx) / cw;
    const x1 = Math.min(r.width, (cx + 1) * cell), y1 = Math.min(r.height, (cy + 1) * cell);
    for (let y = cy * cell; y < y1; y++) {
      for (let x = cx * cell; x < x1; x++) {
        const p = (y * r.width + x) * 4;
        for (const [qx, qy] of [[x + apart, y], [x, y + apart]]) {
          if (qx >= r.width || qy >= r.height || !on[Math.floor(qy / cell) * cw + Math.floor(qx / cell)]) continue;
          const q = (qy * r.width + qx) * 4;
          const most = Math.max(Math.abs(d[p] - d[q]), Math.abs(d[p + 1] - d[q + 1]), Math.abs(d[p + 2] - d[q + 2]));
          squares += most * most;
          pairs++;
        }
      }
    }
  }
  return pairs ? Math.sqrt(squares / pairs) : 0;
}

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
const cellsIn = (c: Cells) => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);

/** A total over any rectangle of cells, in one step: a whole number for each cell, summed once over the picture. */
function totals(cw: number, ch: number, value: (cx: number, cy: number) => number): (c: Cells) => number {
  const wide = cw + 1;
  const sums = new Int32Array(wide * (ch + 1));
  for (let cy = 0; cy < ch; cy++) {
    let row = 0;
    for (let cx = 0; cx < cw; cx++) {
      row += value(cx, cy);
      sums[(cy + 1) * wide + cx + 1] = sums[cy * wide + cx + 1] + row;
    }
  }
  return (c) => sums[(c.y1 + 1) * wide + c.x1 + 1] - sums[c.y0 * wide + c.x1 + 1] - sums[(c.y1 + 1) * wide + c.x0] + sums[c.y0 * wide + c.x0];
}

/** A rectangle of cells with `by` more on every side, as far as the picture goes. */
function grown(c: Cells, by: number, cw: number, ch: number): Cells {
  return { x0: Math.max(0, c.x0 - by), y0: Math.max(0, c.y0 - by), x1: Math.min(cw - 1, c.x1 + by), y1: Math.min(ch - 1, c.y1 + by) };
}

/** The slot's surroundings: the slot carried out by its shorter side, which is as far as its place is ever carried (`removedAt`). */
function surroundings(slot: Cells, cw: number, ch: number): Cells {
  return grown(slot, Math.min(slot.x1 - slot.x0 + 1, slot.y1 - slot.y0 + 1), cw, ch);
}

/** Every place a block of `w` by `h` cells has on the picture that lies wholly outside `away`: `each` hears its left and top cell. */
function elsewhere(cw: number, ch: number, away: Cells, w: number, h: number, each: (x: number, y: number) => void): void {
  for (let y = 0; y + h <= ch; y++) {
    const clear = y + h - 1 < away.y0 || y > away.y1;
    for (let x = 0; x + w <= cw; x++) if (clear || x + w - 1 < away.x0 || x > away.x1) each(x, y);
  }
}

/**
 * The pair's own floor for a block of `w` by `h` cells: the largest total
 * any block of that size has that lies wholly outside `away`. It is the
 * most the redraw alone did to a place of that size. Null when no such
 * block has a place on the picture: there is nothing to compare with.
 */
function floorOf(total: (c: Cells) => number, cw: number, ch: number, away: Cells, w: number, h: number): number | null {
  let most = -1;
  elsewhere(cw, ch, away, w, h, (x, y) => { most = Math.max(most, total({ x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 })); });
  return most < 0 ? null : most;
}

/** The middle value of whole numbers (the lower of the two for an even count). */
function middleOf(values: Int32Array): number {
  return values.sort()[(values.length - 1) >> 1];
}

/**
 * How changed the pair is on rings like the patch's own, everywhere else on
 * the picture. `far` is a total of cells far apart. A ring is the cells
 * between a block `inner` cells smaller on every side and the block itself,
 * `w` by `h` cells; it is laid at every place wholly outside `away`. The
 * answer is the middle count over those rings, how many cells one ring has
 * and how many rings were read. Null when no ring has a place: there is
 * nothing to compare with.
 */
function ringsElsewhere(far: (c: Cells) => number, cw: number, ch: number, away: Cells, w: number, h: number, inner: number): { apart: number; cells: number; rings: number } | null {
  let rings = 0;
  elsewhere(cw, ch, away, w, h, () => { rings++; });
  if (!rings) return null;
  const counts = new Int32Array(rings);
  let k = 0;
  elsewhere(cw, ch, away, w, h, (x, y) => {
    counts[k++] = far({ x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }) - far({ x0: x + inner, y0: y + inner, x1: x + w - 1 - inner, y1: y + h - 1 - inner });
  });
  return { apart: middleOf(counts), cells: w * h - (w - 2 * inner) * (h - 2 * inner), rings };
}

/**
 * Where the logo was removed, in cells: the one decision every composed
 * picture starts from. `slot` is the slot's cells and `far` says whether
 * the two pictures are far apart on a cell.
 *
 * A found drawing's rectangle is that place as it is: the search is the
 * fact. A rectangle the search did not find the drawing at is that place
 * when at least `removedShare` of its cells are far apart. Under that
 * share it still is when `standsOut` says so of its count of cells far
 * apart: more than any place of its size holds elsewhere on the picture
 * (`composeFirst`). It is then carried out on each side, a line of cells at
 * a time, while the line just past that side still has a cell far apart, by
 * the rectangle's shorter side at most. A side that stops at the limit with
 * the removal still running leaves cells far apart on the ring, and the
 * join refuses.
 *
 * `removed` is the share of the slot's own cells that are far apart, for
 * both kinds. `cells` is null when the rectangle is not such a place.
 * `sure` is false for a place only `standsOut` made one: what a join that
 * fails means is different for it (`composeFirst`).
 */
function removedAt(slot: Cells, found: boolean, far: (cx: number, cy: number) => boolean, cw: number, ch: number, rule: FirstPictureRule, standsOut: (apart: number) => boolean): { cells: Cells | null; removed: number; sure: boolean } {
  let apart = 0;
  for (let cy = slot.y0; cy <= slot.y1; cy++) for (let cx = slot.x0; cx <= slot.x1; cx++) if (far(cx, cy)) apart++;
  const removed = places(apart / cellsIn(slot), 4);
  if (found) return { cells: slot, removed, sure: true };
  const sure = removed >= rule.removedShare;
  if (!sure && !standsOut(apart)) return { cells: null, removed, sure };
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
  return { cells: c, removed, sure };
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
 *
 * A join that fails is "join" where the rule's own numbers made the place
 * (a found drawing, or a canvas rectangle with `removedShare` of its cells
 * far apart): the worker makes such a design again. Where only the reading
 * against the pair made it a place, a join that fails is "removal", as the
 * same slot was before that reading: nothing is composed and no design is
 * made again for it.
 *
 * A canvas rectangle that holds no removal is not the end of it: the place
 * the cleaning took the drawing out of may lie away from the slot
 * (`takenOut`, inside). The patch is then laid there, `facts.box` lies
 * around that place, and the slot is not touched. Its join is held to the
 * same rule, and when it fails the answer is "removal" too.
 *
 * `facts.measured` holds what was read against the pair, when it was: the
 * floor a canvas rectangle under `removedShare` was held against, the place
 * found away from the slot, and the
 * ring and the rings elsewhere when the ring held more than `apartCells`
 * cells far apart.
 */
export function composeFirst(first: Raster, cleaned: Raster, slot: Rect, found: boolean, rule: FirstPictureRule = FIRST_PICTURE_RULE): { picture: Raster | null; facts: ComposeFacts } {
  // What was read against the pair itself, when anything was (for review; it decides nothing by being kept).
  const measure: FirstPictureMeasure = {};
  const kept = (removed?: number) => ({ ...(removed === undefined ? {} : { removed }), ...(Object.keys(measure).length ? { measured: measure } : {}) });
  const none = (why: NotComposed, measured: { join?: number; removed?: number } = {}) => ({ picture: null, facts: { made: false, why, share: 0, join: measured.join ?? 0, ...kept(measured.removed) } });
  if (first.width !== cleaned.width || first.height !== cleaned.height || !first.width || !first.height) return none("size");
  const W = first.width, H = first.height, S = rule.cell;
  const cw = Math.ceil(W / S), ch = Math.ceil(H / S);

  // The slot: every cell it touches on the picture.
  const cells: Cells = {
    x0: Math.max(0, Math.floor(slot.x / S)), y0: Math.max(0, Math.floor(slot.y / S)),
    x1: Math.min(cw - 1, Math.floor((slot.x + slot.width - 1) / S)), y1: Math.min(ch - 1, Math.floor((slot.y + slot.height - 1) / S)),
  };
  if (cells.x0 > cells.x1 || cells.y0 > cells.y1) return none("slot");

  // What the first picture has more than the cleaned one on a cell, read once for each cell that is asked about. A reading against
  // the pair itself asks about every cell of the picture: they are then all read at once (`everyCell`), with the same arithmetic.
  const read = new Map<number, [number, number, number]>();
  let whole: Float64Array | null = null;
  const everyCell = () => {
    if (whole) return;
    whole = new Float64Array(cw * ch * 3);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const a = cellMean(first, S, cx, cy), b = cellMean(cleaned, S, cx, cy);
        whole.set([a[0] - b[0], a[1] - b[1], a[2] - b[2]], (cy * cw + cx) * 3);
      }
    }
  };
  const apartOn = (cx: number, cy: number): [number, number, number] => {
    const key = cy * cw + cx;
    if (whole) return [whole[key * 3], whole[key * 3 + 1], whole[key * 3 + 2]];
    let d = read.get(key);
    if (!d) {
      const a = cellMean(first, S, cx, cy), b = cellMean(cleaned, S, cx, cy);
      read.set(key, d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    }
    return d;
  };
  const by = (d: [number, number, number], offset: number[]) => Math.max(Math.abs(d[0] - offset[0]), Math.abs(d[1] - offset[1]), Math.abs(d[2] - offset[2]));

  // Where the logo was removed.
  const plain = (cx: number, cy: number) => by(apartOn(cx, cy), [0, 0, 0]) > rule.apartLevel;
  const around = surroundings(cells, cw, ch);
  // A canvas rectangle under `removedShare`: it holds more cells far apart than any place of its size outside its surroundings,
  // by more than the few cells the rule lets through anywhere (`apartCells`). Without that margin one stray cell in an empty
  // rectangle, on a pair that differs nowhere else by as much, would be taken for a removed logo and the whole rectangle patched.
  const standsOut = (apart: number): boolean => {
    everyCell();
    const floor = floorOf(totals(cw, ch, (cx, cy) => (plain(cx, cy) ? 1 : 0)), cw, ch, around, cells.x1 - cells.x0 + 1, cells.y1 - cells.y0 + 1);
    if (floor === null) return false;
    measure.floor = places(floor / cellsIn(cells), 4);
    return apart > floor + rule.apartCells;
  };
  /**
   * The one place the cleaning took something out of, away from a slot that holds no removal, or null: the answer is then
   * "removal", as it always was. Every condition has to hold.
   *   taken out   a cell far apart around which the cleaned picture is plain: none of the cells beside it, side or corner, is far
   *               apart from it in the cleaned picture. Where the redraw moved or redrew a thing (the edge of a letter, of an
   *               object) the cleaned picture still shows it beside the cell, and the cell is none of these.
   *   one place   the rectangle around every such cell that touches another. So nothing of two cells or more that was taken
   *               out is left outside it: a second mark, an icon or a dot beside the drawing is inside it, or it is too large.
   *   no larger   than a slot's own place ever is: the slot carried out by its shorter side (`removedAt`). The drawing is the
   *               canvas logo redrawn, larger or smaller within what the rule already takes; and so a patch stays as small
   *               against the picture as any patch was.
   *   as much     cells far apart in it as the rule asks of the slot: `removedShare` of the slot's cells. A crumb is no logo.
   *   stands out  it holds more cells far apart than any block of its size outside the patch it would be given, by more than
   *               the few cells the rule lets through anywhere (`apartCells`), as the slot has to. So nothing outside the
   *               patch is as changed as the place, whatever kind of change it is.
   * Measured on a live design (18 Nov 2026): a script wordmark the model drew on a plain ground just under the slot, which
   * held 0.45% of its cells far apart, so the whole cleaned picture was delivered. Of the pair's 2,028 cells far apart, 1,425
   * have the cleaned picture plain around them, and all of those that touch another lie in 158 cells by 31, the drawing (a
   * slot's place there is 189 by 72 at most). It holds 0.40 of the slot's cells where the rule asks 0.20, and a block of its
   * size holds at most 0.05 anywhere else. The other 603, around which the cleaned picture is not plain, are the edges of the
   * headline's letters and of the photo's objects, redrawn a little off. Composed, the patch is 2.1% of the picture and its
   * ring's mean is 1.95. On a second live pair of that day the model drew no logo at all and the redraw moved points of light
   * all over: 1,602 of its 2,701 cells far apart read as taken out, the rectangle around those that touch is 2,144 pixels by
   * 244, and laid at 60 places the slot is answered "removal" at every one. So are four pairs on a field of stars and two on
   * gravel with the slot laid away from their drawings: what was taken out there lies all over the picture.
   */
  const takenOut = (): Cells | null => {
    everyCell();
    const far = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) if (plain(cx, cy)) far[cy * cw + cx] = 1;
    const shown = new Map<number, [number, number, number]>();
    const cleanedOn = (cx: number, cy: number) => {
      let m = shown.get(cy * cw + cx);
      if (!m) shown.set(cy * cw + cx, m = cellMean(cleaned, S, cx, cy));
      return m;
    };
    const gone = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        if (!far[cy * cw + cx]) continue;
        const here = cleanedOn(cx, cy);
        let plainAround = true;
        for (let k = 0; k < 9 && plainAround; k++) {
          const x = cx + (k % 3) - 1, y = cy + Math.floor(k / 3) - 1;
          if (x >= 0 && y >= 0 && x < cw && y < ch) plainAround = by(cleanedOn(x, y), here) <= rule.apartLevel;
        }
        if (plainAround) gone[cy * cw + cx] = 1;
      }
    }
    const isGone = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < cw && cy < ch && gone[cy * cw + cx] === 1;
    const c: Cells = { x0: cw, y0: ch, x1: -1, y1: -1 };
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        if (!gone[cy * cw + cx]) continue;
        let beside = false;
        for (let k = 0; k < 9 && !beside; k++) beside = k !== 4 && isGone(cx + (k % 3) - 1, cy + Math.floor(k / 3) - 1);
        if (!beside) continue;
        c.x0 = Math.min(c.x0, cx); c.y0 = Math.min(c.y0, cy); c.x1 = Math.max(c.x1, cx); c.y1 = Math.max(c.y1, cy);
      }
    }
    if (c.x1 < 0) return null;
    const total = totals(cw, ch, (cx, cy) => far[cy * cw + cx]);
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1, sw = cells.x1 - cells.x0 + 1, sh = cells.y1 - cells.y0 + 1, most = Math.min(sw, sh);
    const apart = total(c);
    measure.elsewhere = { place: { x: c.x0 * S, y: c.y0 * S, width: Math.min(W, (c.x1 + 1) * S) - c.x0 * S, height: Math.min(H, (c.y1 + 1) * S) - c.y0 * S }, apart: places(apart / cellsIn(cells), 4) };
    if (w > sw + 2 * most || h > sh + 2 * most) return null;
    if (measure.elsewhere.apart < rule.removedShare) return null;
    // Elsewhere is everything the patch does not cover: the place, its margin, its ring and the cell in which the fade ends.
    const floor = floorOf(total, cw, ch, grown(c, rule.grow + rule.feather + 1, cw, ch), w, h);
    if (floor === null) return null;
    measure.elsewhere.floor = places(floor / cellsIn(cells), 4);
    return apart > floor + rule.apartCells ? c : null;
  };
  let place = removedAt(cells, found, plain, cw, ch, rule, standsOut);
  const removed = place.removed;
  // The surroundings of the place, which the rings a busy ring is read against keep out of.
  let home = around, away: Cells | null = null;
  if (!place.cells) {
    // The slot holds no removal (a found drawing always is its own place, so this is a canvas rectangle). Where the cleaning took
    // the drawing out, if it is one place the pair shows plainly.
    away = takenOut();
    if (away) {
      place = { cells: away, removed, sure: false };
      home = surroundings(away, cw, ch);
    }
  }
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
  const ring: Array<[number, number, number]> = [], ringAt: number[] = [];
  for (let cy = by0; cy <= by1; cy++) {
    for (let cx = bx0; cx <= bx1; cx++) {
      const t = take(cx, cy);
      if (t > 0 && t < 1) { ring.push(apartOn(cx, cy)); ringAt.push(cy * cw + cx); }
    }
  }
  // A slot with no ring on the picture has nothing of the first picture around it to join. (A place away from the slot always
  // has one: it stood above a block of its size outside its patch, so the picture goes on past its ring.)
  if (!ring.length) return none("slot");
  if (away) {
    // Nothing is stamped over a patch away from the slot, so it must not show by itself: the cleaned picture has to keep the
    // first picture's detail on the ring, where both show the same ground, at every scale (`detailOn`, `detailShare`). A scale
    // at which the first picture holds under one level has none to lose.
    const on = new Uint8Array(cw * ch);
    for (const at of ringAt) on[at] = 1;
    const kept = [1, S, 2 * S].map((apart) => ({ apart, first: places(detailOn(first, S, cw, ringAt, on, apart), 2), cleaned: places(detailOn(cleaned, S, cw, ringAt, on, apart), 2) }));
    (measure.elsewhere as NonNullable<FirstPictureMeasure["elsewhere"]>).detail = kept;
    if (kept.some((k) => k.first >= 1 && k.cleaned * k.cleaned < rule.detailShare * k.first * k.first)) return none("removal", { removed });
  }
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
  let clean = join <= rule.joinMax && apart <= rule.apartCells;
  if (!clean && join <= rule.joinMax) {
    // More than a few cells far apart. On a picture full of points of light the redraw moved, that is what any ring holds, and a
    // point shown at part strength by the fade is nothing a person sees. So the ring is read once more, in two parts. The cells
    // far apart that touch another, side or corner, are no points: a stroke, an edge, a mark, or a ground the redraw gave another
    // texture, on which the patch would show as a rectangle. They keep the rule's own count. The rest are held to the pair: the
    // same color correction on every cell of the picture, the same ring laid everywhere outside the slot's surroundings, and no
    // larger share of cells far apart than the ring in the middle of those. On a calm picture that ring holds none.
    everyCell();
    const far = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) if (by(apartOn(cx, cy), offset) > rule.apartLevel) far[cy * cw + cx] = 1;
    const isFar = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < cw && cy < ch && far[cy * cw + cx] === 1;
    let touching = 0;
    for (const at of ringAt) {
      if (!far[at]) continue;
      const cx = at % cw, cy = (at - cx) / cw;
      let beside = false;
      for (let k = 0; k < 9 && !beside; k++) beside = k !== 4 && isFar(cx + (k % 3) - 1, cy + Math.floor(k / 3) - 1);
      if (beside) touching++;
    }
    measure.ring = { cells: ring.length, apart, touching };
    // The rule's own count of a few cells, kept for the cells that touch. It is a count, not a size, and it is the count the real
    // pairs it was read on bear out (rings of points held 0 to 3 touching cells, a ground given another texture 10 and 20); cells
    // are 4 pixels whatever the picture's size, so a smaller picture of the same scene holds fewer of them.
    if (touching <= rule.apartCells) {
      const reach = rule.grow + rule.feather;
      const usual = ringsElsewhere(totals(cw, ch, (cx, cy) => far[cy * cw + cx]), cw, ch, home, sx1 - sx0 + 1 + 2 * reach, sy1 - sy0 + 1 + 2 * reach, rule.feather);
      if (usual) {
        measure.rings = usual;
        // As shares of each ring's own cells: a ring cut by the picture's edge has fewer.
        clean = apart * usual.cells <= usual.apart * ring.length;
      }
    }
  }
  // "join" where the rule's own numbers made this the place. Where only the reading against the pair did, "removal" with no join
  // to speak of, exactly as the slot was answered before that reading; the ring's mean is kept beside what was measured.
  if (!clean && !place.sure) measure.join = join;
  if (!clean) return place.sure ? none("join", { join, removed }) : none("removal", { removed });

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
  return { picture: first, facts: { made: true, share: places(taken / (cw * ch), 4), join, ...kept(removed), box } };
}
