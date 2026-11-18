// The first picture as the base where no rectangle can be laid (18 Nov 2026, night): the strokes the cleaning took out,
// patched by themselves (firstPictureStrokes.ts). Pictures are drawn here, in made-up neutral colors: a first picture with
// a drawn wordmark, and "cleaned" pictures without it that differ from the first the way a redraw does (a color cast,
// grain or a ground rendered again, small things dropped).
import { afterEach, describe, expect, it } from "vitest";
import type { Rect, Rgb } from "../../../functions/_shared/picture/contract";
import type { Raster } from "../../../functions/_shared/design/logoTone";
import { composeFirst } from "../../../functions/_shared/design/firstPicture";
import { STROKES_RULE, composeFirstOrStrokes, composeStrokes, outsideOf, outsideQuick, type Strokes } from "../../../functions/_shared/design/firstPictureStrokes";
import { blank, box, copyOf, flat } from "./draw";

// These tests are sums with nothing to wait for. Between them, and between the generated pairs of the last one, the test's
// worker is handed back to its event loop for one turn, so on a slow machine the runner's own messages to and from this
// worker are still answered in time (as in firstPicture.test.ts).
const turn = () => new Promise<void>((done) => setImmediate(done));
afterEach(turn);

const W = 640, H = 480;
const GROUND: Rgb = [52, 84, 140];
const INK: Rgb = [240, 242, 236];
const CAST: Rgb = [4, 5, -3];
type Draw = (r: Raster) => Raster;

/** A generator of whole numbers, the same on every run. */
function seeded(seed: number): (below: number) => number {
  let s = seed >>> 0;
  return (below) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 4294967296) * below);
  };
}

/** Grain: each channel of each pixel moved by up to `by` levels, the same way every run. */
function grain(r: Raster, by: number, seed: number): Raster {
  const next = seeded(seed);
  for (let i = 0; i < r.data.length; i += 4) for (let c = 0; c < 3; c++) r.data[i + c] = r.data[i + c] + next(2 * by + 1) - by;
  return r;
}

/** Every channel moved by the same amounts: a redraw's color cast. */
function cast(r: Raster, by: Rgb = CAST): Raster {
  for (let i = 0; i < r.data.length; i += 4) for (let c = 0; c < 3; c++) r.data[i + c] = r.data[i + c] + by[c];
  return r;
}

/** Gravel: blocks of 4 pixels a side, each lighter or darker than the ground by up to `by` levels. Two seeds are two renderings of one ground. */
function gravel(r: Raster, by: number, seed: number): Raster {
  const next = seeded(seed);
  for (let y = 0; y < r.height; y += 4) for (let x = 0; x < r.width; x += 4) {
    const d = next(2 * by + 1) - by, p = (y * r.width + x) * 4;
    box(r, x, y, x + 4, y + 4, [r.data[p] + d, r.data[p + 1] + d, r.data[p + 2] + d]);
  }
  return r;
}

/** Points of light, 2 pixels a side, at places a seed decides: a redraw leaves some out and adds others. */
function stars(r: Raster, count: number, seed: number): Raster {
  const next = seeded(seed);
  for (let k = 0; k < count; k++) { const x = next(r.width - 2), y = next(r.height - 2); box(r, x, y, x + 2, y + 2, [200, 215, 255]); }
  return r;
}

/** A wordmark: `letters` letters 16 pixels wide and `high` high, strokes 4 thick, 6 apart, from (x, y). 104 pixels wide with five letters. */
function word(x: number, y: number, letters = 5, high = 32, color: Rgb = INK): Draw {
  return (r) => {
    for (let k = 0; k < letters; k++) {
      const at = x + k * 22;
      box(r, at, y, at + 4, y + high, color);
      box(r, at, y, at + 16, y + 4, color);
      if (k % 2) box(r, at, y + (high >> 1) - 2, at + 12, y + (high >> 1) + 2, color);
      else box(r, at + 12, y, at + 16, y + high, color);
    }
    return r;
  };
}

/** A square frame, `side` pixels a side with strokes `thick` thick: an icon with an open middle. */
function frame(x: number, y: number, side: number, thick: number, color: Rgb): Draw {
  return (r) => {
    box(r, x, y, x + side, y + thick, color); box(r, x, y + side - thick, x + side, y + side, color);
    box(r, x, y, x + thick, y + side, color); box(r, x + side - thick, y, x + side, y + side, color);
    return r;
  };
}

const all = (...draws: Draw[]): Draw => (r) => draws.reduce((on, draw) => draw(on), r);
const plain = () => flat(W, H, GROUND);

/** 1 at every pixel a drawing paints. */
function painted(draw: Draw, w = W, h = H): Uint8Array {
  const on = draw(blank(w, h)), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = on.data[i * 4 + 3] ? 1 : 0;
  return out;
}

/** 1 at every pixel within `by` pixels, across and down, of a pixel set in `mask`. */
function within(mask: Uint8Array, by: number, w = W, h = H): Uint8Array {
  const across = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let xx = Math.max(0, x - by); xx <= Math.min(w - 1, x + by); xx++) across[y * w + xx] = 1;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!across[y * w + x]) continue;
    for (let yy = Math.max(0, y - by); yy <= Math.min(h - 1, y + by); yy++) out[yy * w + x] = 1;
  }
  return out;
}

const same = (a: Raster, b: Raster) => Buffer.from(a.data).equals(Buffer.from(b.data));
const inside = (b: Rect, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;

/** How far a pixel can be changed from the strokes: the widening, the fade, and the fade's own softening. */
const reachOf = (made: Strokes) => (made.read.dilate as number) + 2 * STROKES_RULE.feather;

/**
 * What every composed picture is held to. Outside the patch it is the first picture, byte for byte: outside its box, and
 * outside the strokes' own reach, so the patch has the strokes' shape and is no rectangle. And the drawing is gone: on
 * every pixel it painted, the picture is within `near` levels of the first picture as it was before the drawing (`bare`).
 */
function expectPatched(made: Strokes, first: Raster, bare: Raster, strokes: Uint8Array, near: number, reach = reachOf(made)): void {
  expect(made.picture, JSON.stringify(made.read)).not.toBeNull();
  const got = made.picture as Raster, patch = made.box as Rect, close = within(strokes, reach, first.width, first.height);
  let outsideBox = 0, outsideReach = 0, changed = 0, alpha = 0, worst = 0;
  for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) {
    const i = y * first.width + x, p = i * 4;
    if (got.data[p + 3] !== first.data[p + 3]) alpha++;
    const differs = got.data[p] !== first.data[p] || got.data[p + 1] !== first.data[p + 1] || got.data[p + 2] !== first.data[p + 2];
    if (differs) { changed++; if (!inside(patch, x, y)) outsideBox++; if (!close[i]) outsideReach++; }
    if (strokes[i]) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got.data[p + c] - bare.data[p + c]));
  }
  expect({ outsideBox, outsideReach, alpha }).toEqual({ outsideBox: 0, outsideReach: 0, alpha: 0 });
  expect(changed).toBeGreaterThan(0);
  expect(worst).toBeLessThanOrEqual(near);
  // The step's own check agrees: nothing in the patch's rectangle still lies outside what the cleaned picture holds near it.
  expect(made.read.left).toBeLessThanOrEqual(STROKES_RULE.leftPixels);
  // The patch's share of the picture is every pixel it may have changed (to four places): no fewer than the drawing's own, which all did.
  let drawn = 0;
  for (let i = 0; i < strokes.length; i++) drawn += strokes[i];
  expect(changed).toBeGreaterThanOrEqual(drawn);
  expect(changed).toBeLessThanOrEqual((made.share + 0.00005) * first.width * first.height);
}

/** The step on a first picture made of `bare` and a drawing, against a cleaned picture. The first picture given is a copy, and is returned as it was. */
function tried(bare: Raster, draw: Draw, cleaned: Raster, found: Rect | null = null, rule = STROKES_RULE): { made: Strokes; first: Raster } {
  const first = draw(copyOf(bare));
  return { made: composeStrokes(copyOf(first), cleaned, found, rule), first };
}

/** How strong a picture's finest detail is on some pixels: the root of the mean square of each pixel's difference from the one to its right. */
function roughOn(r: Raster, on: Uint8Array): number {
  let squares = 0, count = 0;
  for (let i = 0; i + 1 < on.length; i++) if (on[i] && on[i + 1] && (i + 1) % r.width) { const d = r.data[i * 4 + 1] - r.data[i * 4 + 5]; squares += d * d; count++; }
  return Math.sqrt(squares / count);
}

describe("the step's numbers", () => {
  it("are the ones measured on the live pairs", () => {
    expect(STROKES_RULE).toEqual({
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
    });
  });
});

describe("outside what the cleaned picture holds nearby", () => {
  /** The plain reading: every window looked through, pixel by pixel. */
  function counted(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, s: number, level: number): Uint8Array {
    const want = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let hi = 0, lo = 255;
      for (let yy = Math.max(0, y - s); yy <= Math.min(h - 1, y + s); yy++) for (let xx = Math.max(0, x - s); xx <= Math.min(w - 1, x + s); xx++) {
        const v = b[(yy * w + xx) * 4 + c];
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      const v = a[(y * w + x) * 4 + c];
      if (v - hi > level || lo - v > level) want[y * w + x] = 1;
    }
    return want;
  }
  const alike = (got: Uint8Array | null, want: Uint8Array) => got !== null && Buffer.from(got).equals(Buffer.from(want));

  it("is the same read the whole way and pixel by pixel, on pictures of every kind and size", async () => {
    const next = seeded(11);
    for (let run = 0; run < 60; run++) {
      if (run % 10 === 0) await turn();
      const w = 1 + next(40), h = 1 + next(40), s = [0, 1, 2, 3, 8, 8, 11][next(7)], level = [0, 5, 25, 25, 60][next(5)];
      const a = new Uint8ClampedArray(w * h * 4), b = new Uint8ClampedArray(w * h * 4);
      // The cleaned picture: noise, or nearly flat. The first: the cleaned with a little grain and a tenth of its pixels anything, or anything at all.
      const kind = next(4), base = next(200);
      for (let i = 0; i < a.length; i++) {
        b[i] = kind === 0 ? next(256) : base + next(kind === 1 ? 4 : 40);
        a[i] = kind === 3 ? next(256) : next(10) < 1 ? next(256) : b[i] + next(9) - 4;
      }
      const want = counted(a, b, w, h, s, level), label = `${w}x${h}, within ${s}, over ${level}, kind ${kind}`;
      expect(alike(outsideOf(a, b, w, h, s, level, true), want), label).toBe(true);
      // Whichever way it is read when the caller does not say.
      expect(alike(outsideOf(a, b, w, h, s, level), want), label).toBe(true);
    }
  });

  it("is the same read the quick way on a pair of pictures that agree nearly everywhere, and the quick way gives up on a pair that does not", async () => {
    const next = seeded(12);
    let outside = 0;
    for (let run = 0; run < 24; run++) {
      if (run % 6 === 0) await turn();
      const w = 60 + next(50), h = 50 + next(40), s = [2, 3, 8, 8][next(4)], level = [5, 25, 25, 40][next(4)];
      const a = new Uint8ClampedArray(w * h * 4), b = new Uint8ClampedArray(w * h * 4);
      // A cleaned picture with a soft slope and a little grain; the first is the same with grain of its own, and one value in 400 anything:
      // at every distance from what the cleaned picture holds, the line itself among them.
      const base = 40 + next(150);
      for (let i = 0; i < a.length; i++) {
        b[i] = base + ((i >> 2) % w >> 3) + next(4);
        a[i] = next(400) < 1 ? b[i] + (next(2) ? 1 : -1) * (level - 3 + next(8)) : b[i] + next(5) - 2;
      }
      const want = counted(a, b, w, h, s, level), label = `${w}x${h}, within ${s}, over ${level}`;
      for (let i = 0; i < want.length; i++) outside += want[i];
      expect(alike(outsideQuick(a, b, w, h, s, level), want), label).toBe(true);
    }
    // Pixels on both sides of the line were among them.
    expect(outside).toBeGreaterThan(100);
    // Two pictures of noise: too many pixels would need their own window looked through, and the reading is left to the whole way.
    const a = new Uint8ClampedArray(80 * 60 * 4), b = new Uint8ClampedArray(80 * 60 * 4);
    for (let i = 0; i < a.length; i++) { a[i] = next(256); b[i] = 100 + next(8); }
    expect(outsideQuick(a, b, 80, 60, 8, 25)).toBeNull();
    expect(outsideQuick(b, b, 80, 60, 0, 25)).toBeNull();
    expect(alike(outsideOf(a, b, 80, 60, 8, 25), counted(a, b, 80, 60, 8, 25))).toBe(true);
  });
});

describe("composeStrokes", () => {
  const MARK = word(120, 60);

  it("takes a wordmark off a plain ground: the cleaned pixels on its strokes, at the first picture's color, and the first picture everywhere else", () => {
    const { made, first } = tried(plain(), MARK, cast(plain()));
    // The ground under the strokes is the first picture's own color to the level, not the cleaned picture's with its cast.
    expectPatched(made, first, plain(), painted(MARK), 0);
    expect(made.read).toMatchObject({ cluster: { x: 120, y: 60, width: 104, height: 32 }, area: 1280, second: 0, core: 1280, dilate: 4, gains: [1, 1], left: 0 });
    expect(made.read.why).toBeUndefined();
    // The box is the strokes' rectangle and their reach around it, and the share is that of the picture.
    expect(made.box).toEqual({ x: 104, y: 44, width: 136, height: 64 });
    expect(made.share).toBeGreaterThan(0.02);
    expect(made.share).toBeLessThan(0.03);
  });

  it("brings the cleaned pixels to the strength of the first picture's grain, where the redraw rendered the ground rougher", () => {
    const bare = grain(plain(), 6, 1), cleaned = cast(grain(plain(), 12, 2));
    const { made, first } = tried(bare, MARK, cleaned);
    expectPatched(made, first, bare, painted(MARK), 25);
    // Both bands of detail were turned down, by about the half the two grains differ by.
    for (const gain of made.read.gains as number[]) { expect(gain).toBeGreaterThan(0.4); expect(gain).toBeLessThan(0.65); }
    // On the strokes the picture is now as rough as the first picture's ground, and no longer as rough as the cleaned picture's.
    const strokes = painted(MARK), got = made.picture as Raster;
    const laid = roughOn(got, strokes), ground = roughOn(bare, strokes), redrawn = roughOn(cleaned, strokes);
    expect(redrawn).toBeGreaterThan(1.8 * ground);
    expect(Math.abs(laid - ground)).toBeLessThan(0.25 * ground);
  });

  it("takes a wordmark off a field of points of light the redraw rendered again, and leaves every point of the first picture that is not under the patch", () => {
    const sky = (seed: number) => grain(stars(flat(W, H, [14, 22, 48]), 20, seed), 3, seed + 9);
    const bare = sky(1);
    const { made, first } = tried(bare, MARK, sky(2));
    expect(made.read.why).toBeUndefined();
    // Under the strokes the cleaned picture may hold a point of its own: the drawing is gone, the ground is the redraw's.
    const got = made.picture as Raster, strokes = painted(MARK);
    expect(got).not.toBeNull();
    let inked = 0;
    for (let i = 0; i < strokes.length; i++) if (strokes[i] && got.data[i * 4] > 120 && got.data[i * 4 + 1] > 120 && Math.abs(got.data[i * 4] - got.data[i * 4 + 2]) < 20) inked++;
    expect(inked).toBe(0);
    // The first picture's own points of light are all still there outside the patch: nothing but the patch was written.
    const close = within(strokes, reachOf(made));
    let changed = 0;
    for (let i = 0; i < close.length; i++) if (!close[i] && (got.data[i * 4] !== first.data[i * 4] || got.data[i * 4 + 1] !== first.data[i * 4 + 1] || got.data[i * 4 + 2] !== first.data[i * 4 + 2])) changed++;
    expect(changed).toBe(0);
    // The cluster is the wordmark, and the patch is its strokes with their reach.
    expect(made.read).toMatchObject({ area: 1280, cluster: { x: 120, y: 60, width: 104, height: 32 } });
    expect(made.box).toEqual({ x: 104, y: 44, width: 136, height: 64 });
    expect(made.read.left).toBeLessThanOrEqual(STROKES_RULE.leftPixels);
  });

  it("leaves gravel the redraw rendered again to the rectangle rule's answer: a ground with coarse features of its own is a deliberate limit", async () => {
    const bare = gravel(plain(), 40, 1), cleaned = cast(gravel(plain(), 40, 2));
    const first = MARK(copyOf(bare)), given = copyOf(first);
    const made = composeStrokes(given, cleaned, null);
    expect([made.picture, made.read.why]).toEqual([null, "texture"]);
    // The coarse band beside the patch holds far more than two levels, in both pictures alike: no reading of strength tells them apart.
    expect(made.read.detail![1].first).toBeGreaterThan(3 * STROKES_RULE.coarseLevel);
    expect(Math.abs(made.read.detail![1].first - made.read.detail![1].cleaned)).toBeLessThan(1);
    expect(same(given, first)).toBe(true);
    await turn();
    // It is that limit and nothing else that refuses it: without it the same pair is composed.
    const without = composeStrokes(copyOf(first), cleaned, null, { ...STROKES_RULE, coarseLevel: Infinity });
    expect(without.read.why).toBeUndefined();
    await turn();
    // The same two renderings with no drawing: nothing was taken out, though the two differ on every block.
    const empty = composeStrokes(copyOf(bare), cleaned, null);
    expect([empty.picture, empty.read.why]).toEqual([null, "none"]);
  });

  it("takes a wordmark with its icon and its tagline as one cluster, and leaves the open middle of the icon untouched", () => {
    // The icon is a frame 6 pixels to the right of three letters, in two colors; the tagline is thin strokes 6 pixels under them.
    const icon = all(frame(186, 56, 46, 4, [250, 200, 60]), (r) => box(r, 228, 56, 232, 102, [90, 200, 240]));
    const tagline: Draw = (r) => { for (let k = 0; k < 8; k++) box(r, 120 + k * 8, 102, 123 + k * 8, 112, [170, 200, 240]); return r; };
    const whole = all(word(120, 64, 3), icon, tagline);
    const { made, first } = tried(plain(), whole, cast(plain()));
    expectPatched(made, first, plain(), painted(whole), 0);
    expect(made.read.cluster).toEqual({ x: 120, y: 56, width: 112, height: 56 });
    expect(made.read.second).toBe(0);
    // The middle of the frame is 19 pixels from its strokes: inside the box, and the first picture's own bytes. A rectangle would have covered it.
    const got = made.picture as Raster;
    expect(inside(made.box as Rect, 209, 79)).toBe(true);
    for (let y = 77; y < 82; y++) for (let x = 207; x < 212; x++) expect([...got.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4)]).toEqual([...GROUND, 255]);
    // And the cleaned picture there has another color, so the bytes say which picture they are from.
    expect([...cast(plain()).data.slice(0, 3)]).not.toEqual(GROUND);
  });

  it("leaves stray details the redraw dropped somewhere else: the first picture keeps them", () => {
    // A dot and a short line far from the wordmark, on the first picture only.
    const strays: Draw = (r) => { box(r, 500, 300, 506, 306, [230, 230, 230]); box(r, 80, 400, 110, 403, [20, 30, 50]); return r; };
    const bare = strays(plain());
    const { made, first } = tried(bare, MARK, cast(plain()));
    expectPatched(made, first, bare, painted(MARK), 0);
    expect(made.read.second).toBe(90);
    const got = made.picture as Raster;
    expect([...got.data.slice((302 * W + 502) * 4, (302 * W + 502) * 4 + 3)]).toEqual([230, 230, 230]);
    expect([...got.data.slice((401 * W + 90) * 4, (401 * W + 90) * 4 + 3)]).toEqual([20, 30, 50]);
    expect(inside(made.box as Rect, 502, 302) || inside(made.box as Rect, 90, 401)).toBe(false);
  });

  it("fills the flat middle of a thick stroke, which has no contrast of its own, and refuses a shape too thick to fill", async () => {
    // A bar 64 pixels thick: its middle is farther from its edges than the contrast is read over, and only its rim is taken out at first.
    const bar: Draw = (r) => box(r, 120, 60, 240, 124, INK);
    const filled = tried(plain(), bar, cast(plain()));
    expectPatched(filled.made, filled.first, plain(), painted(bar), 0);
    expect(filled.made.read).toMatchObject({ area: 4864, core: 120 * 64 });
    await turn();
    // Without the filling, and with no more widening than a hard edge has, the middle is left: the check of the composed picture refuses it.
    const unfilled = tried(plain(), bar, cast(plain()), null, { ...STROKES_RULE, fillSteps: 0, dilateMax: 5 });
    expect([unfilled.made.picture, unfilled.made.read.why]).toEqual([null, "left"]);
    expect(unfilled.made.read.left).toBeGreaterThan(1000);
    await turn();
    // A block 140 pixels thick is not filled to its middle in 24 steps (on a larger picture, where its patch is not too large): the same check.
    const sheet = () => flat(1200, 900, GROUND);
    const block = box(sheet(), 120, 60, 260, 200, INK), given = copyOf(block);
    const thick = composeStrokes(given, cast(sheet()), null);
    expect([thick.picture, thick.read.why]).toEqual([null, "left"]);
    expect(thick.read.left).toBeGreaterThan(STROKES_RULE.leftShare * (thick.read.core as number));
    expect(same(given, block)).toBe(true);
  });

  it("lets through twenty pixels the cleaning took out beside the strokes, inside the patch's rectangle, and refuses more", async () => {
    // Two strokes at a right angle, and in the open corner between them single dots of 2 pixels a side the redraw left out.
    const angle: Draw = (r) => { box(r, 120, 60, 320, 66, INK); box(r, 120, 60, 126, 180, INK); return r; };
    const dotted = (dots: number) => { const r = plain(); for (let k = 0; k < dots; k++) box(r, 200 + 20 * k, 130, 202 + 20 * k, 132, INK); return r; };
    const five = tried(dotted(5), angle, cast(plain()));
    expectPatched(five.made, five.first, dotted(5), painted(angle), 0);
    expect(five.made.read.left).toBe(20);
    // The dots are the first picture's own still.
    expect([...(five.made.picture as Raster).data.slice((130 * W + 200) * 4, (130 * W + 200) * 4 + 3)]).toEqual(INK);
    await turn();
    const six = tried(dotted(6), angle, cast(plain()));
    expect([six.made.picture, six.made.read.why, six.made.read.left]).toEqual([null, "left", 24]);
  });

  describe("composes nothing, and leaves the first picture as it was", () => {
    const refused = (bare: Raster, draw: Draw, cleaned: Raster, why: string, found: Rect | null = null) => {
      const first = draw(copyOf(bare)), given = copyOf(first);
      const made = composeStrokes(given, cleaned, found);
      expect(made.read.why, JSON.stringify(made.read)).toBe(why);
      expect([made.picture, made.share]).toEqual([null, 0]);
      expect(made.box).toBeUndefined();
      expect(same(given, first)).toBe(true);
      return made;
    };

    it("when no logo was drawn: the two pictures differ only as a redraw differs", async () => {
      const none: Draw = (r) => r;
      refused(plain(), none, cast(plain()), "none");
      await turn();
      refused(grain(plain(), 6, 1), none, cast(grain(plain(), 12, 2)), "none");
      await turn();
      refused(grain(stars(flat(W, H, [14, 22, 48]), 60, 1), 3, 5), none, grain(stars(flat(W, H, [14, 22, 48]), 60, 2), 3, 6), "none");
    });

    it("when what was taken out is under the size of a logo, and composes from that size on", async () => {
      // 0.05% of this picture is 153.6 pixels: a mark of 12 by 12 is a stray detail, one of 13 by 13 is taken out.
      refused(plain(), (r) => box(r, 120, 60, 132, 72, INK), cast(plain()), "none");
      await turn();
      const big: Draw = (r) => box(r, 120, 60, 133, 73, INK);
      const { made, first } = tried(plain(), big, cast(plain()));
      expectPatched(made, first, plain(), painted(big), 0);
      expect(made.read.area).toBe(169);
    });

    it("when the two pictures differ everywhere", () => {
      // Another picture altogether: the same ground with large shapes where the first has none.
      const other = plain();
      for (let k = 0; k < 6; k++) box(other, 40 + k * 100, 150 + (k % 2) * 90, 110 + k * 100, 330, [200, 120, 60]);
      const made = refused(plain(), MARK, other, "pair");
      expect(made.read.agree).toBeGreaterThan(STROKES_RULE.agreeShare);
      expect(made.read.cluster).toBeUndefined();
    });

    it("when over one tenth of the coarse cells are far apart, and composes with under one tenth", async () => {
      // Whole cells of the lower half, 16 pixels a side, a shade lighter in the cleaned picture: 1,200 cells in all.
      const shaded = (cells: number) => {
        const r = cast(plain());
        for (let k = 0; k < cells; k++) { const cx = (k * 2) % 40, cy = 16 + 2 * Math.floor((k * 2) / 40); box(r, cx * 16, cy * 16, cx * 16 + 16, cy * 16 + 16, [GROUND[0] + 40, GROUND[1] + 40, GROUND[2] + 40]); }
        return r;
      };
      // The wordmark itself puts 17 cells far apart: 104 shaded cells make 121 of the 1,200, and 103 make 120.
      expect(refused(plain(), MARK, shaded(104), "pair").read.agree).toBe(0.1008);
      await turn();
      const { made, first } = tried(plain(), MARK, shaded(103));
      expect(made.read.agree).toBe(0.1);
      expectPatched(made, first, plain(), painted(MARK), 1);
    });

    it("when the cleaned picture is the picture moved by 6 pixels or more", async () => {
      // A picture with things in it: a band of coarse blocks under the wordmark. Unmoved, the wordmark is taken off.
      const scene = (seed: number) => { const r = plain(); const next = seeded(seed); for (let y = 160; y < 480; y += 8) for (let x = 0; x < W; x += 8) box(r, x, y, x + 8, y + 8, next(2) ? [30, 40, 60] : [200, 205, 190]); return r; };
      const bare = scene(3);
      const still = tried(bare, MARK, cast(scene(3)));
      expectPatched(still.made, still.first, bare, painted(MARK), 0);
      const moved = (dx: number, dy: number) => {
        const from = cast(scene(3)), r = copyOf(from);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const sx = Math.min(W - 1, Math.max(0, x - dx)), sy = Math.min(H - 1, Math.max(0, y - dy));
          r.data.set(from.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
        }
        return r;
      };
      for (const [dx, dy] of [[6, 0], [0, 6], [6, 5], [-7, 3], [12, 9], [30, 20]]) {
        await turn();
        refused(bare, MARK, moved(dx, dy), "pair");
      }
      // What refuses it is what the picture holds: on a plain ground a moved picture is the same picture, and nothing is out of place.
      await turn();
      expect(tried(plain(), MARK, cast(plain())).made.read.why).toBeUndefined();
    });

    it("when a second copy of the mark was taken out somewhere else", () => {
      const made = refused(plain(), all(MARK, word(380, 330)), cast(plain()), "second");
      expect(made.read).toMatchObject({ area: 1280, second: 1280 });
    });

    it("when the next largest thing taken out is over a twelfth of the largest, and composes when it is under", async () => {
      // The wordmark holds 1,280 pixels: a block of 9 by 12 holds 108, over a twelfth; one of 13 by 8 holds 104.
      expect(refused(plain(), all(MARK, (r) => box(r, 400, 300, 409, 312, INK)), cast(plain()), "second").read.second).toBe(108);
      await turn();
      const small: Draw = (r) => box(r, 400, 300, 413, 308, INK);
      const bare = small(plain());
      const { made, first } = tried(bare, MARK, cast(plain()));
      expectPatched(made, first, bare, painted(MARK), 0);
      expect(made.read.second).toBe(104);
      // The smaller thing is left as the first picture has it.
      expect([...(made.picture as Raster).data.slice((304 * W + 406) * 4, (304 * W + 406) * 4 + 3)]).toEqual(INK);
    });

    it("when a part of the drawn logo stands apart from it: a tagline far under the wordmark would be left, so nothing is composed", async () => {
      // Thin strokes 30 pixels under the letters are a cluster of their own, 144 pixels against 1,280: the wordmark alone would
      // be taken off and the tagline left at full strength.
      const tagline: Draw = (r) => { for (let k = 0; k < 6; k++) box(r, 130 + k * 8, 122, 133 + k * 8, 130, INK); return r; };
      const made = refused(plain(), all(MARK, tagline), cast(plain()), "second");
      expect(made.read).toMatchObject({ area: 1280, second: 144 });
      await turn();
      // A small drawn logo beside a label the cleaning also wiped, 7.5 times its size: the label would be patched and the logo left.
      const label = word(120, 300, 9, 30), small = word(300, 60, 2, 22);
      const lost = refused(plain(), all(label, small), cast(plain()), "second");
      expect(lost.read.area! / lost.read.second!).toBeGreaterThan(4);
      expect(lost.read.area! / lost.read.second!).toBeLessThan(STROKES_RULE.dominance);
      expect(lost.read.cluster).toMatchObject({ x: 120, y: 300 });
    });

    it("when what was taken out is scattered and no close-set mark", () => {
      // Dots 8 pixels apart down a diagonal: one cluster, 225 pixels in a rectangle of 195 by 195.
      const dots: Draw = (r) => { for (let k = 0; k < 25; k++) box(r, 120 + k * 8, 60 + k * 8, 123 + k * 8, 63 + k * 8, INK); return r; };
      const made = refused(plain(), dots, cast(plain()), "loose");
      expect(made.read).toMatchObject({ area: 225, second: 0 });
      expect(made.read.fill).toBeLessThan(STROKES_RULE.minFill);
    });

    it("when the patch would cover over a twentieth of the picture, and composes when it covers less", async () => {
      // Ten letters 32 high: with the patch's reach around them, just over 5% of this picture. 30 high: 4.9%.
      const over = refused(plain(), word(120, 60, 10, 32), cast(plain()), "large");
      expect(over.read.cluster).toEqual({ x: 120, y: 60, width: 214, height: 32 });
      await turn();
      const lower = word(120, 60, 10, 30);
      const { made, first } = tried(plain(), lower, cast(plain()));
      expectPatched(made, first, plain(), painted(lower), 0);
      expect(made.share).toBeGreaterThan(0.048);
      expect(made.share).toBeLessThanOrEqual(STROKES_RULE.maxMask);
    });

    it("when the cluster's rectangle is over a fifth of the picture, and composes when it is under", async () => {
      // A larger picture, where a thin shape can span a fifth of it while its patch stays small: two strokes 12 thick at a right angle.
      const w = 1200, h = 900, sheet = () => flat(w, h, GROUND);
      const angle = (across: number, down: number): Draw => (r) => { box(r, 100, 100, 100 + across, 112, INK); box(r, 100, 100, 112, 100 + down, INK); return r; };
      const wide = angle(600, 400)(sheet()), given = copyOf(wide);
      const over = composeStrokes(given, cast(sheet()), null);
      expect([over.picture, over.read.why, over.read.cluster]).toEqual([null, "large", { x: 100, y: 100, width: 600, height: 400 }]);
      expect(same(given, wide)).toBe(true);
      await turn();
      const under = composeStrokes(angle(560, 380)(sheet()), cast(sheet()), null);
      expect(under.read.why).toBeUndefined();
      expect(under.read.cluster).toEqual({ x: 100, y: 100, width: 560, height: 380 });
      expect(under.share).toBeLessThan(STROKES_RULE.maxMask);
    });

    it("when the search found the drawing somewhere else than the cluster, and composes when it found it there", async () => {
      const at: Rect = { x: 120, y: 60, width: 104, height: 32 };
      refused(plain(), MARK, cast(plain()), "place", { ...at, y: 330 });
      // Half of the smaller of the two rectangles is the line: the found rectangle moved by 54 of its 104 pixels shares less, by 52 exactly half.
      refused(plain(), MARK, cast(plain()), "place", { ...at, x: at.x + 54 });
      for (const found of [at, { ...at, x: at.x + 52 }, { x: 100, y: 40, width: 300, height: 120 }, { x: 150, y: 70, width: 40, height: 12 }]) {
        await turn();
        const { made, first } = tried(plain(), MARK, cast(plain()), found);
        expectPatched(made, first, plain(), painted(MARK), 0);
      }
    });

    it("when the cleaned picture came back moved and an edge passes behind the wordmark, on a ground too plain for the pair check to tell", async () => {
      // A horizon behind the letters: the ground turns a shade lighter at a line through the wordmark. Unmoved, the wordmark is taken off.
      const LIGHTER: Rgb = [GROUND[0] + 30, GROUND[1] + 24, GROUND[2] + 16];
      const horizon = (at: number) => { const r = plain(); box(r, 0, at, W, H, LIGHTER); return r; };
      const bare = horizon(76);
      const still = tried(bare, MARK, cast(horizon(76)));
      expectPatched(still.made, still.first, bare, painted(MARK), 0);
      expect(still.made.read.shift).toEqual({ x: 0, y: 0, share: 1 });
      // The cleaned picture 6 pixels lower: under one tenth of the coarse cells differ, and inside the strokes the line would sit 6 pixels low.
      await turn();
      const low = refused(bare, MARK, cast(horizon(82)), "shifted");
      expect(low.read.agree).toBeLessThan(STROKES_RULE.agreeShare);
      expect(low.read.shift).toMatchObject({ x: 0, y: 6 });
      expect(low.read.shift!.share).toBeLessThan(0.2);
      // Two pixels is the line, either way: one pixel off is composed.
      await turn();
      expect(refused(bare, MARK, cast(horizon(78)), "shifted").read.shift).toMatchObject({ x: 0, y: 2 });
      await turn();
      expect(refused(bare, MARK, cast(horizon(74)), "shifted").read.shift).toMatchObject({ x: 0, y: -2 });
      await turn();
      expect(tried(bare, MARK, cast(horizon(77))).made.read.why).toBeUndefined();
      // Across as well: an upright edge behind the wordmark, and the cleaned picture 3 pixels to the right.
      await turn();
      const upright = (at: number) => { const r = plain(); box(r, at, 0, W, H, LIGHTER); return r; };
      expect(tried(upright(170), MARK, cast(upright(170))).made.read.why).toBeUndefined();
      await turn();
      expect(refused(upright(170), MARK, cast(upright(173)), "shifted").read.shift).toMatchObject({ x: 3, y: 0 });
    });

    it("when the ground has coarse features the redraw arranged anew, or a pattern the cleaning wiped flat", async () => {
      // Blotches 16 pixels a side, 18 levels either way; the cleaned picture drew other blotches where the logo was.
      const blotches = (seed: number) => { const r = plain(); const next = seeded(seed); for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) { const d = next(37) - 18; box(r, x, y, x + 16, y + 16, [GROUND[0] + d, GROUND[1] + d, GROUND[2] + d]); } return r; };
      const bare = blotches(5), redrawn = copyOf(bare), other = blotches(99);
      for (let y = 36; y < 120; y++) redrawn.data.set(other.data.subarray((y * W + 96) * 4, (y * W + 264) * 4), (y * W + 96) * 4);
      const anew = refused(bare, MARK, redrawn, "texture");
      expect(anew.read.detail![1].first).toBeGreaterThanOrEqual(STROKES_RULE.coarseLevel);
      // The same blotches kept where they were are a coarse ground all the same: the limit is on the ground, whatever the redraw did.
      await turn();
      refused(bare, MARK, cast(copyOf(bare)), "texture");
      // A halftone of dots 8 pixels apart, flat in the cleaned picture where the logo was.
      await turn();
      const dots = plain();
      for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) box(dots, x + 2, y + 2, x + 6, y + 6, [20, 40, 80]);
      const wiped = copyOf(dots);
      box(wiped, 114, 54, 186, 90, [44, 73, 125]);
      const flat8 = refused(dots, word(120, 60, 3, 24), wiped, "texture");
      expect(flat8.read.detail![1].first).toBeGreaterThanOrEqual(STROKES_RULE.coarseLevel);
    });

    it("but composes what a logo usually comes with: a soft glow, a gradient under it, a translucent mark, a headline it touches", async () => {
      const strokes = painted(MARK);
      // A dark glow around the letters that fades out over 14 pixels, gone with them in the cleaned picture. Its faint outer part
      // is no taken-out pixel: the widening measured on the pair reaches it.
      const near14 = within(strokes, 14);
      const glow: Draw = (r) => {
        for (let k = 14; k >= 1; k--) {
          const ring = within(strokes, k), by = Math.round(40 * (1 - (k - 1) / 14));
          for (let i = 0; i < ring.length; i++) if (ring[i]) r.data.set([GROUND[0] - by, GROUND[1] - by, GROUND[2] - by], i * 4);
        }
        return MARK(r);
      };
      const glowing = tried(plain(), glow, cast(plain()));
      expect(glowing.made.read.why).toBeUndefined();
      expect(glowing.made.read.dilate).toBeGreaterThan(STROKES_RULE.dilateMin);
      let worst = 0;
      for (let i = 0; i < near14.length; i++) if (near14[i]) worst = Math.max(worst, Math.abs((glowing.made.picture as Raster).data[i * 4] - GROUND[0]));
      expect(worst).toBeLessThanOrEqual(8);
      // A ground that runs from dark to light down the picture.
      await turn();
      const slope = () => { const r = plain(); for (let y = 0; y < H; y++) box(r, 0, y, W, y + 1, [30 + (y >> 2), 50 + (y >> 2), 90 + (y >> 2)]); return r; };
      const sloped = tried(slope(), MARK, cast(slope()));
      expectPatched(sloped.made, sloped.first, slope(), strokes, 2);
      // A mark of 35% white over the ground.
      await turn();
      const faint: Rgb = [Math.round(GROUND[0] + 0.35 * (255 - GROUND[0])), Math.round(GROUND[1] + 0.35 * (255 - GROUND[1])), Math.round(GROUND[2] + 0.35 * (255 - GROUND[2]))];
      const sheer = word(120, 60, 5, 32, faint);
      const translucent = tried(plain(), sheer, cast(plain()));
      expectPatched(translucent.made, translucent.first, plain(), painted(sheer), 0);
      // A headline in the same color right under the wordmark, in both pictures: it stays, the wordmark goes.
      await turn();
      const headline = word(100, 96, 8, 30);
      const touching = tried(headline(plain()), MARK, cast(headline(plain())));
      expectPatched(touching.made, touching.first, headline(plain()), strokes, 0);
      expect([...(touching.made.picture as Raster).data.slice((110 * W + 101) * 4, (110 * W + 101) * 4 + 3)]).toEqual(INK);
    });

    it("when the cleaned picture came back far smoother than the first, or far rougher: its strokes would show", async () => {
      // Grain of 10 levels against 3: scaled as far as the gains go, the cleaned pixels hold under half of the first picture's detail.
      const smooth = refused(grain(plain(), 10, 1), MARK, grain(plain(), 3, 2), "texture");
      expect(smooth.read.detail![0].first).toBeGreaterThan(2 * smooth.read.detail![0].cleaned);
      await turn();
      // Grain of 3 levels against 24: turned down as far as the gains go, still over twice the first picture's.
      const rough = refused(grain(plain(), 3, 1), MARK, grain(plain(), 24, 2), "texture");
      expect(rough.read.detail![0].cleaned).toBeGreaterThan(5 * rough.read.detail![0].first);
    });

    it("where the line of the texture lies: what the gains reach is composed", async () => {
      // Against grain of 10 levels, 6 is composed and turned up as far as the gains go, 5 is refused;
      // against grain of 3 levels, 12 is composed and turned down as far as they go, 20 is refused.
      refused(grain(plain(), 10, 1), MARK, grain(plain(), 5, 2), "texture");
      await turn();
      refused(grain(plain(), 3, 1), MARK, grain(plain(), 20, 2), "texture");
      await turn();
      const up = tried(grain(plain(), 10, 1), MARK, grain(plain(), 6, 2));
      expectPatched(up.made, up.first, grain(plain(), 10, 1), painted(MARK), 25);
      for (const gain of up.made.read.gains as number[]) { expect(gain).toBeGreaterThan(1.2); expect(gain).toBeLessThanOrEqual(STROKES_RULE.gainMax); }
      await turn();
      const down = tried(grain(plain(), 3, 1), MARK, grain(plain(), 12, 2));
      expectPatched(down.made, down.first, grain(plain(), 3, 1), painted(MARK), 12);
      for (const gain of down.made.read.gains as number[]) { expect(gain).toBeLessThan(0.3); expect(gain).toBeGreaterThanOrEqual(STROKES_RULE.gainMin); }
      // And a strength under one level is held against nothing: a plain first picture composes with a cleaned picture of a few levels of grain.
      await turn();
      const calm = tried(plain(), MARK, grain(plain(), 3, 2));
      expectPatched(calm.made, calm.first, plain(), painted(MARK), 3);
      expect(calm.made.read.detail![0]).toEqual({ first: 0, cleaned: 0.94 });
    });

    it("when the two pictures are not one size", () => {
      const first = MARK(plain());
      const made = composeStrokes(first, flat(W, H - 4, GROUND), null);
      expect([made.picture, made.read.why]).toEqual([null, "pair"]);
    });
  });
});

describe("composeFirstOrStrokes", () => {
  const SLOT: Rect = { x: 290, y: 40, width: 60, height: 24 };
  /** A step that must not be run. */
  const never = (() => { throw new Error("the strokes step was run"); }) as typeof composeStrokes;
  /** The strokes step, counting its runs. */
  const counted = () => {
    const runs: Array<Rect | null> = [];
    const step: typeof composeStrokes = (first, cleaned, found, rule) => { runs.push(found); return composeStrokes(first, cleaned, found, rule); };
    return { runs, step };
  };

  it("answers a pair the rectangle rule composes exactly as that rule does, and never runs the step", async () => {
    // The drawing in its slot, found or not, and a drawing away from the slot on a plain ground: all three are the rule's own.
    const at: Rect = { x: 118, y: 58, width: 110, height: 36 };
    for (const [slot, found, y] of [[at, true, 60], [at, false, 60], [{ x: 260, y: 40, width: 120, height: 40 }, false, 300]] as Array<[Rect, boolean, number]>) {
      await turn();
      const first = word(120, y)(plain()), cleaned = cast(plain());
      const was = composeFirst(copyOf(first), cleaned, slot, found), now = composeFirstOrStrokes(copyOf(first), cleaned, slot, found, never);
      expect(was.facts.made).toBe(true);
      expect(now.facts).toEqual(was.facts);
      expect(now.facts.by).toBeUndefined();
      expect(now.facts.measured?.strokes).toBeUndefined();
      expect(same(now.picture as Raster, was.picture as Raster)).toBe(true);
    }
  });

  it("never runs the step when the rule composed nothing for a reason about the pictures or the slot", () => {
    const first = word(120, 60)(plain());
    expect(composeFirstOrStrokes(copyOf(first), flat(W, H - 4, GROUND), SLOT, false, never).facts).toEqual({ made: false, why: "size", share: 0, join: 0 });
    expect(composeFirstOrStrokes(copyOf(first), cast(plain()), { x: W + 10, y: 10, width: 60, height: 24 }, false, never).facts).toEqual({ made: false, why: "slot", share: 0, join: 0 });
  });

  it("composes a logo the model drew away from the slot and wider than a slot's place: the rule's \"removal\", and the slot is not touched", () => {
    // Six letters, 126 pixels wide, low on the picture; the slot is at the top and its place is never wider than 108.
    const draw = word(120, 300, 6), first = draw(plain()), cleaned = cast(plain());
    const was = composeFirst(copyOf(first), cleaned, SLOT, false);
    expect(was.facts).toMatchObject({ made: false, why: "removal", removed: 0 });
    const { runs, step } = counted();
    const now = composeFirstOrStrokes(copyOf(first), cleaned, SLOT, false, step);
    expect(runs).toEqual([null]);
    // A composed picture like any other, made this way; what the rule measured is kept beside what the step read.
    const { measured: _read, why: _why, ...rest } = was.facts;
    expect(now.facts).toEqual({
      ...rest, made: true, by: "strokes", share: now.facts.share, box: { x: 104, y: 284, width: 158, height: 64 },
      measured: { ...was.facts.measured, strokes: { instead: "removal", agree: 0.0167, cluster: { x: 120, y: 300, width: 126, height: 32 }, area: 1488, second: 0, fill: 0.363, core: 1488, dilate: 4, shift: { x: 0, y: 0, share: 1 }, gains: [1, 1], detail: [{ first: 0, cleaned: 0 }, { first: 0, cleaned: 0 }], left: 0 } },
    });
    expect(now.facts.why).toBeUndefined();
    expect(was.facts.measured?.elsewhere).toBeDefined();
    expect(now.facts.share).toBeGreaterThan(0.02);
    expectPatched({ picture: now.picture, box: now.facts.box, share: now.facts.share, read: now.facts.measured!.strokes! }, first, plain(), painted(draw), 0);
    // The slot, where the brand's file is stamped, is the first picture's own pixels.
    for (let y = SLOT.y; y < SLOT.y + SLOT.height; y++) for (let x = SLOT.x; x < SLOT.x + SLOT.width; x++) expect(now.picture!.data[(y * W + x) * 4]).toBe(first.data[(y * W + x) * 4]);
  });

  it("composes a logo drawn larger than the slot: the rule's \"join\", found or not", async () => {
    // Seven letters 44 high around a slot of 60 by 24: the slot holds the removal, and the ring around it crosses the letters.
    const draw = word(120, 60, 7, 44), first = draw(plain()), cleaned = cast(plain()), slot: Rect = { x: 170, y: 68, width: 60, height: 24 };
    for (const found of [false, true]) {
      await turn();
      const was = composeFirst(copyOf(first), cleaned, slot, found);
      expect(was.facts).toMatchObject({ made: false, why: "join" });
      const { runs, step } = counted();
      const now = composeFirstOrStrokes(copyOf(first), cleaned, slot, found, step);
      // The step hears the found rectangle only when the search found the drawing.
      expect(runs).toEqual([found ? slot : null]);
      expect(now.facts).toMatchObject({ made: true, by: "strokes", join: was.facts.join, removed: was.facts.removed, measured: { ring: was.facts.measured!.ring, strokes: { instead: "join", cluster: { x: 120, y: 60, width: 148, height: 44 } } } });
      expectPatched({ picture: now.picture, box: now.facts.box, share: now.facts.share, read: now.facts.measured!.strokes! }, first, plain(), painted(draw), 0);
    }
  });

  it("answers a found wordmark on gravel the redraw rendered again as the rule does: \"join\", and the design is made again as before", async () => {
    const draw = word(120, 60), bare = gravel(plain(), 40, 1), first = draw(copyOf(bare)), cleaned = gravel(plain(), 40, 2), slot: Rect = { x: 120, y: 60, width: 104, height: 32 };
    const was = composeFirst(copyOf(first), cleaned, slot, true);
    expect(was.facts).toMatchObject({ made: false, why: "join" });
    expect(was.facts.join).toBeGreaterThan(20);
    const { runs, step } = counted();
    const given = copyOf(first), now = composeFirstOrStrokes(given, cleaned, slot, true, step);
    // The step was tried, refused the coarse ground, and the answer is the rule's own object, with the first picture as it was.
    expect(runs).toEqual([slot]);
    expect(composeStrokes(copyOf(first), cleaned, slot).read.why).toBe("texture");
    expect(now.facts).toEqual(was.facts);
    expect(now.picture).toBeNull();
    expect(same(given, first)).toBe(true);
  });

  it("answers exactly as the rule does when the step composes nothing, with the first picture as it was", async () => {
    const cases: Array<[string, Raster, Raster, Rect, boolean]> = [
      // No logo at all.
      ["none", plain(), cast(plain()), SLOT, false],
      // The mark twice, both away from the slot.
      ["second", all(word(120, 300, 6), word(380, 150, 6))(plain()), cast(plain()), SLOT, false],
      // A drawing wider than a slot's place, on a cleaned picture that came back far smoother.
      ["texture", word(120, 300, 6)(grain(plain(), 10, 1)), grain(plain(), 3, 2), SLOT, false],
      // The search found a drawing at the slot (a busy ring refuses the rectangle), and what the cleaning took out lies elsewhere.
      ["place", word(120, 300, 6)(gravel(plain(), 40, 1)), gravel(plain(), 40, 2), { x: 280, y: 60, width: 104, height: 32 }, true],
      // A tagline standing apart under the wordmark: over a twelfth of it, and it would be left.
      ["second", all(word(120, 300, 6), (r) => { for (let k = 0; k < 7; k++) box(r, 130 + k * 8, 362, 133 + k * 8, 370, INK); return r; })(plain()), cast(plain()), SLOT, false],
      // A horizon behind the wordmark, and the cleaned picture 6 pixels lower.
      ["shifted", word(120, 300, 6)(box(plain(), 0, 316, W, H, [200, 170, 120])), cast(box(plain(), 0, 322, W, H, [200, 170, 120])), SLOT, false],
      // A ground of coarse blotches.
      ["texture", word(120, 300, 6)(gravel(plain(), 30, 1)), cast(gravel(plain(), 30, 1)), SLOT, false],
    ];
    for (const [why, first, cleaned, slot, found] of cases) {
      await turn();
      const was = composeFirst(copyOf(first), cleaned, slot, found);
      expect(["removal", "join"], why).toContain(was.facts.why);
      const { runs, step } = counted();
      const given = copyOf(first), now = composeFirstOrStrokes(given, cleaned, slot, found, step);
      expect(runs.length, why).toBe(1);
      expect(composeStrokes(copyOf(first), cleaned, found ? slot : null).read.why, why).toBe(why);
      expect(now.facts, why).toEqual(was.facts);
      expect(now.picture, why).toBeNull();
      expect(same(given, first), why).toBe(true);
    }
  });

  it("is, on every generated pair, the rule's own answer or a first picture composed by the step where the rule answered \"removal\" or \"join\"", async () => {
    const next = seeded(20261118);
    const tally: Record<string, number> = {};
    for (let run = 0; run < 36; run++) {
      await turn();
      const w = 520 + 4 * next(40), h = 440 + 4 * next(30);
      const paper: Rgb = [40 + next(160), 40 + next(160), 40 + next(160)];
      const ink: Rgb = [paper[0] > 128 ? 12 : 244, paper[1] > 128 ? 12 : 244, paper[2] > 128 ? 12 : 244];
      const ground = [0, 0, 1, 2][next(4)], rough = 2 + next(5);
      const draw = (seed: number) => {
        const r = flat(w, h, paper);
        if (ground === 1) gravel(r, 36, seed);
        if (ground === 2) stars(r, 30, seed);
        return grain(r, rough, seed + 1);
      };
      const first = draw(100 + run), cleaned = cast(draw(900 + run), [next(7) - 3, next(7) - 3, next(7) - 3]);
      // A wordmark at the slot, over a small slot and larger than its place, away from it, twice, or none.
      const kind = run % 6;
      const slot: Rect = { x: 60 + next(w - 260), y: 30 + next(60), width: kind === 1 ? 60 : 60 + next(60), height: kind === 1 ? 24 : 24 + next(16) };
      if (kind === 0) word(slot.x + 2, slot.y + 2, 2 + next(2), Math.min(slot.height - 4, 28), ink)(first);
      if (kind === 1) word(slot.x - 30, slot.y - 4, 6, 30, ink)(first);
      if (kind === 2 || kind === 3) word(40 + next(w - 220), h - 110 + next(40), 5 + next(3), 26 + next(8), ink)(first);
      if (kind === 3) word(40 + next(w - 220), 150 + next(30), 5, 30, ink)(first);
      if (kind === 4) box(first, 30 + next(w - 80), 140 + next(h - 200), 36 + next(w - 80), 146 + next(h - 200), ink);
      for (const found of [false, true]) {
        const was = composeFirst(copyOf(first), cleaned, slot, found);
        const { runs, step } = counted();
        const given = copyOf(first), now = composeFirstOrStrokes(given, cleaned, slot, found, step);
        const key = `${was.facts.made ? "composed" : was.facts.why} then, ${now.facts.made ? `composed${now.facts.by ? " by strokes" : ""}` : now.facts.why} now`;
        tally[key] = (tally[key] ?? 0) + 1;
        if (was.facts.made) {
          // Composed by the rule: the same answer and the same bytes, and the step was not run.
          expect(runs.length, key).toBe(0);
          expect(now.facts, key).toEqual(was.facts);
          expect(same(now.picture as Raster, was.picture as Raster), key).toBe(true);
        } else if (!now.facts.made) {
          // Not composed: the rule's answer to the last number, and the first picture untouched.
          expect(now.facts, key).toEqual(was.facts);
          expect(now.picture, key).toBeNull();
          expect(same(given, first), key).toBe(true);
          expect(runs.length, key).toBe(was.facts.why === "removal" || was.facts.why === "join" ? 1 : 0);
        } else {
          // Composed by the step: only where the rule answered "removal" or "join", and the first picture outside the box.
          expect(["removal", "join"], key).toContain(was.facts.why);
          expect(now.facts, key).toMatchObject({ by: "strokes", join: was.facts.join, measured: { strokes: { instead: was.facts.why } } });
          expect(now.facts.share).toBeLessThanOrEqual(STROKES_RULE.maxMask);
          const patch = now.facts.box as Rect;
          let beyond = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const p = (y * w + x) * 4;
            if (!inside(patch, x, y) && (now.picture!.data[p] !== first.data[p] || now.picture!.data[p + 1] !== first.data[p + 1] || now.picture!.data[p + 2] !== first.data[p + 2] || now.picture!.data[p + 3] !== first.data[p + 3])) beyond++;
          }
          expect(beyond, key).toBe(0);
        }
      }
    }
    // Each kind of outcome was reached.
    for (const key of ["composed then, composed now", "removal then, removal now", "removal then, composed by strokes now", "join then, composed by strokes now"]) expect(tally[key] ?? 0, `${key} in ${JSON.stringify(tally)}`).toBeGreaterThan(0);
    // And no other kind: nothing the rule composed is answered differently, and nothing is refused for another reason than the rule's.
    for (const key of Object.keys(tally)) expect(key).toMatch(/^(composed then, composed now|(\w+) then, \2 now|(removal|join) then, composed by strokes now)$/);
  }, 120_000);
});
