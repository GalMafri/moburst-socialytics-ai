// @vitest-environment node
// The making rule: a recolored copy of a stored logo for the ground it was
// not made for, and one in white. Only ink color changes; every shape and
// every alpha is the stored file's. Rasters are drawn here, in made-up colors.
import { describe, expect, it } from "vitest";
import { contrast } from "../../../functions/_shared/lifecycle/designSettings";
import type { Rgb } from "../../../functions/_shared/picture/contract";
import { DARK, INK_ALPHA, LIGHT, isSmall, partsOf, type Raster } from "../../../functions/_shared/design/logoTone";
import { changedShare, makeCopies, paint, recolor } from "../../../functions/_shared/design/logoCopies";
import { blank, box } from "./draw";

const WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0], INK_DARK: Rgb = [11, 14, 26];
const make = (r: Raster) => makeCopies(r, partsOf(r));

/** The color of every ink pixel inside a rectangle, as a set of "r,g,b". */
function colorsIn(r: Raster, x0: number, y0: number, x1: number, y1: number): string[] {
  const seen = new Set<string>();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * r.width + x) * 4;
    if (r.data[i + 3] >= INK_ALPHA) seen.add(`${r.data[i]},${r.data[i + 1]},${r.data[i + 2]}`);
  }
  return [...seen].sort();
}
const all = (r: Raster) => colorsIn(r, 0, 0, r.width, r.height);
const alphaOf = (r: Raster) => Array.from(r.data.filter((_, i) => i % 4 === 3));

/**
 * The spec's drawn fixture: a white wordmark of six bars over a gray tagline
 * of sixteen small bars, drawn four times too large and averaged down, so
 * its edges are blended. Each pixel carries its color times its coverage and
 * alpha of 255 times its coverage, both rounded.
 */
function wordmarkAndTagline(): Raster {
  const W = 240, H = 96, K = 4;
  const cov = new Float32Array(W * H), col = new Float32Array(W * H * 3);
  const rects: Array<[number, number, number, number, Rgb]> = [];
  for (let i = 0; i < 6; i++) rects.push([42 + 140 * i, 42, 132 + 140 * i, 230, [255, 255, 255]]);
  for (let j = 0; j < 16; j++) rects.push([322 + 36 * j, 282, 342 + 36 * j, 322, [179, 179, 179]]);
  for (const [x0, y0, x1, y1, c] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = Math.floor(y / K) * W + Math.floor(x / K);
      cov[p] += 1 / (K * K);
      col[p * 3] = c[0]; col[p * 3 + 1] = c[1]; col[p * 3 + 2] = c[2];
    }
  }
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const c = cov[p];
    d[p * 4] = Math.round(col[p * 3] * c); d[p * 4 + 1] = Math.round(col[p * 3 + 1] * c); d[p * 4 + 2] = Math.round(col[p * 3 + 2] * c);
    d[p * 4 + 3] = Math.round(255 * c);
  }
  return { width: W, height: H, data: d };
}

describe("the making rule", () => {
  it("leaves the stored file untouched", () => {
    const stored = box(box(blank(40, 20), 2, 2, 20, 18, [40, 170, 120]), 22, 2, 38, 18, BLACK);
    const before = new Uint8ClampedArray(stored.data);
    const copies = make(stored);
    expect(copies.other).not.toBeNull();
    expect(Array.from(stored.data)).toEqual(Array.from(before));
    expect(copies.other!.raster.data).not.toBe(stored.data);
  });

  it("turns a dark one-color logo white for a dark ground", () => {
    // A flat mark with a soft edge of the same color.
    const stored = box(box(blank(30, 12), 2, 2, 28, 10, [24, 28, 40]), 1, 2, 2, 10, [24, 28, 40], 120);
    const copies = make(stored);
    expect(copies.own).toBe("light");
    expect(copies.both).toBe(false);
    expect(all(copies.other!.raster)).toEqual(["255,255,255"]);
    expect(copies.other!.turned).toBe(1);
    expect(copies.white).toBeNull();
  });

  it("keeps a color that shows and turns a black letter beside it white", () => {
    const color: Rgb = [40, 170, 120];
    expect(contrast(color, DARK)).toBeGreaterThanOrEqual(3);
    expect(contrast(BLACK, DARK)).toBeLessThan(3);
    const stored = box(box(blank(60, 20), 2, 2, 30, 18, color), 34, 2, 58, 18, BLACK);
    const copies = make(stored);
    expect(copies.own).toBe("light");
    expect(colorsIn(copies.other!.raster, 2, 2, 30, 18)).toEqual(["40,170,120"]);
    expect(colorsIn(copies.other!.raster, 34, 2, 58, 18)).toEqual(["255,255,255"]);
    expect(copies.other!.turned).toBeCloseTo((24 * 16) / (28 * 16 + 24 * 16), 10);
    // The white copy turns the color too, so it is a file of its own.
    expect(all(copies.white!.raster)).toEqual(["255,255,255"]);
    expect(copies.white!.turned).toBe(1);
  });

  it("makes a near-black copy of a one-color logo that has 2.2:1 on white", () => {
    const color: Rgb = [70, 190, 215];
    expect(contrast(color, LIGHT)).toBeGreaterThan(2);
    expect(contrast(color, LIGHT)).toBeLessThan(3);
    const copies = make(box(blank(40, 14), 2, 2, 38, 12, color));
    expect(copies.own).toBe("dark");
    expect(copies.both).toBe(false);
    expect(all(copies.other!.raster)).toEqual(["11,14,26"]);
    expect(all(copies.white!.raster)).toEqual(["255,255,255"]);
  });

  it("never splits a gradient", () => {
    // From a blue that shows on dark to a navy that does not, in steps under 16: one part.
    const stored = blank(64, 10);
    for (let x = 2; x < 62; x++) for (let y = 2; y < 8; y++) stored.data.set([10 + x, 20 + 2 * x, 60 + 3 * x, 255], (y * 64 + x) * 4);
    expect(contrast([12, 24, 66], DARK)).toBeLessThan(3);
    expect(contrast([71, 142, 243], DARK)).toBeGreaterThan(3);
    expect(partsOf(stored).parts).toHaveLength(1);
    const copies = make(stored);
    for (const copy of [copies.other, copies.white]) {
      if (!copy) continue;
      let changed = 0, ink = 0;
      for (let i = 0; i < stored.data.length; i += 4) {
        if (stored.data[i + 3] < INK_ALPHA) continue;
        ink++;
        if (copy.raster.data[i] !== stored.data[i] || copy.raster.data[i + 1] !== stored.data[i + 1] || copy.raster.data[i + 2] !== stored.data[i + 2]) changed++;
      }
      expect(changed === 0 || changed === ink).toBe(true);
    }
    // The whole gradient turns for the dark ground, although one end of it shows there.
    expect(all(copies.other!.raster)).toEqual(["255,255,255"]);
  });

  it("leaves white letters inside a box alone when the box shows on both grounds", () => {
    const mid: Rgb = [40, 120, 235];
    expect(contrast(mid, LIGHT)).toBeGreaterThanOrEqual(3);
    expect(contrast(mid, DARK)).toBeGreaterThanOrEqual(3);
    const stored = box(box(box(blank(60, 30), 2, 2, 58, 28, mid), 10, 10, 22, 20, WHITE), 34, 10, 46, 20, WHITE);
    const copies = make(stored);
    expect(copies.both).toBe(true);
    expect(copies.other).toBeNull();
    expect(colorsIn(copies.white!.raster, 2, 2, 58, 10)).toEqual(["255,255,255"]);
    expect(colorsIn(copies.white!.raster, 10, 10, 22, 20)).toEqual(["11,14,26"]);
    expect(colorsIn(copies.white!.raster, 34, 10, 46, 20)).toEqual(["11,14,26"]);
  });

  it("turns a black box white and its white letters dark for a dark ground", () => {
    const stored = box(box(blank(60, 30), 2, 2, 58, 28, BLACK), 14, 10, 40, 20, WHITE);
    const copies = make(stored);
    expect(copies.own).toBe("light");
    expect(colorsIn(copies.other!.raster, 2, 2, 58, 10)).toEqual(["255,255,255"]);
    expect(colorsIn(copies.other!.raster, 14, 10, 40, 20)).toEqual(["11,14,26"]);
  });

  it("gives a blended pixel between a kept color and a turned one the same mix of the kept color and the new one", () => {
    const kept: Rgb = [40, 170, 120], half: Rgb = [20, 85, 60];
    // A kept color on the left and black on the right, touching. One half-and-half pixel sits in the black, one in the color.
    const stored = box(box(blank(64, 24), 2, 2, 32, 22, kept), 32, 2, 62, 22, BLACK);
    box(stored, 32, 10, 33, 11, half); // three edges on black, one on the color
    box(stored, 31, 14, 32, 15, half); // three edges on the color, one on black
    const parts = partsOf(stored);
    expect(parts.parts).toHaveLength(4);
    expect(parts.parts.filter((p) => isSmall(parts, p))).toHaveLength(2);
    const copies = make(stored);
    const at = (x: number, y: number) => Array.from(copies.other!.raster.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3));
    // Half the kept color and half black becomes half the kept color and half white, on whichever side the pixel sits.
    const mixed = [Math.round((40 + 255) / 2), Math.round((170 + 255) / 2), Math.round((120 + 255) / 2)];
    expect(at(32, 10)).toEqual(mixed);
    expect(at(31, 14)).toEqual(mixed);
    expect(at(40, 10)).toEqual([255, 255, 255]);
    expect(at(10, 10)).toEqual(kept);
    // No pixel of the old blend is left where the two colors meet.
    expect(all(copies.other!.raster)).toEqual([kept.join(","), mixed.join(","), "255,255,255"].sort());
  });

  it("keeps the mix across a blend two pixels wide", () => {
    const kept: Rgb = [40, 170, 120];
    const mixOf = (share: number, to: Rgb) => kept.map((v, i) => Math.round(v * share + to[i] * (1 - share)));
    const stored = box(box(blank(64, 24), 2, 2, 32, 22, kept), 32, 2, 62, 22, BLACK);
    box(stored, 31, 8, 32, 14, mixOf(0.75, BLACK) as Rgb); // three quarters of the kept color, beside it
    box(stored, 32, 8, 33, 14, mixOf(0.25, BLACK) as Rgb); // one quarter, beside the black
    const parts = partsOf(stored);
    expect(parts.parts.filter((p) => isSmall(parts, p))).toHaveLength(2);
    const copy = make(stored).other!.raster;
    const at = (x: number, y: number) => Array.from(copy.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3));
    for (const [x, share] of [[31, 0.75], [32, 0.25]] as const) {
      const want = mixOf(share, WHITE);
      at(x, 10).forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(2));
    }
    // The copy grows lighter from the kept color to the white, with no dark pixel between them.
    expect(at(31, 10)[0]).toBeGreaterThan(40);
    expect(at(32, 10)[0]).toBeGreaterThan(at(31, 10)[0]);
  });

  it("gives a small part that is no blend of its two sides the outcome of the side it shares more edges with", () => {
    const kept: Rgb = [40, 170, 120], dot: Rgb = [200, 30, 30];
    const stored = box(box(blank(64, 24), 2, 2, 32, 22, kept), 32, 2, 62, 22, BLACK);
    box(stored, 32, 10, 33, 11, dot); // three edges on black, one on the color
    box(stored, 31, 14, 32, 15, dot); // three edges on the color, one on black
    const copies = make(stored);
    const at = (x: number, y: number) => Array.from(copies.other!.raster.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3));
    expect(at(32, 10)).toEqual([255, 255, 255]);
    expect(at(31, 14)).toEqual(dot);
  });

  it("turns a wordmark and its small gray tagline as one", () => {
    const stored = wordmarkAndTagline();
    const parts = partsOf(stored);
    const small = parts.parts.filter((p) => isSmall(parts, p));
    expect(parts.parts).toHaveLength(180);
    expect(small).toHaveLength(174);
    expect(small.reduce((s, p) => s + p.ink, 0) / parts.ink).toBeCloseTo(0.15, 3);
    const copies = make(stored);
    expect(copies.own).toBe("dark");
    let ink = 0, dark = 0;
    const d = copies.other!.raster.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < INK_ALPHA) continue;
      ink++;
      if (d[i] === 11 && d[i + 1] === 14 && d[i + 2] === 26) dark++;
    }
    expect(ink).toBe(7680);
    expect(dark).toBe(7680);
    expect(copies.white).toBeNull();
    // Judging each part alone by its own color on white would leave the darker edge pixels of the small letters as they are.
    let alone = 0;
    for (const p of parts.parts) if (contrast(p.color, LIGHT) < 3) alone += p.ink;
    expect(alone / parts.ink).toBeCloseTo(0.93, 3);
  });

  it("judges a group of small parts by its largest member", () => {
    const gray: Rgb = [179, 179, 179], edge: Rgb = [90, 90, 90];
    expect(contrast(gray, LIGHT)).toBeLessThan(3);
    expect(contrast(edge, LIGHT)).toBeGreaterThanOrEqual(3);
    // A white wordmark, and two small letters far from it: one with a gray body and a darker edge, one the other way around.
    const stored = box(blank(90, 50), 2, 2, 62, 42, WHITE);
    box(box(stored, 70, 4, 74, 7, gray), 74, 4, 75, 7, edge);
    box(box(stored, 70, 20, 74, 23, edge), 74, 20, 75, 23, gray);
    const parts = partsOf(stored);
    expect(parts.parts.filter((p) => isSmall(parts, p))).toHaveLength(4);
    const copies = make(stored);
    expect(copies.own).toBe("dark");
    // The gray body does not show on white, so its darker edge turns with it.
    expect(colorsIn(copies.other!.raster, 70, 4, 75, 7)).toEqual(["11,14,26"]);
    // The dark body shows on white, so its gray edge stays with it.
    expect(colorsIn(copies.other!.raster, 70, 20, 75, 23)).toEqual(["179,179,179", "90,90,90"]);
    expect(colorsIn(copies.other!.raster, 2, 2, 62, 42)).toEqual(["11,14,26"]);
  });

  it("never changes alpha", () => {
    const stored = wordmarkAndTagline();
    const two = box(box(blank(60, 20), 2, 2, 30, 18, [40, 170, 120], 200), 34, 2, 58, 18, BLACK, 77);
    for (const file of [stored, two]) {
      const copies = make(file);
      for (const copy of [copies.other, copies.white]) if (copy) expect(alphaOf(copy.raster)).toEqual(alphaOf(file));
    }
    expect(make(two).white).not.toBeNull();
  });

  it("drops a copy that changes no whole part by more than 16 per channel", () => {
    // A mid-tone that shows on both grounds: nothing turns for the other ground.
    expect(make(box(blank(20, 10), 2, 2, 18, 8, [40, 120, 235])).other).toBeNull();
    // A near-white file: its white copy moves no channel by more than 16.
    const nearWhite = make(box(blank(20, 10), 2, 2, 18, 8, [244, 246, 250]));
    expect(nearWhite.own).toBe("dark");
    expect(all(nearWhite.other!.raster)).toEqual(["11,14,26"]);
    expect(nearWhite.white).toBeNull();
  });

  it("drops the white copy when it is the copy for the other ground", () => {
    const copies = make(box(blank(20, 10), 2, 2, 18, 8, [30, 30, 30]));
    expect(all(copies.other!.raster)).toEqual(["255,255,255"]);
    expect(copies.white).toBeNull();
  });

  it("gives the same pixels for the same file", () => {
    const a = make(wordmarkAndTagline()), b = make(wordmarkAndTagline());
    expect(Array.from(a.other!.raster.data)).toEqual(Array.from(b.other!.raster.data));
    expect(a.other!.turned).toBe(b.other!.turned);
  });

  it("measures the change between two colorings over whole parts only", () => {
    const stored = box(box(blank(64, 24), 2, 2, 32, 22, [40, 170, 120]), 34, 2, 62, 22, BLACK);
    box(stored, 33, 10, 34, 11, [20, 85, 60]);
    const parts = partsOf(stored);
    const base = parts.parts.map((p) => p.color);
    const coloring = recolor(parts, "dark", "shows");
    expect(coloring.turned).toEqual([false, true, true]);
    expect(changedShare(parts, base, coloring.colors)).toBeCloseTo((28 * 20) / parts.ink, 10);
    expect(changedShare(parts, base, base)).toBe(0);
    const painted = paint(stored, parts, coloring);
    expect(Array.from(painted.data.slice((10 * 64 + 33) * 4, (10 * 64 + 33) * 4 + 4))).toEqual([255, 255, 255, 255]);
  });
});
