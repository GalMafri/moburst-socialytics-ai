// supabase/functions/_shared/design/firstPictureStrokes.ts
//
// The first picture as the base, where no rectangle can be laid (18 Nov
// 2026, night). The rule in firstPicture.ts keeps the first picture and
// takes one rectangle around the logo from the cleaned picture. It refuses
// when the model drew its logo away from the brand's place or larger than
// it ("removal"), and when the ground around the logo is one a rectangle of
// another texture would show on, as gravel or a field of stars ("join").
// The whole cleaned picture was then delivered, soft all over, or the
// design was made again.
//
// This file is one more step, tried only for those two answers. It reads
// from the pair of pictures which pixels the cleaning took out, and takes
// from the cleaned picture a patch shaped like those strokes and nothing
// else:
//
//   taken out      a pixel of the first picture whose value the cleaned
//                  picture does not hold anywhere near it, where the
//                  cleaned picture is also the plainer of the two. A thing
//                  the redraw only moved or re-textured is still there in
//                  the cleaned picture, a few pixels off, and is none of
//                  these;
//   the logo       the one place where such pixels lie together: far more
//                  of them than anywhere else on the picture, close set,
//                  and small against the picture. Stray details the redraw
//                  dropped somewhere else are left alone: the first picture
//                  keeps them;
//   the patch      those pixels, widened by as far as the drawing's soft
//                  edge runs on this pair, and faded out over a few pixels
//                  more;
//   the pixels     the cleaned picture's, brought to the first picture's
//                  color around the place and to the strength of its
//                  texture there: the image model quiets the ground around
//                  a logo it draws, and re-renders the grain of all of it;
//   the checks     the two pictures are a pair; a drawing the search found
//                  is where the search found it; the cleaned picture did
//                  not come back moved; the ground is plain or finely
//                  speckled, and the cleaned picture's texture can be
//                  brought to the first picture's; and in the composed
//                  picture nothing the cleaning took out is left in the
//                  patch's rectangle.
//
// Everywhere outside the patch the first picture stays byte for byte. When
// any of this cannot be told safely the step composes nothing, and the
// answer is exactly the one firstPicture.ts gave (`composeFirstOrStrokes`):
// every outcome is that answer or a composed first picture.
//
// Every length is in pixels of the picture and every difference in color
// levels (0 to 255). The numbers were measured on thirteen pairs of live
// pictures of that night, 2176 to 2432 pixels wide. Eight of them the
// rectangle rule had refused: the six on a plain or starry ground
// ("removal") are composed here with the drawing gone and no patch to be
// seen at full size; the two on gravel ("join") are left to the rule's
// answer, because a ground with coarse features of its own is kept out for
// now (`coarseLevel`). The other five the rule composes, and this step is
// never run for them. The lengths are not scaled to the picture: the image
// model makes its pictures at those sizes.
//
// Three of the numbers were set after an independent review drew cases the
// first version got wrong (a part of the logo standing apart and left on
// the picture, letter-shaped ghosts on a coarse ground, an edge out of
// place behind the logo): `dominance`, `coarseLevel` and the `shift` three.
//
// Free of Deno and network imports: the picture service runs it, and the
// tests and the proof script read it.

import type { FirstPictureFacts, Rect, StrokesMeasure } from "../picture/contract.ts";
import { composeFirst } from "./firstPicture.ts";
import type { Raster } from "./logoTone.ts";

/** The numbers of the step. */
export type StrokesRule = {
  /** The side of a coarse cell the two pictures are first held against each other on. A redraw's new grain averages out over a cell of this size; another picture, or the same one moved, does not. */
  agreeCell: number;
  /** A coarse cell is apart when its mean color differs by more than this many levels between the two pictures. */
  agreeLevel: number;
  /** The two pictures are a first picture and its cleaned copy only when at most this share of the coarse cells are apart. */
  agreeShare: number;
  /** How far around a pixel the cleaned picture is looked through for the first picture's value there. A thing the redraw moved by up to this much is still found, and is not taken out. */
  search: number;
  /** A pixel is taken out when, on some channel, it lies more than this many levels outside what the cleaned picture holds within `search` pixels. */
  level: number;
  /** Half the side of the window the two pictures' local contrast is read in (it is read on the pictures at half size, so the window is 33 or 34 pixels). */
  contrastRadius: number;
  /** A pixel is taken out only where the cleaned picture's local contrast is under this share of the first picture's: the cleaning left a plainer place. Where the redraw drew another thing in a thing's place, it did not. */
  contrastShare: number;
  /** Specks: a taken-out pixel counts toward a cluster only when at least `speckShare` of the pixels within `speckRadius` of it are taken out too. */
  speckRadius: number;
  speckShare: number;
  /** Clusters are found on a grid of cells this many pixels a side. */
  grid: number;
  /** Things closer to each other than this share of the picture's shorter side are one cluster: the letters of a wordmark, its icon, its tagline. */
  clusterDist: number;
  /** The largest cluster is a logo only when it holds at least this share of the picture's pixels. Less is a stray detail. */
  minArea: number;
  /** And only when it holds at least this many times the pixels of the next largest cluster: one drawing was taken out, not two. */
  dominance: number;
  /** And only when its taken-out pixels are at least this share of the rectangle around them. A wordmark fills 0.2 to 0.45 of its rectangle; points scattered over a region fill far less. */
  minFill: number;
  /** And only when that rectangle is at most this share of the picture. */
  maxBox: number;
  /** The patch, with its widening and its fade, is at most this share of the picture. */
  maxMask: number;
  /** Holes are filled: the cluster's pixels spread, for up to `fillSteps` pixels, through pixels beside them that lie outside what the cleaned picture holds within `fillSearch` pixels. The flat inside of a thick stroke has no contrast of its own and is reached this way. */
  fillSearch: number;
  fillSteps: number;
  /** The patch is the taken-out pixels widened by `dilateMin` to `dilateMax` pixels, measured on the pair (`haloReach`). */
  dilateMin: number;
  dilateMax: number;
  /** The widening is measured against how much the two pictures differ this far from the taken-out pixels, where nothing of the drawing is left: from the first to the second of these distances. */
  haloFar: [number, number];
  /** The drawing's soft edge has ended where the difference is back to at most `haloTimes` times that, plus `haloLevels` levels, and its lightness within `haloLight` levels of it. */
  haloTimes: number;
  haloLevels: number;
  haloLight: number;
  /** Past the widening the patch fades out over this many pixels. */
  feather: number;
  /** The windows, as half sides, in which the first picture's color against the cleaned picture's is read around the patch. The smallest that holds enough of the surroundings decides at each pixel. */
  colorRadii: number[];
  /** Texture is read in bands of detail: what is finer than each of these many pixels, finest first. */
  textureBands: number[];
  /** The windows, as half sides, in which a band's strength is read around the patch in both pictures, widest first. */
  textureWindows: number[];
  /** A band of the cleaned pixels is scaled by the first picture's strength over the cleaned picture's, kept within these two. */
  gainMin: number;
  gainMax: number;
  /**
   * What is laid in the patch has to hold, in each band, at least this share of the detail the first picture holds just around
   * the patch, and the first picture at least this share of what is laid: of their energies (the squares of their strengths).
   * Scaling within `gainMin` and `gainMax` cannot always get there. A cleaned picture that came back far smoother than the
   * first, or far rougher, would show as strokes of another texture, and nothing is composed.
   */
  detailShare: number;
  /** A band's strength under this many levels is nothing a person sees: it is not held against the other. */
  detailLevel: number;
  /**
   * A deliberate limit: nothing is composed where the first picture's coarsest band beside the patch holds this many levels or
   * more. Such a ground has features of its own (blotches, pebbles, the dots of a halftone), and the cleaned picture's features
   * under the strokes are other ones, of the same strength and still not the ones around them: a reading of strength cannot
   * tell, and the strokes show as a ghost. The step is kept to grounds that are plain or finely speckled.
   */
  coarseLevel: number;
  /**
   * A cleaned picture that came back moved: on the band beside the patch the two pictures are laid over each other at every
   * offset up to `shiftSearch` pixels each way, and what they then differ by is read (its spread, so a color cast does not
   * count). The picture was moved when the best offset of `shiftFrom` pixels or more leaves under `shiftShare` of what the
   * best offset under `shiftFrom` leaves. A plain ground differs the same at every offset, tells nothing, and passes.
   */
  shiftSearch: number;
  shiftFrom: number;
  shiftShare: number;
  /** A window says nothing when under `windowThin` of it lies outside the patch, and is taken whole from `windowFull` of it on. */
  windowThin: number;
  windowFull: number;
  /** The check of the composed picture: at most `leftPixels` of its pixels in the patch's rectangle, or `leftShare` of the cluster's pixels if that is more, still lie outside what the cleaned picture holds near them. */
  leftPixels: number;
  leftShare: number;
  /** A drawing the search found: the cluster's rectangle and the found rectangle share at least this part of the smaller of the two. */
  foundOverlap: number;
};

/**
 * Each number, and what it was read from: the thirteen live pairs, read by
 * this step alone whether or not it runs for them, unless said otherwise.
 *
 * `agreeCell`, `agreeLevel`, `agreeShare`: the pairs hold 0.7% to 2.1% of
 * their 16-pixel cells more than 24 levels apart, and two different
 * pictures 42% to 63%. The line is one tenth. It also refuses a cleaned
 * picture that is the picture moved, where the picture has enough in it:
 * moved by 6 pixels across and 5 down, eight of nine pairs read 10% to 24%
 * (the ninth, a plain ground, 6%); moved by 6 one way only, nine of
 * eighteen read over one tenth. It is no measure of a small shift on a
 * plain ground, where a shift moves nothing a person sees either.
 *
 * `search`, `level`: with 8 pixels and 25 levels the drawing's pixels are
 * taken out on every pair and almost nothing else is: with the drawing
 * already gone, the largest cluster left is 0 to 136 pixels on twelve pairs
 * and 1,275 on one (pebbles the redraw dropped), where a drawing holds
 * 15,000 to 26,000. Read with 4 or 16 pixels, or 12 or 40 levels, every
 * pair still composes and the cluster's rectangle moves by 22 pixels at
 * most.
 *
 * `contrastRadius`, `contrastShare`: 0.6 in a window of 33 pixels. Read at
 * 0.4 or 0.8 the clusters are the same to 8 pixels. Without it, on gravel,
 * pebbles the redraw drew in another shape join the drawing's cluster: its
 * rectangle grows by 125 pixels.
 *
 * `speckRadius`, `speckShare`: 30% of the 25 pixels around, which is 8.
 *
 * `clusterDist`: 2% of the shorter side, 44 to 49 pixels on those pictures.
 * At 1% or 4% the clusters are the same; at 8% a detail the redraw dropped
 * joins the drawing's cluster on two pairs.
 *
 * `minArea`, `minFill`, `maxBox`, `maxMask`: the drawings hold 0.26% to
 * 0.43% of the picture where 0.05% is asked, 0.20 to 0.44 of their
 * rectangles where 0.04 is asked, in rectangles of 0.6% to 2.0% of the
 * picture where 20% is the most, with patches of 0.9% to 1.7% where 5% is
 * the most.
 *
 * `dominance`: 12, the lowest the drawing's cluster holds against the next
 * on any real pair (12.0, on gravel, where the next is pebbles the redraw
 * dropped). On the six pairs this step composes it is 179 or more, and one
 * of them has no second cluster at all. It was 4 at first, and that let a
 * part of the drawn logo be left on the picture: a tagline standing 70
 * pixels under a wordmark is a cluster of its own, a tenth of the
 * wordmark's size (10.2), and the wordmark was taken off with the tagline
 * left at full strength; a small drawn logo beside a label the cleaning
 * also wiped, 7.5 times its size, stayed while the label was patched (two
 * drawn cases of the review). Both are refused at 12. A second copy of the
 * drawing pasted elsewhere reads 1.0 and 1.6. A thing under a twelfth of
 * the drawing is still left as the first picture has it, whatever it is.
 *
 * `fillSearch`, `fillSteps`: 2 pixels and 24 steps, which add 0.2% to 37%
 * to a cluster's pixels (most on gravel, where the drawing's edge runs into
 * the ground). The flat middle of a drawn block 106 pixels thick is
 * reached, with the widening; that of one 140 thick is not, the check of
 * the composed picture finds it, and nothing is composed (the tests).
 *
 * `dilateMin`, `dilateMax`, `haloFar`, `haloTimes`, `haloLevels`,
 * `haloLight`: the widening measured 4 to 15 pixels on the pairs. `feather`
 * is 6.
 *
 * `colorRadii`: 16 to 128 pixels. The cleaned pictures stand 1 to 9 levels
 * off the first around the drawings.
 *
 * `textureBands`, `textureWindows`, `gainMin`, `gainMax`: bands of 2 and 8
 * pixels, read in windows of 20 to 128. The gains measured 0.35 to 1.0: on
 * nearly every pair the cleaned picture is the rougher of the two just
 * around the drawing.
 *
 * `detailShare`, `detailLevel`: one half and one level, the rectangle
 * rule's own line for a patch nothing is stamped over (firstPicture.ts,
 * `detailShare`, where it is measured: a cleaned picture that kept under
 * 0.71 of the first picture's differences showed as a smooth patch). Here
 * it is held against what can be laid after the gains, on both sides. On
 * the six pairs this step composes, the first picture's detail beside the
 * patch is 0.59 to 1.24 of the cleaned picture's, and both are under one
 * level. Drawn grain of 10 levels against 6 composes and against 5 does
 * not; of 3 levels against 12 composes and against 20 does not (the
 * tests).
 *
 * `coarseLevel`: 2 levels in the coarse band, the limit the review set. The
 * six pairs this step composes hold 0.19 to 0.56 there, and the four the
 * rectangle rule composes on a field of stars 0.94 to 1.06; the two gravel
 * pairs hold 7.9, a drawn ground of 16-pixel blotches 4.7 to 4.9, a drawn
 * halftone 4.6. On the blotches, with the cleaned picture's blotches
 * arranged anew around the logo, the strengths read 4.69 against 5.19 and
 * passed, 36 pixels were left and passed, and the letters showed as a
 * ghost. The gravel pairs were composed with no patch to be seen before
 * this limit; they are given up with it until a reading tells a ground
 * re-rendered alike from one arranged anew.
 *
 * `shiftSearch`, `shiftFrom`, `shiftShare`: 8 pixels each way (as far as
 * `search` looks), 2 pixels, one half. A drawn horizon behind a wordmark
 * with the cleaned picture 6 pixels lower, which the pair check passes on
 * its plain ground, reads 0.09 at the true offset; drawn blotches moved 6
 * pixels read 0.01. Unmoved, twelve of the thirteen pairs read 1 (no
 * offset better than none) and one 0.97. It tells only where the band holds something
 * both pictures show: the real pairs moved by hand by 2 to 6 pixels read
 * 0.51 to 1, and one 0.28, because their grounds are stars and grain the
 * redraw rendered again, with little the two pictures share; there the
 * offset is no more than a guess, and nothing a person sees is out of
 * place. A thing wholly under the patch, with no part of it on the band,
 * is not read by this at all.
 *
 * `windowThin`, `windowFull`: 2% and 25% of a window.
 *
 * `leftPixels`, `leftShare`: 20 pixels, or 0.2% of the cluster. The pairs
 * leave 0 to 7.
 *
 * `foundOverlap`: one half. On the two pairs with a found drawing the two
 * rectangles share 0.91 and 0.98 of the smaller.
 */
export const STROKES_RULE: StrokesRule = {
  agreeCell: 16, agreeLevel: 24, agreeShare: 0.1,
  search: 8, level: 25, contrastRadius: 16, contrastShare: 0.6,
  speckRadius: 2, speckShare: 0.3,
  grid: 4, clusterDist: 0.02, minArea: 0.0005, dominance: 12, minFill: 0.04, maxBox: 0.2, maxMask: 0.05,
  fillSearch: 2, fillSteps: 24,
  dilateMin: 4, dilateMax: 16, haloFar: [24, 32], haloTimes: 1.35, haloLevels: 1, haloLight: 2,
  feather: 6,
  colorRadii: [16, 32, 64, 128],
  textureBands: [2, 8], textureWindows: [128, 48, 20], gainMin: 0.25, gainMax: 1.25,
  detailShare: 0.5, detailLevel: 1, coarseLevel: 2,
  shiftSearch: 8, shiftFrom: 2, shiftShare: 0.5,
  windowThin: 0.02, windowFull: 0.25,
  leftPixels: 20, leftShare: 0.002,
  foundOverlap: 0.5,
};

/**
 * Why the step composed nothing: the two pictures are not a pair ("pair"),
 * nothing as large as a logo was taken out ("none"), the largest cluster is
 * not far larger than the next ("second"), or not close set ("loose"), or
 * too large, as is its patch ("large"), the search found the drawing
 * somewhere else ("place"), the cleaned picture came back moved
 * ("shifted"), its texture cannot be brought to the first picture's or the
 * ground is a coarse one ("texture"), or the composed picture still held
 * taken-out pixels ("left").
 */
export type StrokesWhy = "pair" | "none" | "second" | "loose" | "large" | "place" | "shifted" | "texture" | "left";

/** What the step read on a pair, as far as it got. */
export type StrokesRead = Partial<Omit<StrokesMeasure, "instead">> & { why?: StrokesWhy };

/** What the step came to: `picture` is `first`, changed in place inside `box`, or null with `first` untouched. `share` is the patch's part of the picture. */
export type Strokes = { picture: Raster | null; box?: Rect; share: number; read: StrokesRead };

type Plane = Float32Array;
type Bytes = Uint8Array | Uint8ClampedArray;

const LUMA = [0.299, 0.587, 0.114];
const places = (n: number, k: number) => Math.round(n * 10 ** k) / 10 ** k;
const within = (v: number, low: number, high: number) => (v < low ? low : v > high ? high : v);

/** Means over a square window, for planes of one size (`meansOver`): once, or twice over. `into` is where the answer is written when the caller has a plane to spare; it may be `src` itself. */
type Means = { once(src: Plane, r: number, into?: Plane): Plane; twice(src: Plane, r: number, into?: Plane): Plane };

/**
 * `once(plane, r)` is, at each pixel, the mean of the pixels within `r` of
 * it across and down; `twice` is that mean taken of itself again, which
 * weighs the middle of the window most. Past the picture's edge the edge
 * pixel is read again. Running sums, so a wide window costs what a narrow
 * one does.
 */
function meansOver(w: number, h: number): Means {
  const rows = new Float64Array(w * h), sums = new Float64Array(w), between = new Float32Array(w * h);
  const once = (src: Plane, r: number, into?: Plane): Plane => {
    const out = into ?? new Float32Array(w * h);
    if (r <= 0) { if (out !== src) out.set(src); return out; }
    const side = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = (r + 1) * src[o];
      for (let i = 1; i <= r; i++) s += src[o + (i < w ? i : w - 1)];
      // Three stretches of the row: the window cut at the left edge, whole, and cut at the right edge.
      const whole = Math.min(r, w), cutAt = Math.max(whole, w - r - 1), first = src[o], last = src[o + w - 1];
      let x = 0;
      for (; x < whole; x++) { rows[o + x] = s; const add = x + r + 1; s += (add < w ? src[o + add] : last) - first; }
      for (; x < cutAt; x++) { rows[o + x] = s; s += src[o + x + r + 1] - src[o + x - r]; }
      for (; x < w; x++) { rows[o + x] = s; s += last - src[o + (x - r > 0 ? x - r : 0)]; }
    }
    for (let x = 0; x < w; x++) sums[x] = (r + 1) * rows[x];
    for (let i = 1; i <= r; i++) {
      const o = (i < h ? i : h - 1) * w;
      for (let x = 0; x < w; x++) sums[x] += rows[o + x];
    }
    const part = 1 / (side * side);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) out[o + x] = sums[x] * part;
      const add = (y + r + 1 < h ? y + r + 1 : h - 1) * w, sub = (y - r > 0 ? y - r : 0) * w;
      for (let x = 0; x < w; x++) sums[x] += rows[add + x] - rows[sub + x];
    }
    return out;
  };
  return { once, twice: (src, r, into) => once(once(src, r, between), r, into) };
}

/**
 * `outsideOf`, the quick way, or null when it would not be quick. `b`'s
 * range is first read on small cells, and around each cell on the three by
 * three cells about it, which lie wholly within `s` pixels of every pixel
 * of the middle cell. A pixel of `a` within `level` of that range is within
 * it of the wider window's too, and is settled. Only the few pixels that
 * are not have their own window looked through, until a value is met that
 * holds them. On a pair that differs all over those pixels are many: past
 * one in fifty of the picture this gives up, and the whole reading is done
 * the other way. The number decides how the answer is read, never what it
 * is.
 */
export function outsideQuick(a: Bytes, b: Bytes, w: number, h: number, s: number, level: number): Uint8Array | null {
  // A window of one pixel has no cells about it that lie within it.
  if (s < 1) return null;
  // The largest cell of which three in a row lie within `s` pixels of every pixel of the middle one: twice its side, less one, is at most `s`.
  const cell = (s + 1) >> 1, cw = Math.ceil(w / cell), ch = Math.ceil(h / cell);
  const hi = new Uint8Array(cw * ch * 3), lo = new Uint8Array(cw * ch * 3).fill(255);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / cell) * cw * 3;
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) {
      const q = row + Math.floor(x / cell) * 3;
      for (let c = 0; c < 3; c++) { const v = b[p + c]; if (v > hi[q + c]) hi[q + c] = v; if (v < lo[q + c]) lo[q + c] = v; }
    }
  }
  // The range over three cells across, then over three of those down.
  const acrossHi = new Uint8Array(hi.length), acrossLo = new Uint8Array(lo.length), nearHi = new Uint8Array(hi.length), nearLo = new Uint8Array(lo.length);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) for (let c = 0; c < 3; c++) {
    const q = (cy * cw + cx) * 3 + c, l = cx > 0 ? q - 3 : q, r = cx < cw - 1 ? q + 3 : q;
    acrossHi[q] = Math.max(hi[l], hi[q], hi[r]); acrossLo[q] = Math.min(lo[l], lo[q], lo[r]);
  }
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) for (let c = 0; c < 3; c++) {
    const q = (cy * cw + cx) * 3 + c, u = cy > 0 ? q - cw * 3 : q, d = cy < ch - 1 ? q + cw * 3 : q;
    nearHi[q] = Math.max(acrossHi[u], acrossHi[q], acrossHi[d]); nearLo[q] = Math.min(acrossLo[u], acrossLo[q], acrossLo[d]);
  }
  const out = new Uint8Array(w * h), most = (w * h) / 50;
  let looked = 0;
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / cell) * cw * 3, y0 = Math.max(0, y - s), y1 = Math.min(h - 1, y + s);
    for (let x = 0; x < w; x++) {
      const q = row + Math.floor(x / cell) * 3, p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = a[p + c], above = v - nearHi[q + c] > level;
        if (!above && !(nearLo[q + c] - v > level)) continue;
        // Above, or below, everything close by: outside the window's range unless some value in the window comes within `level` of it on that side.
        if (++looked > most) return null;
        const x0 = Math.max(0, x - s), x1 = Math.min(w - 1, x + s);
        let held = false;
        for (let yy = y0; yy <= y1 && !held; yy++) {
          const end = (yy * w + x1) * 4 + c;
          if (above) { for (let i = (yy * w + x0) * 4 + c; i <= end; i += 4) if (v - b[i] <= level) { held = true; break; } }
          else for (let i = (yy * w + x0) * 4 + c; i <= end; i += 4) if (b[i] - v <= level) { held = true; break; }
        }
        if (!held) { out[y * w + x] = 1; break; }
      }
    }
  }
  return out;
}

/**
 * Where picture `a` lies outside what picture `b` holds nearby: 1 at a
 * pixel where, on some channel, `a` is more than `level` levels above the
 * highest or below the lowest value `b` has within `s` pixels of it, across
 * and down (the square is cut at the picture's edge). Both are RGBA, `w` by
 * `h`.
 *
 * It is read one of two ways, with the same answer at every pixel. The
 * quick way (`outsideQuick`) serves a pair of pictures that agree nearly
 * everywhere, which a first picture and its cleaned copy do. When they do
 * not, or with `whole`, the highest and lowest value in every window are
 * read in a fixed number of steps a pixel, whatever the window: along each
 * row, then down each column, as running highs and lows from both ends of
 * blocks one window long.
 */
export function outsideOf(a: Bytes, b: Bytes, w: number, h: number, s: number, level: number, whole = false): Uint8Array {
  const quick = whole ? null : outsideQuick(a, b, w, h, s, level);
  if (quick) return quick;
  const n = w * h, block = 2 * s + 1;
  const out = new Uint8Array(n);
  // The range across each row's window, then its running highs and lows down the columns, from the top of each block and from its bottom.
  const hi = new Uint8Array(n), lo = new Uint8Array(n);
  const downHi = new Uint8Array(n), upHi = new Uint8Array(n), downLo = new Uint8Array(n), upLo = new Uint8Array(n);
  const rightHi = new Uint8Array(w), leftHi = new Uint8Array(w), rightLo = new Uint8Array(w), leftLo = new Uint8Array(w);
  const lastAcross = Math.floor((w - 1) / block), lastDown = Math.floor((h - 1) / block);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      const o = y * w, p = o * 4 + c;
      for (let x = 0, k = 0; x < w; x++, k = k === block - 1 ? 0 : k + 1) {
        const v = b[p + x * 4];
        if (k === 0) { rightHi[x] = v; rightLo[x] = v; }
        else { rightHi[x] = v > rightHi[x - 1] ? v : rightHi[x - 1]; rightLo[x] = v < rightLo[x - 1] ? v : rightLo[x - 1]; }
      }
      for (let x = w - 1; x >= 0; x--) {
        const v = b[p + x * 4];
        if (x === w - 1 || x % block === block - 1) { leftHi[x] = v; leftLo[x] = v; }
        else { leftHi[x] = v > leftHi[x + 1] ? v : leftHi[x + 1]; leftLo[x] = v < leftLo[x + 1] ? v : leftLo[x + 1]; }
      }
      for (let x = 0; x < w; x++) {
        const from = x - s, to = x + s;
        let top: number, low: number;
        if (from < 0) {
          // Cut at the left edge: the window starts with the first block, and the running values from its start are the window's.
          const t = to < w ? to : w - 1;
          top = rightHi[t]; low = rightLo[t];
        } else if (to >= w) {
          // Cut at the right edge: from `from` to the end of its block, and the last block when that is another.
          top = leftHi[from]; low = leftLo[from];
          if (Math.floor(from / block) !== lastAcross) {
            if (rightHi[w - 1] > top) top = rightHi[w - 1];
            if (rightLo[w - 1] < low) low = rightLo[w - 1];
          }
        } else {
          top = leftHi[from] > rightHi[to] ? leftHi[from] : rightHi[to];
          low = leftLo[from] < rightLo[to] ? leftLo[from] : rightLo[to];
        }
        hi[o + x] = top; lo[o + x] = low;
      }
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      if (y % block === 0) { downHi.set(hi.subarray(o, o + w), o); downLo.set(lo.subarray(o, o + w), o); continue; }
      for (let x = 0; x < w; x++) {
        const q = o + x, top = hi[q], low = lo[q], pt = downHi[q - w], pl = downLo[q - w];
        downHi[q] = top > pt ? top : pt; downLo[q] = low < pl ? low : pl;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      const o = y * w;
      if (y === h - 1 || y % block === block - 1) { upHi.set(hi.subarray(o, o + w), o); upLo.set(lo.subarray(o, o + w), o); continue; }
      for (let x = 0; x < w; x++) {
        const q = o + x, top = hi[q], low = lo[q], pt = upHi[q + w], pl = upLo[q + w];
        upHi[q] = top > pt ? top : pt; upLo[q] = low < pl ? low : pl;
      }
    }
    for (let y = 0; y < h; y++) {
      const from = y - s, to = y + s, o = y * w;
      // The two rows of running values that together are the window, as for a row above: the same row twice where one is enough.
      let hi1 = upHi, lo1 = upLo, at1 = from * w, hi2 = downHi, lo2 = downLo, at2 = to * w;
      if (from < 0) { hi1 = downHi; lo1 = downLo; at1 = at2 = (to < h ? to : h - 1) * w; }
      else if (to >= h) {
        if (Math.floor(from / block) !== lastDown) at2 = (h - 1) * w;
        else { hi2 = upHi; lo2 = upLo; at2 = at1; }
      }
      for (let x = 0; x < w; x++) {
        const v = a[(o + x) * 4 + c];
        const t1 = hi1[at1 + x], t2 = hi2[at2 + x], l1 = lo1[at1 + x], l2 = lo2[at2 + x];
        if (v - (t1 > t2 ? t1 : t2) > level || (l1 < l2 ? l1 : l2) - v > level) out[o + x] = 1;
      }
    }
  }
  return out;
}

/**
 * How many steps of widening reach each pixel from the pixels set in
 * `from`: 0 on them, 255 past `most` steps. A step takes the four pixels
 * beside every pixel reached; with `round`, every second step takes all
 * eight, which widens about evenly in every direction (an octagon).
 */
function stepsFrom(from: Uint8Array, w: number, h: number, most: number, round: boolean): Uint8Array {
  const steps = new Uint8Array(w * h).fill(255);
  let edge: number[] = [];
  for (let p = 0; p < from.length; p++) if (from[p]) { steps[p] = 0; edge.push(p); }
  for (let k = 1; k <= most && edge.length; k++) {
    const eight = round && k % 2 === 0, next: number[] = [];
    const take = (p: number) => { if (steps[p] === 255) { steps[p] = k; next.push(p); } };
    for (const p of edge) {
      const x = p % w, y = (p - x) / w;
      const left = x > 0, right = x < w - 1, up = y > 0, down = y < h - 1;
      if (left) take(p - 1);
      if (right) take(p + 1);
      if (up) take(p - w);
      if (down) take(p + w);
      if (!eight) continue;
      if (up && left) take(p - w - 1);
      if (up && right) take(p - w + 1);
      if (down && left) take(p + w - 1);
      if (down && right) take(p + w + 1);
    }
    edge = next;
  }
  return steps;
}

/**
 * A picture's local contrast at half size: over each pixel pair's 2 by 2
 * mean, the spread of the values within `r` half-size pixels, the three
 * channels' together (the root of their summed variances). An odd last row
 * or column has none and reads 0.
 */
function contrastOf(data: Bytes, W: number, hw: number, hh: number, r: number, means: Means): Plane {
  const n = hw * hh, spread = new Float32Array(n), value = new Float32Array(n), square = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const p = (2 * y * W + 2 * x) * 4 + c;
        const v = (data[p] + data[p + 4] + data[p + W * 4] + data[p + W * 4 + 4]) / 4;
        value[y * hw + x] = v; square[y * hw + x] = v * v;
      }
    }
    means.once(value, r, value); means.once(square, r, square);
    for (let i = 0; i < n; i++) { const v = square[i] - value[i] * value[i]; if (v > 0) spread[i] += v; }
  }
  for (let i = 0; i < n; i++) spread[i] = Math.sqrt(spread[i]);
  return spread;
}

/** A rectangle of a picture as RGBA bytes of its own. */
function cut(data: Bytes, W: number, x0: number, y0: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return out;
}

/** A rectangle of a plane: `x0` and `y0` included, `x1` and `y1` not. */
type Part = { x0: number; y0: number; x1: number; y1: number };

/**
 * What the first picture has more than the cleaned one, in color, around a
 * place: read only where `weight` is 1 (outside the drawing and its soft
 * edge), as a mean in windows of each of `colorRadii`, widest first. At
 * each pixel the narrowest window that holds enough of the surroundings
 * decides; where even the widest holds almost none, the mean over all of
 * them does. `a` and `b` are the two pictures' three channels. It is
 * answered inside `part`, which is all the caller reads, and is 0 outside.
 */
function colorApart(a: Plane[], b: Plane[], weight: Plane, w: number, h: number, means: Means, rule: StrokesRule, part: Part): Plane[] {
  const n = w * h, most = Math.max(1, (Math.min(w, h) - 1) >> 1);
  let total = 0;
  for (let i = 0; i < n; i++) total += weight[i];
  const all = [0, 0, 0];
  const apart = [0, 1, 2].map((c) => {
    const d = new Float32Array(n), first = a[c], cleaned = b[c];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] = (first[i] - cleaned[i]) * weight[i];
    all[c] = sum / Math.max(total, 1);
    return d;
  });
  const off = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], held = new Float32Array(n), sum = new Float32Array(n);
  const radii = [...rule.colorRadii].sort((x, y) => y - x);
  for (const [k, radius] of radii.entries()) {
    const r = Math.min(radius, most);
    means.twice(weight, r, held);
    for (let c = 0; c < 3; c++) {
      means.twice(apart[c], r, sum);
      const out = off[c], whole = all[c];
      for (let y = part.y0; y < part.y1; y++) {
        for (let i = y * w + part.x0, end = y * w + part.x1; i < end; i++) {
          const here = sum[i] / Math.max(held[i], 1e-4);
          if (k === 0) { const t = within(held[i] / rule.windowThin, 0, 1); out[i] = here * t + whole * (1 - t); }
          else { const t = within(held[i] / rule.windowFull, 0, 1); out[i] = here * t + out[i] * (1 - t); }
        }
      }
    }
  }
  return off;
}

/** A plane as its bands of detail, finest first, and what is left under them: each band is what a mean over that many pixels, taken twice, takes away. */
function bandsOf(plane: Plane, radii: number[], means: Means): { bands: Plane[]; rest: Plane } {
  const bands: Plane[] = [];
  let now = plane;
  for (const r of radii) {
    const smooth = means.twice(now, r), band = new Float32Array(now.length);
    for (let i = 0; i < band.length; i++) band[i] = now[i] - smooth[i];
    bands.push(band);
    now = smooth;
  }
  return { bands, rest: now };
}

const lightOf = (p: Plane[]): Plane => {
  const out = new Float32Array(p[0].length);
  for (let i = 0; i < out.length; i++) out[i] = LUMA[0] * p[0][i] + LUMA[1] * p[1][i] + LUMA[2] * p[2][i];
  return out;
};

/**
 * The cleaned pixels with each band of detail brought to the first
 * picture's strength in that band. The strengths are read on lightness,
 * only where `weight` is 1 (outside the patch), in windows as near the
 * patch as hold enough of the surroundings (`textureWindows`, widest
 * first), and their ratio is kept within `gainMin` and `gainMax`. Answers
 * the three channels and, for each band, the gain at every pixel, inside
 * `part`, which is all the caller reads. `kept` is each band's strength in
 * the two pictures just around the patch, on the pixels set in `ring`: the
 * middle size of the band there, in levels.
 */
function textureMatched(a: Plane[], b: Plane[], weight: Plane, ring: Uint8Array, w: number, h: number, means: Means, rule: StrokesRule, part: Part): { planes: Plane[]; gains: Plane[]; kept: Array<{ first: number; cleaned: number }> } {
  const n = w * h, most = Math.max(1, (Math.min(w, h) - 1) >> 1);
  // Each band's strength at every pixel that counts, in both pictures: its square, on lightness.
  const strength = (planes: Plane[]) => bandsOf(lightOf(planes), rule.textureBands, means).bands.map((band) => {
    for (let i = 0; i < n; i++) band[i] = band[i] * band[i] * weight[i];
    return band;
  });
  const first = strength(a), cleaned = strength(b);
  // The middle size of a band on the ring's pixels, to a sixteenth of a level: a few points of light on the ring do not decide it, as they would a mean.
  const middleOn = (squares: Plane): number => {
    const sizes = new Uint32Array(1024);
    let count = 0;
    for (let i = 0; i < n; i++) if (ring[i]) { sizes[Math.min(1023, Math.floor(Math.sqrt(squares[i]) * 16))]++; count++; }
    for (let k = 0, seen = 0; k < 1024; k++) { seen += sizes[k]; if (2 * seen >= count) return k / 16; }
    return 0;
  };
  const kept = first.map((plane, band) => ({ first: middleOn(plane), cleaned: middleOn(cleaned[band]) }));
  const split = b.map((plane) => bandsOf(plane, rule.textureBands, means));
  const planes = split.map((s) => s.rest);
  const gains = rule.textureBands.map(() => new Float32Array(n));
  const held = new Float32Array(n), ea = new Float32Array(n), eb = new Float32Array(n);
  for (const [k, window] of rule.textureWindows.entries()) {
    const r = Math.min(window, most);
    means.twice(weight, r, held);
    for (let band = 0; band < gains.length; band++) {
      means.twice(first[band], r, ea);
      means.twice(cleaned[band], r, eb);
      const gain = gains[band];
      for (let y = part.y0; y < part.y1; y++) {
        for (let i = y * w + part.x0, end = y * w + part.x1; i < end; i++) {
          const in1 = Math.max(held[i], 0), g = Math.sqrt((Math.max(ea[i], 0) + 1e-3 * in1 + 1e-9) / (Math.max(eb[i], 0) + 1e-3 * in1 + 1e-9));
          if (k === 0) gain[i] = in1 > rule.windowThin ? g : 1;
          else { const t = within(in1 / rule.windowFull, 0, 1); gain[i] = g * t + gain[i] * (1 - t); }
        }
      }
    }
  }
  for (let band = 0; band < gains.length; band++) {
    const gain = gains[band];
    for (let y = part.y0; y < part.y1; y++) {
      for (let i = y * w + part.x0, end = y * w + part.x1; i < end; i++) {
        const g = (gain[i] = within(gain[i], rule.gainMin, rule.gainMax));
        for (let c = 0; c < 3; c++) planes[c][i] += g * split[c].bands[band][i];
      }
    }
  }
  return { planes, gains, kept };
}

/**
 * Whether the cleaned picture came back moved against the first, read on
 * the pixels set in `ring` (the band beside the patch, where both show the
 * same ground). At every offset up to `shiftSearch` pixels across and down,
 * the first picture's lightness is held against the cleaned picture's that
 * many pixels away, and the spread of the difference over the band is what
 * that offset leaves. Answers the best offset of `shiftFrom` pixels or
 * more, and what it leaves as a share of what the best offset under
 * `shiftFrom` leaves: 1, with no offset, where none is better than that (a
 * plain ground, or a pair that was not moved), and far under 1 where the
 * band holds something both pictures show (an edge, a pattern) and the
 * cleaned picture was moved.
 */
function offsetBeside(a: Plane[], b: Plane[], ring: Uint8Array, w: number, h: number, rule: StrokesRule): { x: number; y: number; share: number } {
  const reach = rule.shiftSearch, first = lightOf(a), cleaned = lightOf(b);
  // Only pixels with the whole search around them on the place worked on, so every offset is read on the same pixels.
  const at: number[] = [];
  for (let y = reach; y < h - reach; y++) for (let x = reach, i = y * w + reach; x < w - reach; x++, i++) if (ring[i]) at.push(i);
  if (!at.length) return { x: 0, y: 0, share: 1 };
  // Nearest offsets first: of two that leave the same (along an edge every offset does), the smaller is the one answered.
  const offsets: Array<[number, number]> = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) offsets.push([dx, dy]);
  offsets.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]));
  let near = Infinity, far = Infinity, x = 0, y = 0;
  for (const [dx, dy] of offsets) {
    const by = dy * w + dx;
    let sum = 0, squares = 0;
    for (let k = 0; k < at.length; k++) { const i = at[k], d = first[i] - cleaned[i + by]; sum += d; squares += d * d; }
    const left = Math.max(0, squares / at.length - (sum / at.length) ** 2);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < rule.shiftFrom) { if (left < near) near = left; }
    else if (left < far) { far = left; x = dx; y = dy; }
  }
  // No offset better than none: nothing is said of one.
  return far < near ? { x, y, share: far / near } : { x: 0, y: 0, share: 1 };
}

/**
 * How far the drawing's soft edge (its smoothing, a glow, a shadow) runs
 * past the taken-out pixels on this pair, in pixels. The two pictures'
 * difference, after the color around the place is taken off, is read on the
 * rings of pixels 1, 2, 3 and more steps from the taken-out pixels; from
 * `haloFar[0]` steps on nothing of the drawing is left, and that is what
 * the difference comes back to. The widening is the first distance, from
 * `dilateMin`, past which the next three rings are back there, in size and
 * in lightness; `dilateMax` when none is.
 */
function haloReach(a: Plane[], b: Plane[], off: Plane[], ring: Uint8Array, rule: StrokesRule): number {
  const last = rule.haloFar[1], size = new Float64Array(last + 1), light = new Float64Array(last + 1), count = new Float64Array(last + 1);
  for (let i = 0; i < ring.length; i++) {
    const k = ring[i];
    if (k === 0 || k > last) continue;
    const d0 = a[0][i] - (b[0][i] + off[0][i]), d1 = a[1][i] - (b[1][i] + off[1][i]), d2 = a[2][i] - (b[2][i] + off[2][i]);
    size[k] += Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
    light[k] += LUMA[0] * d0 + LUMA[1] * d1 + LUMA[2] * d2;
    count[k]++;
  }
  const sizeAt = (k: number) => (count[k] ? size[k] / count[k] : 0), lightAt = (k: number) => (count[k] ? light[k] / count[k] : 0);
  let farSize = 0, farLight = 0;
  for (let k = rule.haloFar[0]; k <= last; k++) { farSize += sizeAt(k); farLight += lightAt(k); }
  farSize /= last - rule.haloFar[0] + 1; farLight /= last - rule.haloFar[0] + 1;
  for (let k = rule.dilateMin; k < rule.dilateMax; k++) {
    const nextSize = (sizeAt(k + 1) + sizeAt(k + 2) + sizeAt(k + 3)) / 3, nextLight = (lightAt(k + 1) + lightAt(k + 2) + lightAt(k + 3)) / 3;
    if (nextSize <= rule.haloTimes * farSize + rule.haloLevels && Math.abs(nextLight - farLight) <= rule.haloLight) return k;
  }
  return rule.dilateMax;
}

/**
 * The first picture with the cleaned picture's pixels on the strokes the
 * cleaning took out, or no picture. `found` is the rectangle the search
 * found the drawing at, null when it found none. When a picture is composed
 * it is `first` itself, changed in place inside `box` and nowhere else;
 * when none is, `first` is not changed, and `read.why` says why.
 */
export function composeStrokes(first: Raster, cleaned: Raster, found: Rect | null, rule: StrokesRule = STROKES_RULE): Strokes {
  const read: StrokesRead = {};
  const none = (why: StrokesWhy): Strokes => ({ picture: null, share: 0, read: { ...read, why } });
  const W = first.width, H = first.height, n = W * H;
  if (W !== cleaned.width || H !== cleaned.height || !n) return none("pair");
  const A = first.data, B = cleaned.data;

  // 1. A pair: the two pictures show the same thing, cell by coarse cell.
  const cell = rule.agreeCell, acrossCells = Math.floor(W / cell), downCells = Math.floor(H / cell);
  let apartCells = 0;
  const sums = new Float64Array(acrossCells * 3), far = rule.agreeLevel * cell * cell;
  for (let cy = 0; cy < downCells; cy++) {
    sums.fill(0);
    for (let y = cy * cell; y < (cy + 1) * cell; y++) {
      for (let cx = 0; cx < acrossCells; cx++) {
        let r = 0, g = 0, b = 0;
        for (let p = (y * W + cx * cell) * 4, end = p + cell * 4; p < end; p += 4) { r += A[p] - B[p]; g += A[p + 1] - B[p + 1]; b += A[p + 2] - B[p + 2]; }
        sums[cx * 3] += r; sums[cx * 3 + 1] += g; sums[cx * 3 + 2] += b;
      }
    }
    for (let cx = 0; cx < acrossCells; cx++) if (Math.max(Math.abs(sums[cx * 3]), Math.abs(sums[cx * 3 + 1]), Math.abs(sums[cx * 3 + 2])) > far) apartCells++;
  }
  const agree = acrossCells * downCells ? apartCells / (acrossCells * downCells) : 0;
  read.agree = places(agree, 4);
  if (agree > rule.agreeShare) return none("pair");

  // 2. Taken out: outside what the cleaned picture holds nearby, where the cleaned picture is the plainer of the two.
  const taken = outsideOf(A, B, W, H, rule.search, rule.level);
  const hw = W >> 1, hh = H >> 1;
  let any = false;
  for (let p = 0; p < n && !any; p++) any = taken[p] === 1;
  if (!any) return none("none");
  {
    const means = meansOver(hw, hh), r = Math.max(1, rule.contrastRadius >> 1);
    const busy = contrastOf(A, W, hw, hh, r, means), plain = contrastOf(B, W, hw, hh, r, means);
    for (let y = 0; y < H; y++) {
      const hy = y >> 1;
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (!taken[p]) continue;
        const hx = x >> 1, q = hy * hw + hx;
        if (hx >= hw || hy >= hh || !(plain[q] < rule.contrastShare * busy[q])) taken[p] = 0;
      }
    }
  }

  // 3. Clusters, on a grid: the taken-out pixels that are no specks, counted in each cell; cells near each other are one cluster.
  const G = rule.grid, gw = Math.floor(W / G), gh = Math.floor(H / G);
  const counts = new Uint8Array(gw * gh), held = new Uint8Array(gw * gh);
  const side = 2 * rule.speckRadius + 1, enough = rule.speckShare * side * side;
  for (let y = 0; y < gh * G; y++) {
    for (let x = 0; x < gw * G; x++) {
      if (!taken[y * W + x]) continue;
      let beside = 0;
      for (let dy = -rule.speckRadius; dy <= rule.speckRadius; dy++) {
        const row = within(y + dy, 0, H - 1) * W;
        for (let dx = -rule.speckRadius; dx <= rule.speckRadius; dx++) beside += taken[row + within(x + dx, 0, W - 1)];
      }
      if (beside >= enough) { const at = Math.floor(y / G) * gw + Math.floor(x / G); counts[at]++; held[at] = 1; }
    }
  }
  const reach = Math.max(1, Math.round((rule.clusterDist * Math.min(W, H)) / 2 / G));
  const near = stepsFrom(held, gw, gh, reach, true);
  const label = new Int32Array(gw * gh);
  type Cluster = { label: number; area: number; x0: number; y0: number; x1: number; y1: number };
  const clusters: Cluster[] = [];
  for (let start = 0; start < label.length; start++) {
    if (near[start] === 255 || label[start]) continue;
    const c: Cluster = { label: clusters.length + 1, area: 0, x0: gw, y0: gh, x1: -1, y1: -1 };
    clusters.push(c);
    label[start] = c.label;
    const stack = [start];
    while (stack.length) {
      const at = stack.pop() as number, x = at % gw, y = (at - x) / gw;
      if (held[at]) { c.area += counts[at]; c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y); }
      for (let yy = Math.max(0, y - 1); yy <= Math.min(gh - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(gw - 1, x + 1); xx++) {
          const to = yy * gw + xx;
          if (near[to] !== 255 && !label[to]) { label[to] = c.label; stack.push(to); }
        }
      }
    }
  }
  if (!clusters.length) return none("none");
  clusters.sort((x, y) => y.area - x.area);
  const logo = clusters[0], second = clusters.length > 1 ? clusters[1].area : 0;
  const boxW = (logo.x1 - logo.x0 + 1) * G, boxH = (logo.y1 - logo.y0 + 1) * G;
  read.area = logo.area; read.second = second; read.fill = places(logo.area / (boxW * boxH), 3);
  read.cluster = { x: logo.x0 * G, y: logo.y0 * G, width: boxW, height: boxH };
  // The logo: as large as one, far larger than anything else taken out, close set, and small against the picture.
  if (logo.area < rule.minArea * n) return none("none");
  if (logo.area < rule.dominance * second) return none("second");
  if (logo.area < rule.minFill * boxW * boxH) return none("loose");
  if (boxW * boxH > rule.maxBox * n) return none("large");

  // 4. The cluster's pixels: every taken-out pixel in its cells, specks too, and the holes between them filled.
  const margin = rule.fillSteps + 8;
  const fx0 = Math.max(0, logo.x0 * G - margin), fy0 = Math.max(0, logo.y0 * G - margin), fx1 = Math.min(W, (logo.x1 + 1) * G + margin), fy1 = Math.min(H, (logo.y1 + 1) * G + margin);
  // The cells of the cluster reach `reach` cells past its outermost taken-out cell.
  const wx0 = Math.min(fx0, Math.max(0, (logo.x0 - reach) * G)), wy0 = Math.min(fy0, Math.max(0, (logo.y0 - reach) * G));
  const wx1 = Math.max(fx1, Math.min(gw, logo.x1 + reach + 1) * G), wy1 = Math.max(fy1, Math.min(gh, logo.y1 + reach + 1) * G);
  const ww = wx1 - wx0, wh = wy1 - wy0;
  const core = new Uint8Array(ww * wh);
  for (let y = wy0; y < Math.min(wy1, gh * G); y++) {
    for (let x = wx0; x < Math.min(wx1, gw * G); x++) {
      if (taken[y * W + x] && label[Math.floor(y / G) * gw + Math.floor(x / G)] === logo.label) core[(y - wy0) * ww + (x - wx0)] = 1;
    }
  }
  {
    const fw = fx1 - fx0, fh = fy1 - fy0;
    const open = outsideOf(cut(A, W, fx0, fy0, fw, fh), cut(B, W, fx0, fy0, fw, fh), fw, fh, rule.fillSearch, rule.level);
    let edge: number[] = [];
    const at = (x: number, y: number) => (y + fy0 - wy0) * ww + (x + fx0 - wx0);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (core[at(x, y)]) edge.push(y * fw + x);
    for (let k = 0; k < rule.fillSteps && edge.length; k++) {
      const next: number[] = [];
      const take = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= fw || y >= fh || !open[y * fw + x] || core[at(x, y)]) return;
        core[at(x, y)] = 1; next.push(y * fw + x);
      };
      for (const p of edge) {
        const x = p % fw, y = (p - x) / fw;
        take(x - 1, y); take(x + 1, y); take(x, y - 1); take(x, y + 1);
      }
      edge = next;
    }
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1, pixels = 0;
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    if (!core[y * ww + x]) continue;
    pixels++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!pixels) return none("none");
  x0 += wx0; x1 += wx0 + 1; y0 += wy0; y1 += wy0 + 1;
  read.cluster = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  read.core = pixels;
  // A drawing the search found is where the search found it.
  if (found) {
    const shared = Math.max(0, Math.min(x1, found.x + found.width) - Math.max(x0, found.x)) * Math.max(0, Math.min(y1, found.y + found.height) - Math.max(y0, found.y));
    if (shared < rule.foundOverlap * Math.min((x1 - x0) * (y1 - y0), found.width * found.height)) return none("place");
  }

  // 5. The place worked on: the cluster with room around it for the widest window.
  const room = rule.dilateMax + 2 * rule.feather + Math.max(...rule.colorRadii) + 8;
  const cx0 = Math.max(0, x0 - room), cy0 = Math.max(0, y0 - room), cx1 = Math.min(W, x1 + room), cy1 = Math.min(H, y1 + room);
  const w = cx1 - cx0, h = cy1 - cy0, m = w * h;
  const means = meansOver(w, h);
  const a: Plane[] = [new Float32Array(m), new Float32Array(m), new Float32Array(m)], b: Plane[] = [new Float32Array(m), new Float32Array(m), new Float32Array(m)];
  const strokes = new Uint8Array(m);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = ((cy0 + y) * W + cx0 + x) * 4;
      for (let c = 0; c < 3; c++) { a[c][i] = A[p + c]; b[c][i] = B[p + c]; }
      const sx = cx0 + x - wx0, sy = cy0 + y - wy0;
      if (sx >= 0 && sy >= 0 && sx < ww && sy < wh && core[sy * ww + sx]) strokes[i] = 1;
    }
  }
  // How far the steps from the cluster are counted: past the patch's own reach by the narrowest window its surroundings are read in.
  const nearest = Math.min(...rule.textureWindows);
  const widest = Math.max(rule.haloFar[0], rule.dilateMax + 2 * rule.feather + 4 + nearest);
  const round = stepsFrom(strokes, w, h, widest, true);
  const weightPast = (steps: number): Plane => {
    const out = new Float32Array(m);
    for (let i = 0; i < m; i++) if (round[i] > steps) out[i] = 1;
    return out;
  };

  // A part of the place: the cluster's own rectangle with `by` pixels around it.
  const about = (by: number): Part => ({ x0: Math.max(0, x0 - cx0 - by), y0: Math.max(0, y0 - cy0 - by), x1: Math.min(w, x1 - cx0 + by), y1: Math.min(h, y1 - cy0 + by) });

  // 6. The widening, measured on this pair: on the rings of pixels up to `haloFar[1]` steps from the cluster.
  const rings = stepsFrom(strokes, w, h, rule.haloFar[1], false);
  const dilate = haloReach(a, b, colorApart(a, b, weightPast(rule.haloFar[0]), w, h, means, rule, about(rule.haloFar[1])), rings, rule);
  read.dilate = dilate;

  // 7. The patch: all of the cleaned pixel within the widening, less across the fade, none beyond.
  const alpha = new Float32Array(m);
  for (let i = 0; i < m; i++) if (round[i] <= dilate + rule.feather) alpha[i] = 1;
  means.once(alpha, rule.feather >> 1, alpha); means.once(alpha, rule.feather - (rule.feather >> 1), alpha);
  let covered = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let i = 0; i < m; i++) {
    alpha[i] = alpha[i] < 1e-3 ? 0 : Math.min(1, alpha[i]);
    if (!alpha[i]) continue;
    covered++;
    const x = i % w, y = (i - x) / w;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  const share = covered / n;
  if (share > rule.maxMask) return none("large");

  // 8. The cleaned pixels, at the first picture's color and its texture's strength around the patch. They are read on the patch's
  // rectangle and as far around it as the check below looks.
  const around = weightPast(dilate + 2 * rule.feather + 4);
  const part: Part = { x0: Math.max(0, bx0 - rule.search), y0: Math.max(0, by0 - rule.search), x1: Math.min(w, bx1 + 1 + rule.search), y1: Math.min(h, by1 + 1 + rule.search) };
  const beside = new Uint8Array(m);
  for (let i = 0; i < m; i++) if (around[i] && round[i] <= dilate + 2 * rule.feather + 4 + nearest) beside[i] = 1;
  // A cleaned picture that came back moved would lay whatever passes behind the drawing (an edge, a line) out of place inside the strokes.
  const moved = offsetBeside(a, b, beside, w, h, rule);
  read.shift = { x: moved.x, y: moved.y, share: places(moved.share, 3) };
  if (moved.share < rule.shiftShare) return none("shifted");
  const off = colorApart(a, b, around, w, h, means, rule, part);
  const matched = textureMatched(a, b, around, beside, w, h, means, rule, part);
  // What can be laid: the cleaned picture's detail scaled as far as the gains go. Each band of it has to come to the first
  // picture's strength beside the patch, near enough, or the patch would show as strokes of another texture.
  read.detail = matched.kept.map((k) => ({ first: places(k.first, 2), cleaned: places(k.cleaned, 2) }));
  // The deliberate limit: a ground with coarse features of its own is left to the rectangle rule's answer.
  if (matched.kept[matched.kept.length - 1].first >= rule.coarseLevel) return none("texture");
  for (const k of matched.kept) {
    const laid = k.cleaned * within(k.cleaned > 0 ? k.first / k.cleaned : rule.gainMax, rule.gainMin, rule.gainMax);
    if (k.first >= rule.detailLevel && laid * laid < rule.detailShare * k.first * k.first) return none("texture");
    if (laid >= rule.detailLevel && k.first * k.first < rule.detailShare * laid * laid) return none("texture");
  }
  read.gains = matched.gains.map((gain) => {
    let sum = 0;
    for (let i = 0; i < m; i++) if (alpha[i]) sum += gain[i];
    return places(sum / covered, 2);
  });
  // Written through clamped bytes: a value halfway between two levels goes to the even one, and nothing leaves 0 to 255.
  const pw = part.x1 - part.x0, ph = part.y1 - part.y0;
  const made = new Uint8ClampedArray(pw * ph * 4), plainly = new Uint8ClampedArray(pw * ph * 4);
  for (let y = part.y0; y < part.y1; y++) {
    for (let x = part.x0; x < part.x1; x++) {
      const i = y * w + x, q = ((y - part.y0) * pw + x - part.x0) * 4, t = alpha[i];
      for (let c = 0; c < 3; c++) {
        plainly[q + c] = b[c][i] + off[c][i];
        made[q + c] = t ? a[c][i] * (1 - t) + (matched.planes[c][i] + off[c][i]) * t : a[c][i];
      }
    }
  }

  // 9. The check: in the patch's rectangle, nothing of the composed picture still lies outside what the cleaned picture, at the
  // first picture's color, holds near it. A part of the drawing the patch did not reach would.
  const still = outsideOf(made, plainly, pw, ph, rule.search, rule.level);
  let left = 0;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) left += still[(y - part.y0) * pw + x - part.x0];
  read.left = left;
  if (left > Math.max(rule.leftPixels, rule.leftShare * pixels)) return none("left");

  // 10. Only now is the first picture changed, and only inside the patch.
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (!alpha[y * w + x]) continue;
      const q = ((y - part.y0) * pw + x - part.x0) * 4, p = ((cy0 + y) * W + cx0 + x) * 4;
      A[p] = made[q]; A[p + 1] = made[q + 1]; A[p + 2] = made[q + 2];
    }
  }
  return { picture: first, box: { x: cx0 + bx0, y: cy0 + by0, width: bx1 - bx0 + 1, height: by1 - by0 + 1 }, share: places(share, 4), read };
}

/** What composing found, as the picture service answers it (picture/contract.ts, FirstPictureFacts). */
type ComposeFacts = FirstPictureFacts;

/**
 * The one place that decides what a cleaned-slot call composes: the
 * rectangle rule first (firstPicture.ts, `composeFirst`), and its answer
 * as it is whenever it composed a picture, or composed none for a reason
 * about the files or the slot. Only for "removal" and "join" is the
 * strokes step tried, on the first picture the rule left untouched.
 *
 * When the step composes, the answer is a composed picture like any other:
 * `made`, the patch's `box` (outside it the picture is the first picture
 * exactly) and its `share` of the picture. `by` says it was made this way.
 * `join`, `removed` and `measured` stay what the rectangle rule answered,
 * so a review sees why the rectangle was refused, and `measured.strokes`
 * holds what this step read. When the step composes nothing, the answer is
 * the rectangle rule's own, unchanged.
 *
 * `step` is the strokes step itself; a test gives its own to see when it
 * is run.
 */
export function composeFirstOrStrokes(first: Raster, cleaned: Raster, slot: Rect, found: boolean, step: typeof composeStrokes = composeStrokes): { picture: Raster | null; facts: ComposeFacts } {
  const released = composeFirst(first, cleaned, slot, found);
  const why = released.facts.why;
  if (released.facts.made || (why !== "removal" && why !== "join")) return released;
  const tried = step(first, cleaned, found ? slot : null);
  if (!tried.picture || !tried.box) return released;
  const { why: _why, ...read } = tried.read;
  const strokes = { instead: why, ...read } as StrokesMeasure;
  const { why: _refused, ...kept } = released.facts;
  return { picture: tried.picture, facts: { ...kept, made: true, by: "strokes", share: tried.share, measured: { ...released.facts.measured, strokes }, box: tried.box } };
}
