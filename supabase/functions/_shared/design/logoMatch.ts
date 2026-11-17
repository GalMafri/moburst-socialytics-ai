// supabase/functions/_shared/design/logoMatch.ts
//
// Where the image model drew the client's logo. The model designs the whole
// post on a canvas that carries the logo file at the client's usual spot, and
// it sizes the logo the way the client's own posts do (Moburst's run from 18%
// to 33% of the frame; its carousels use the small end). The model composes
// the post around the logo it drew, so the file goes exactly there: stamped
// at one fixed size instead, it ran into the picture under it on 4 of 42
// designs (13 Oct). This finds the drawn logo: the position and size where the
// file's picture best matches the design (normalized cross-correlation of
// luminance), searched coarse to fine around the usual spot. The search is
// stepwise work (findLogoSteps, 17 Nov 2026): the picture service runs it a
// row at a time, so one long search never keeps another call waiting, and can
// stop it and carry it on in a later call with the same answer. Every search
// the product makes is that one piece of work; findLogo runs it to its end.
//
// Free of Deno and network imports so it can be tested.

export interface Rect { x: number; y: number; width: number; height: number }

/** Luminance (0..255) of RGBA pixels laid over a flat background colour. */
export function luminance(rgba: ArrayLike<number>, w: number, h: number, bg: [number, number, number] = [0, 0, 0]): Float32Array {
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const a = rgba[i + 3] / 255;
    const r = rgba[i] * a + bg[0] * (1 - a), g = rgba[i + 1] * a + bg[1] * (1 - a), b = rgba[i + 2] * a + bg[2] * (1 - a);
    out[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

/** Area-average a single-channel image down to dw x dh. */
export function shrink(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let s = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < sh; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < sw; sx++) {
          const w = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * wy;
          s += src[sy * sw + sx] * w; area += w;
        }
      }
      out[y * dw + x] = area > 0 ? s / area : 0;
    }
  }
  return out;
}

/** A match: where the file fits best and its score. */
export interface Candidate { x: number; y: number; width: number; height: number; score: number }

/**
 * The coarse search tries every spot in a window around the usual one, at
 * about two dozen sizes, with a template this many pixels at most. It used
 * to size the template by width alone (about 80 px wide), so a square or
 * tall logo drawn small cost 12 times what a wide one does: Pay The Pyper's
 * square logo took 4.3 s to find on a fast laptop against 0.2 to 0.5 s for
 * the wide logos of the other clients, and the edge runtime cut the step off
 * (10 Nov 2026). Chosen so that the wide logos of the clients that work are
 * searched exactly as before.
 */
export const COARSE_TEMPLATE_AREA = 3200;

/** How far the picture is shrunk for the coarse search, from the logo's usual size on it. */
export function coarseFactor(width: number, height: number): number {
  const byWidth = Math.max(1, Math.floor(width / 80));
  const byArea = Math.max(1, Math.ceil(Math.sqrt((width * height) / COARSE_TEMPLATE_AREA)));
  return Math.max(byWidth, byArea);
}

/**
 * The size the logo file is brought down to once, before the search: twice
 * the widest template the search can ask for, or null when the file is no
 * wider than that. The search shrinks the logo again for every size it tries,
 * and from a 2160 px file each of those passes read 4.7 million pixels.
 */
export function templateSize(lw: number, lh: number, widest: number): [number, number] | null {
  const w = Math.max(1, Math.ceil(widest)) * 2;
  if (lw <= w) return null;
  return [w, Math.max(1, Math.round((lh * w) / lw))];
}

/**
 * The score of one spot from its three sums: the normalized
 * cross-correlation of the zero-mean template (`norm` its sum of squares,
 * `count` its pixels) with the picture there, sum(I * T0) / sqrt(var(I) *
 * norm), since sum((I - mI)(T - mT)) = sum(I * (T - mT)). Read in either
 * tone (`either`, 17 Nov 2026) it is the correlation's strength whatever its
 * sign, so a shape drawn lighter than its ground scores what the same shape
 * drawn darker than its ground does. A spot with no variation is no match
 * in either reading. In the file's own tone the expression keeps the form
 * it always had, with the zero-mean template's mean of 0.
 */
function scoreOf(sI: number, sII: number, sIT: number, count: number, norm: number, either: boolean): number {
  const varI = sII - (sI * sI) / count;
  if (varI <= 1e-6 || norm <= 1e-6) return -1;
  return either ? Math.abs(sIT) / Math.sqrt(varI * norm) : (sIT - 0 * sI) / Math.sqrt(varI * norm);
}

/**
 * One row of spots for one template size, left to right: the best match so
 * far, replaced only by a higher score.
 *
 * Four neighboring spots are summed in one pass over the template (17 Nov
 * 2026). Each spot keeps its own three sums, and each sum receives its
 * terms in the order it always did (the template's rows, then its columns),
 * so every sum is the number the search gave when it summed one spot at a
 * time, bit for bit, and the spots are still compared left to right (the
 * tests keep that search as their oracle, searchBefore.ts). What changed is
 * only that four spots no longer wait for one another: summed one at a
 * time, every addition waited for the one before it, and that wait was most
 * of a search's time. The last one to three spots of a row are summed one
 * at a time.
 */
function bestInRow(img: Float32Array, iw: number, t0: Float32Array, tw: number, th: number, norm: number, y: number, x0: number, x1: number, best: Candidate, either: boolean): Candidate {
  const count = tw * th;
  let x = x0;
  for (; x + 3 <= x1; x += 4) {
    let aI = 0, aII = 0, aIT = 0, bI = 0, bII = 0, bIT = 0, cI = 0, cII = 0, cIT = 0, dI = 0, dII = 0, dIT = 0;
    for (let j = 0; j < th; j++) {
      const row = (y + j) * iw + x, trow = j * tw;
      // The four spots read the same picture row one pixel apart, so each pixel is read once and handed along.
      let a = img[row], b = img[row + 1], c = img[row + 2];
      for (let i = 0; i < tw; i++) {
        const t = t0[trow + i], d = img[row + i + 3];
        aI += a; aII += a * a; aIT += a * t;
        bI += b; bII += b * b; bIT += b * t;
        cI += c; cII += c * c; cIT += c * t;
        dI += d; dII += d * d; dIT += d * t;
        a = b; b = c; c = d;
      }
    }
    let s = scoreOf(aI, aII, aIT, count, norm, either);
    if (s > best.score) best = { x, y, width: tw, height: th, score: s };
    s = scoreOf(bI, bII, bIT, count, norm, either);
    if (s > best.score) best = { x: x + 1, y, width: tw, height: th, score: s };
    s = scoreOf(cI, cII, cIT, count, norm, either);
    if (s > best.score) best = { x: x + 2, y, width: tw, height: th, score: s };
    s = scoreOf(dI, dII, dIT, count, norm, either);
    if (s > best.score) best = { x: x + 3, y, width: tw, height: th, score: s };
  }
  for (; x <= x1; x++) {
    let sI = 0, sII = 0, sIT = 0;
    for (let j = 0; j < th; j++) {
      const row = (y + j) * iw + x, trow = j * tw;
      for (let i = 0; i < tw; i++) {
        const v = img[row + i];
        sI += v; sII += v * v; sIT += v * t0[trow + i];
      }
    }
    const s = scoreOf(sI, sII, sIT, count, norm, either);
    if (s > best.score) best = { x, y, width: tw, height: th, score: s };
  }
  return best;
}

/**
 * How far a search's first pass got: `size` sizes are done, `row` rows of
 * the next one, and `best` is the best match among all of that. Given back
 * to the search (`from`), it carries on with the next row and ends in the
 * answer it would have given in one go: the sizes, rows and spots are tried
 * in the same order and the best match is replaced by the same test. It
 * holds only numbers, so it can be kept as JSON. `size` equal to the number
 * of sizes means the first pass is done.
 */
export interface SearchAt { size: number; row: number; best: Candidate }

/**
 * Every spot in a window, at each of `widths`, one row at a time. After each
 * row it says how far it got (the caller may stop there), and `from` starts
 * it where an earlier run stopped.
 */
function* bestAtSteps(img: Float32Array, iw: number, ih: number, logo: Float32Array, lw: number, lh: number,
  widths: number[], cx: [number, number], cy: [number, number], either: boolean, from?: SearchAt): Generator<SearchAt, Candidate, void> {
  let best: Candidate = from ? from.best : { x: 0, y: 0, width: 0, height: 0, score: -2 };
  for (let k = from ? from.size : 0; k < widths.length; k++) {
    const tw = widths[k];
    const th = Math.max(2, Math.round((tw * lh) / lw));
    if (tw < 4 || tw >= iw || th >= ih) continue;
    const t = shrink(logo, lw, lh, tw, th);
    let mean = 0;
    for (const v of t) mean += v;
    mean /= t.length;
    let norm = 0;
    for (const v of t) norm += (v - mean) * (v - mean);
    const t0 = new Float32Array(t.length);
    for (let j = 0; j < t.length; j++) t0[j] = t[j] - mean;
    const y0 = Math.max(0, cy[0]), y1 = Math.min(ih - th, cy[1]);
    const x0 = Math.max(0, cx[0]), x1 = Math.min(iw - tw, cx[1]);
    for (let y = from && k === from.size ? y0 + from.row : y0; y <= y1; y++) {
      best = bestInRow(img, iw, t0, tw, th, norm, y, x0, x1, best, either);
      yield { size: k, row: y - y0 + 1, best };
    }
  }
  return best;
}

/** A stepwise piece of work run to its end in one go. */
export function toEnd<T>(steps: Generator<unknown, T, void>): T {
  for (;;) {
    const r = steps.next();
    // The app's own compiler setting does not narrow a generator's result by `done`, so the end says its type.
    if (r.done) return r.value as T;
  }
}

/**
 * A picture's luminance and the smaller copies of it a search works on, each
 * made once. A call that searches one picture for two templates hands the
 * same one to both searches, so the picture is not read and shrunk again
 * for the second. What a search reads from it is what it would have made
 * itself: the same functions on the same pixels.
 */
export interface Shrunk {
  /** The picture's luminance at its own size. */
  full(): Float32Array;
  /** The luminance area-averaged down to `w` x `h`. */
  at(w: number, h: number): Float32Array;
}

export function shrunkOf(image: ArrayLike<number>, iw: number, ih: number): Shrunk {
  let img: Float32Array | null = null;
  const made = new Map<string, Float32Array>();
  const full = () => (img ??= luminance(image, iw, ih));
  return {
    full,
    at(w, h) {
      const key = `${w}x${h}`;
      let s = made.get(key);
      if (!s) made.set(key, (s = shrink(full(), iw, ih, w, h)));
      return s;
    },
  };
}

/**
 * The version of the search's steps. A point a search was stopped at
 * (SearchAt) means "this many sizes and rows are done" only for the code
 * that made it. The picture service puts this number in the mark of every
 * point it answers (server/src/picture/routes.ts, markOf), so a point kept
 * from before a deploy that changed the search is not carried on under the
 * new code: the search starts from the beginning and gives the new code's
 * whole answer.
 *
 * BUMP IT BY HAND with any change to what the search tries or in what
 * order: the sizes and their step (0.04), coarseFactor and
 * COARSE_TEMPLATE_AREA, templateSize, the reach and the windows, the finer
 * levels, shrink or luminance, how a best match is replaced, or how the
 * templates of a call are ordered (logoTone.ts, searchTemplatesSteps). A
 * change that keeps every answer bit for bit and every point's meaning (as
 * the four-spot sums did) needs no bump.
 */
export const SEARCH_STEPS_VERSION = 1;

/**
 * The search for the logo file on a design, as stepwise work (17 Nov 2026):
 * the rectangle where the file best matches the design, near `expected`
 * (the spot the canvas gave it). `image` and `logo` are RGBA; the logo is
 * judged over `background` (the canvas colour the model was given). Returns
 * the rectangle in the design's pixels and the match score (1 is identical).
 *
 * `either` (17 Nov 2026) reads a match in either tone: the model redraws the
 * logo in the tone its picture needs, so a one-color logo drawn darker than
 * its ground and the same logo drawn lighter than its ground are found
 * alike, with one template. The search that finds where the logo goes on a
 * design asks for it; every other caller is searched as before.
 *
 * A search can take many seconds (the first pass tries every spot in a
 * window at about two dozen sizes), so it stops after every row of the first
 * pass and of each finer level and says how far the first pass got. The
 * caller decides whether to go on, and a later run given that point (`from`)
 * carries on from it. However it is cut up, the answer is the one the search
 * gives in one go, bit for bit: nothing about what is tried, or in what
 * order, depends on where it was stopped. The finer levels are short and
 * are run again when a search is carried on after its first pass.
 *
 * `of` is the picture's luminance and shrunk copies when the caller already
 * has them (shrunkOf); without it the search makes its own.
 */
export function* findLogoSteps(image: ArrayLike<number>, iw: number, ih: number, logo: ArrayLike<number>, lw: number, lh: number,
  expected: Rect, background: [number, number, number], opts: { reach?: number; scales?: [number, number]; either?: boolean; from?: SearchAt; of?: Shrunk } = {}): Generator<SearchAt, Candidate, void> {
  const reach = opts.reach ?? 0.15;
  const either = opts.either === true;
  const [sMin, sMax] = opts.scales ?? [0.75, 1.3];
  const picture = opts.of ?? shrunkOf(image, iw, ih);
  const img = picture.full();
  let tpl = luminance(logo, lw, lh, background);
  // The widest template asked for is the usual width at the top of the sizes searched, with room for the finest level's steps.
  const small = templateSize(lw, lh, expected.width * sMax * 1.05);
  if (small) {
    tpl = shrink(tpl, lw, lh, small[0], small[1]);
    [lw, lh] = small;
  }

  // Coarse: the logo about 80 px wide, and no more than COARSE_TEMPLATE_AREA pixels.
  const f = coarseFactor(expected.width, expected.height);
  const cw = Math.floor(iw / f), ch = Math.floor(ih / f);
  const coarse = picture.at(cw, ch);
  const ew = expected.width / f;
  const widths: number[] = [];
  for (let s = sMin; s <= sMax + 1e-9; s += 0.04) widths.push(Math.round(ew * s));
  const rx = Math.round((reach * iw) / f), ry = Math.round((reach * ih) / f);
  const ex = Math.round(expected.x / f), ey = Math.round(expected.y / f);
  const first: Candidate = opts.from && opts.from.size >= widths.length
    ? opts.from.best
    : yield* bestAtSteps(coarse, cw, ch, tpl, lw, lh, widths, [ex - rx, ex + rx], [ey - ry, ey + ry], either, opts.from);
  const firstDone: SearchAt = { size: widths.length, row: 0, best: first };

  // Finer levels, halving each time, each searching a few pixels around the last.
  let c = first;
  let level = f;
  let rect = { x: c.x * level, y: c.y * level, width: c.width * level, height: c.height * level };
  while (level > 1) {
    yield firstDone;
    level = Math.max(1, Math.floor(level / 2));
    const lw2 = Math.floor(iw / level), lh2 = Math.floor(ih / level);
    const im = level === 1 ? img : picture.at(lw2, lh2);
    const w0 = rect.width / level;
    const ws = [-0.03, -0.015, 0, 0.015, 0.03].map((d) => Math.round(w0 * (1 + d)));
    const x0 = Math.round(rect.x / level), y0 = Math.round(rect.y / level), r = 3;
    // A row of a finer level is a step too, so a level on a large picture holds nobody up; the point said stays the end of the first pass.
    const fine = bestAtSteps(im, lw2, lh2, tpl, lw, lh, [...new Set(ws)], [x0 - r, x0 + r], [y0 - r, y0 + r], either);
    for (;;) {
      const row = fine.next();
      if (row.done) {
        c = row.value as Candidate;
        break;
      }
      yield firstDone;
    }
    rect = { x: c.x * level, y: c.y * level, width: c.width * level, height: c.height * level };
  }
  return { ...rect, score: c.score };
}

/** The search run to its end in one go (findLogoSteps): the same rectangle and score. */
export function findLogo(image: ArrayLike<number>, iw: number, ih: number, logo: ArrayLike<number>, lw: number, lh: number,
  expected: Rect, background: [number, number, number], opts: { reach?: number; scales?: [number, number]; either?: boolean; of?: Shrunk } = {}): Candidate {
  return toEnd(findLogoSteps(image, iw, ih, logo, lw, lh, expected, background, opts));
}

/**
 * The logo sizes searched, as shares of the usual logo width set in the
 * client's design settings. Clients' own posts run from about 0.55 of it
 * (Moburst's carousels: 18% of the frame against 32.3% set) to about 1.2 of
 * it (LegaBot's corner logo: 24% against 20.5% set), measured 14 Oct; a logo
 * drawn twice the size, over a headline, is outside.
 */
export const LOGO_SCALES: [number, number] = [0.45, 1.35];

/**
 * The lowest match score that counts as the logo. A drawn logo matched its
 * file at 0.85 to 0.98 in 41 designs (13 Oct); a design the model drew with no
 * logo at all scored 0.32.
 */
export const LOGO_MIN_SCORE = 0.75;

/**
 * Whether the model drew the logo at the client's usual spot, at a size the
 * client uses. A best match pinned to either end of the sizes searched means
 * the drawn logo is outside them; that design is made again.
 */
export function logoFound(found: { width: number; score: number }, usualWidth: number): boolean {
  const scale = found.width / usualWidth;
  return found.score >= LOGO_MIN_SCORE && scale > LOGO_SCALES[0] + 0.03 && scale < LOGO_SCALES[1] - 0.03;
}
