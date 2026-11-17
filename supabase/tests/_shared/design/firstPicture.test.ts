// The first picture as the base (17 Nov 2026, spec 2026-11-16-logo-tone-design.md, section 14).
// Pictures are drawn here, in made-up neutral colors: a first picture with a
// drawn logo in its slot, and "cleaned" pictures that differ from it the way
// a redraw does (grain, a color cast, edges and thin strokes a few pixels off).
import { describe, expect, it } from "vitest";
import type { Rect, Rgb } from "../../../functions/_shared/picture/contract";
import type { Raster } from "../../../functions/_shared/design/logoTone";
import { FIRST_PICTURE_RULE, composeFirst, patchReach } from "../../../functions/_shared/design/firstPicture";
import { composeFirst as composeBefore } from "./firstPictureBefore";
import { box, copyOf, flat } from "./draw";

const W = 400, H = 320;
const GROUND: Rgb = [60, 90, 150];
const SLOT: Rect = { x: 140, y: 40, width: 120, height: 40 };

/** A generator of whole numbers, the same on every run. */
function seeded(seed: number): (below: number) => number {
  let s = seed >>> 0;
  return (below) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 4294967296) * below);
  };
}

/** Grain a redraw adds: each channel of each pixel moved by up to `by` levels, the same way every run. */
function grain(r: Raster, by: number, seed = 7): Raster {
  const next = seeded(seed);
  for (let i = 0; i < r.data.length; i += 4) for (let c = 0; c < 3; c++) r.data[i + c] = r.data[i + c] + next(2 * by + 1) - by;
  return r;
}

/** Every channel moved by the same amounts: a redraw's color cast. */
function cast(r: Raster, by: Rgb): Raster {
  for (let i = 0; i < r.data.length; i += 4) for (let c = 0; c < 3; c++) r.data[i + c] = r.data[i + c] + by[c];
  return r;
}

/** The scene both pictures show: a ground, a dark object with a hard edge, a lighter band. */
function scene(edgeAt = 300): Raster {
  const r = flat(W, H, GROUND);
  box(r, edgeAt, 120, W, 260, [20, 24, 30]);
  box(r, 0, 280, W, H, [200, 205, 210]);
  return r;
}

/** The model's logo drawing in the slot: three white bars. */
function withLogo(r: Raster): Raster {
  box(r, 150, 46, 180, 74, [255, 255, 255]);
  box(r, 190, 46, 215, 74, [255, 255, 255]);
  box(r, 225, 52, 250, 74, [255, 255, 255]);
  return r;
}

/** A line of text 56 pixels high, as thin strokes: stems 6 pixels wide and bars 5 pixels high, starting at `x`. */
function textLine(r: Raster, x: number, y: number, color: Rgb): Raster {
  for (let k = 0; k < 6; k++) {
    const at = x + k * 34;
    box(r, at, y, at + 6, y + 56, color);
    box(r, at, y, at + 24, y + 5, color);
    if (k % 2) box(r, at, y + 26, at + 20, y + 31, color);
  }
  return r;
}

function pixel(r: Raster, x: number, y: number): number[] {
  const p = (y * r.width + x) * 4;
  return [r.data[p], r.data[p + 1], r.data[p + 2]];
}

/** Whole cells of the picture (4 pixels a side) moved by `by` levels on every channel: ink the removal took out, or a point of light. */
function cellsInked(r: Raster, cells: Array<[number, number]>, by = 60): Raster {
  for (const [cx, cy] of cells) {
    for (let y = cy * 4; y < cy * 4 + 4; y++) for (let x = cx * 4; x < cx * 4 + 4; x++) {
      if (x >= r.width || y >= r.height) continue;
      const p = (y * r.width + x) * 4;
      for (let c = 0; c < 3; c++) r.data[p + c] = r.data[p + c] + by;
    }
  }
  return r;
}

/** A block of whole cells, `w` wide and `h` high, from cell (cx, cy). */
function block(cx: number, cy: number, w: number, h: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) cells.push([x, y]);
  return cells;
}

/**
 * Points of light over a picture, or over a band of it (`fromY` to `toY`),
 * the same on every run: `count` single cells, none touching another (each
 * is alone in its block of three cells by three), each 90 levels lighter. A
 * redraw leaves some out and adds others, so two pictures given different
 * seeds differ on single cells everywhere.
 */
function stars(r: Raster, count: number, seed: number, fromY = 0, toY = r.height): Raster {
  const next = seeded(seed);
  const taken = new Set<number>();
  const across = Math.floor(r.width / 12), top = Math.ceil(fromY / 12), down = Math.floor(toY / 12) - top;
  for (let k = 0; k < count;) {
    const bx = next(across), by = top + next(down);
    if (taken.has(by * across + bx)) continue;
    taken.add(by * across + bx);
    cellsInked(r, [[bx * 3 + 1, by * 3 + 1]], 90);
    k++;
  }
  return r;
}

/** A small thin wordmark: `stems` stems one cell wide and `high` cells high, two cells apart, from cell (cx, cy). White on the ground. */
function thinLogo(r: Raster, cx: number, cy: number, stems: number, high: number): Raster {
  for (let k = 0; k < stems; k++) box(r, (cx + k * 2) * 4, cy * 4, (cx + k * 2) * 4 + 3, (cy + high) * 4, [255, 255, 255]);
  return r;
}

/** How a call ended, in one word: composed, or why not. */
function ended(facts: { made: boolean; why?: string }): string {
  return facts.made ? "composed" : (facts.why as string);
}

/** True when a pixel is within `by` pixels of a rectangle, across and down. */
function near(rect: Rect, by: number, x: number, y: number): boolean {
  return x >= rect.x - by && x < rect.x + rect.width + by && y >= rect.y - by && y < rect.y + rect.height + by;
}

/** Pixels that differ between two pictures of one size, counted apart for near the rectangle and beyond it. */
function differing(a: Raster, b: Raster, rect: Rect | null, by = 0): { near: number; beyond: number } {
  const count = { near: 0, beyond: 0 };
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const p = (y * a.width + x) * 4;
      if (a.data[p] === b.data[p] && a.data[p + 1] === b.data[p + 1] && a.data[p + 2] === b.data[p + 2] && a.data[p + 3] === b.data[p + 3]) continue;
      if (rect && near(rect, by, x, y)) count.near++; else count.beyond++;
    }
  }
  return count;
}

describe("the rule's numbers", () => {
  it("are the ones the spec states", () => {
    expect(FIRST_PICTURE_RULE).toEqual({ cell: 4, grow: 2, feather: 4, joinMax: 20, apartLevel: 48, apartCells: 4, removedShare: 0.2 });
    // 8 pixels of margin, 16 of ring, and under 8 for the cell grid.
    expect(patchReach()).toBe(32);
  });
});

describe("composeFirst", () => {
  it("delivers the first picture pixel for pixel outside the patch, and the cleaned pixels in the slot", () => {
    const first = grain(withLogo(scene()), 3, 1);
    const kept = copyOf(first);
    // The redraw: the logo gone, new grain everywhere.
    const cleaned = grain(scene(), 6, 2);
    const { picture, facts } = composeFirst(first, cleaned, SLOT, true);

    expect(facts.made).toBe(true);
    expect(facts.why).toBeUndefined();
    expect(picture).toBe(first);
    // Outside the patch nothing changed, although the cleaned picture differs at almost every pixel.
    const diff = differing(picture!, kept, facts.box!);
    expect(diff.beyond).toBe(0);
    expect(diff.near).toBeGreaterThan(0);
    expect(differing(cleaned, kept, null).beyond).toBeGreaterThan(W * H * 0.9);
    // The drawing is gone: where a bar was, the picture is the ground again.
    for (const [x, y] of [[160, 60], [200, 50], [240, 70]]) {
      for (const [c, v] of pixel(picture!, x, y).entries()) expect(Math.abs(v - GROUND[c])).toBeLessThanOrEqual(8);
    }
    // The patch is the slot with its margin and ring, and lies within the stated reach.
    expect(facts.box!.x).toBeGreaterThanOrEqual(SLOT.x - patchReach());
    expect(facts.box!.x + facts.box!.width).toBeLessThanOrEqual(SLOT.x + SLOT.width + patchReach());
    expect(facts.box!.y).toBeGreaterThanOrEqual(SLOT.y - patchReach());
    expect(facts.box!.y + facts.box!.height).toBeLessThanOrEqual(SLOT.y + SLOT.height + patchReach());
    expect(facts.share).toBeLessThan(0.15);
  });

  it("changes no pixel farther than the stated reach from the slot, whatever the two pictures show", () => {
    const next = seeded(20261117);
    const reach = patchReach();
    let composed = 0;
    for (let run = 0; run < 60; run++) {
      const w = 96 + next(200), h = 96 + next(200);
      // Two unrelated pictures: blocks of random colors with random grain, so they differ everywhere.
      const random = () => {
        const r = flat(w, h, [next(256), next(256), next(256)]);
        for (let k = 0; k < 12; k++) {
          const x = next(w), y = next(h);
          box(r, x, y, x + 1 + next(w), y + 1 + next(h), [next(256), next(256), next(256)]);
        }
        return grain(r, 1 + next(12), 1 + next(1000));
      };
      const first = random(), kept = copyOf(first), cleaned = random();
      // Slots of every kind: inside, across an edge, in a corner, as large as the picture, off it.
      const kind = run % 6;
      const slot: Rect = kind === 0 ? { x: next(w), y: next(h), width: 1 + next(w), height: 1 + next(h) }
        : kind === 1 ? { x: -next(40), y: next(h), width: 20 + next(80), height: 10 + next(40) }
        : kind === 2 ? { x: w - 10 - next(40), y: h - 10 - next(40), width: 20 + next(80), height: 20 + next(80) }
        : kind === 3 ? { x: 0, y: 0, width: 1 + next(60), height: 1 + next(30) }
        : kind === 4 ? { x: 30 + next(Math.max(1, w - 90)), y: 30 + next(Math.max(1, h - 70)), width: 8 + next(50), height: 4 + next(30) }
        : { x: w + next(50), y: next(h), width: 40, height: 20 };
      // Composed whatever the ring shows, so the pixels are written in every run that has a slot on the picture.
      const made = composeFirst(first, cleaned, slot, true, { ...FIRST_PICTURE_RULE, joinMax: 1000, apartCells: 1e9 });
      if (made.picture) composed++;
      expect(differing(first, kept, slot, reach).beyond).toBe(0);
      if (made.facts.box) {
        expect(differing(first, kept, made.facts.box).beyond).toBe(0);
        expect(near(slot, reach, made.facts.box.x, made.facts.box.y)).toBe(true);
        expect(near(slot, reach, made.facts.box.x + made.facts.box.width - 1, made.facts.box.y + made.facts.box.height - 1)).toBe(true);
      }
      // With the rule's own join test the same holds, and a refusal writes nothing at all.
      const again = copyOf(kept);
      const ruled = composeFirst(again, cleaned, slot, true);
      if (!ruled.picture) expect(differing(again, kept, null).beyond).toBe(0);
      else expect(differing(again, kept, slot, reach).beyond).toBe(0);
    }
    expect(composed).toBeGreaterThan(40);
  });

  it("never touches text the redraw only moved: the same thin line of words, 3 pixels off in the cleaned picture", () => {
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [3, 3], [2, -3]]) {
      for (const [ink, paper] of [[[250, 250, 250], GROUND], [[20, 20, 24], [226, 222, 214]], [[240, 60, 90], [30, 30, 36]]] as Array<[Rgb, Rgb]>) {
        const draw = (ox: number, oy: number, logo: boolean) => {
          const r = flat(W, H, paper);
          if (logo) withLogo(r);
          return textLine(r, 100 + ox, 180 + oy, ink);
        };
        const first = grain(draw(0, 0, true), 3, 11);
        const kept = copyOf(first);
        const cleaned = cast(grain(draw(dx, dy, false), 7, 12), [2, -3, 2]);
        const { picture, facts } = composeFirst(first, cleaned, SLOT, true);
        expect(facts.made).toBe(true);
        // Every pixel of the text's area is the first picture's own byte.
        const words: Rect = { x: 90, y: 170, width: 240, height: 80 };
        expect(differing(picture!, kept, words).near).toBe(0);
        expect(differing(picture!, kept, SLOT, patchReach()).beyond).toBe(0);
      }
    }
  });

  it("leaves a mark the removal took out somewhere else on the picture: only the slot is taken from the cleaned picture", () => {
    const first = withLogo(scene());
    box(first, 330, 180, 370, 196, [215, 215, 205]);
    const { picture, facts } = composeFirst(first, scene(), SLOT, true);
    expect(facts.made).toBe(true);
    // Still there: the read for marks judges this picture and finds it.
    expect(pixel(picture!, 336, 188)).toEqual([215, 215, 205]);
  });

  it("brings the patch to the first picture's color by the ring around it", () => {
    const first = withLogo(scene());
    // The cleaned picture came back with a cast of its own.
    const cleaned = cast(scene(), [4, -6, 5]);
    const { picture, facts } = composeFirst(first, cleaned, SLOT, true);
    expect(facts.made).toBe(true);
    expect(facts.join).toBe(0);
    // In the slot the cleaned pixel is used with the cast taken off: the first picture's own ground, exactly.
    expect(pixel(picture!, 160, 60)).toEqual(GROUND);
    expect(pixel(picture!, SLOT.x, SLOT.y)).toEqual(GROUND);
    expect(pixel(picture!, SLOT.x + SLOT.width - 1, SLOT.y + SLOT.height - 1)).toEqual(GROUND);
    // And so no pixel of the composed picture carries the cast.
    let withCast = 0;
    for (let i = 0; i < picture!.data.length; i += 4) if (picture!.data[i + 1] === GROUND[1] - 6) withCast++;
    expect(withCast).toBe(0);
  });

  it("fades the patch into the first picture across the ring", () => {
    // The two pictures differ on purpose by a plain step inside the slot's patch only: the cleaned slot is brighter.
    const first = scene();
    const cleaned = scene();
    box(cleaned, SLOT.x - 8, SLOT.y - 8, SLOT.x + SLOT.width + 8, SLOT.y + SLOT.height + 8, [120, 150, 210]);
    const { picture, facts } = composeFirst(first, cleaned, SLOT, true);
    expect(facts.made).toBe(true);
    const y = SLOT.y + 20;
    // Whole in the slot and its margin, the first picture past the ring, in between on the way.
    expect(pixel(picture!, SLOT.x, y)).toEqual([120, 150, 210]);
    expect(pixel(picture!, SLOT.x - 6, y)).toEqual([120, 150, 210]);
    expect(pixel(picture!, SLOT.x - 40, y)).toEqual(GROUND);
    const reds = [];
    for (let x = SLOT.x - 40; x <= SLOT.x; x++) reds.push(pixel(picture!, x, y)[0]);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeGreaterThanOrEqual(reds[i - 1]);
  });

  it("composes nothing when the ring around the slot does not show the same thing in both pictures", () => {
    // Stripes run through the slot's surroundings in the first picture; the cleaned picture has them 12 pixels off.
    const striped = (shift: number) => {
      const r = scene();
      for (let x = 100 + shift; x < 300; x += 24) box(r, x, 0, x + 12, 110, [230, 232, 236]);
      return r;
    };
    const one = withLogo(striped(0));
    const kept = copyOf(one);
    const made = composeFirst(one, striped(12), SLOT, true);
    expect(made.picture).toBeNull();
    expect(made.facts.made).toBe(false);
    expect(made.facts.why).toBe("join");
    expect(made.facts.join).toBeGreaterThan(FIRST_PICTURE_RULE.joinMax);
    expect(made.facts.box).toBeUndefined();
    // The first picture was not touched.
    expect(differing(one, kept, null).beyond).toBe(0);
    // The same stripes where they belong join cleanly.
    expect(composeFirst(withLogo(striped(0)), striped(0), SLOT, true).facts.made).toBe(true);
  });

  it("composes nothing when text the redraw moved lies inside the ring, although the ring's mean is low", () => {
    // A thin line of words 12 pixels under the slot, 3 pixels off in the cleaned picture (also 4 across and 2 down): dark on light, and white on the ground.
    for (const [dx, dy] of [[3, 0], [4, 2], [-3, 0]]) {
      for (const [ink, paper] of [[[20, 20, 24], [226, 222, 214]], [[250, 250, 250], GROUND]] as Array<[Rgb, Rgb]>) {
        const draw = (ox: number, oy: number, logo: boolean) => {
          const r = flat(W, H, paper);
          if (logo) withLogo(r);
          return textLine(r, 100 + ox, SLOT.y + SLOT.height + 12 + oy, ink);
        };
        const first = grain(draw(0, 0, true), 3, 21);
        const kept = copyOf(first);
        const made = composeFirst(first, grain(draw(dx, dy, false), 6, 22), SLOT, true);
        expect(made.picture).toBeNull();
        expect(made.facts.made).toBe(false);
        expect(made.facts.why).toBe("join");
        // At 3 pixels the mean alone would have let it through.
        if (Math.abs(dx) === 3) expect(made.facts.join).toBeLessThan(FIRST_PICTURE_RULE.joinMax);
        expect(differing(first, kept, null).beyond).toBe(0);
        // The same line where it belongs is no reason to refuse.
        expect(composeFirst(grain(draw(0, 0, true), 3, 21), grain(draw(0, 0, false), 6, 22), SLOT, true).facts.made).toBe(true);
      }
    }
  });

  it("allows four ring cells far apart and refuses five", () => {
    // Whole cells of the ring, left of the slot, differ by 60 levels in the cleaned picture.
    const cellsApart = (count: number) => {
      const cleaned = scene();
      for (let k = 0; k < count; k++) box(cleaned, 30 * 4, (11 + k) * 4, 31 * 4, (12 + k) * 4, [GROUND[0] + 60, GROUND[1], GROUND[2]]);
      return composeFirst(withLogo(scene()), cleaned, SLOT, true);
    };
    expect(cellsApart(4).facts.made).toBe(true);
    expect(cellsApart(5).facts).toMatchObject({ made: false, why: "join" });
    expect(cellsApart(5).facts.join).toBeLessThan(FIRST_PICTURE_RULE.joinMax);
    // At the level itself a cell is not apart: only over it.
    const at = scene();
    for (let k = 0; k < 8; k++) box(at, 30 * 4, (11 + k) * 4, 31 * 4, (12 + k) * 4, [GROUND[0] + 48, GROUND[1], GROUND[2]]);
    expect(composeFirst(withLogo(scene()), at, SLOT, true).facts.made).toBe(true);
  });

  describe("a slot the search did not find the drawing at (the canvas rectangle)", () => {
    it("is composed when the two pictures show the logo was removed inside it", () => {
      const first = grain(withLogo(scene()), 3, 31);
      const kept = copyOf(first);
      const { picture, facts } = composeFirst(first, cast(grain(scene(), 6, 32), [2, -3, 2]), SLOT, false);
      expect(facts.made).toBe(true);
      expect(facts.removed).toBeGreaterThanOrEqual(FIRST_PICTURE_RULE.removedShare);
      expect(differing(picture!, kept, facts.box!).beyond).toBe(0);
      for (const [c, v] of pixel(picture!, 160, 60).entries()) expect(Math.abs(v - GROUND[c])).toBeLessThanOrEqual(8);
    });

    it("is not composed when nothing was removed inside it: the model drew no logo, or drew it somewhere else", () => {
      // No logo at all: the two pictures differ only as a redraw does (grain, a cast, an edge 6 pixels off).
      const none = grain(scene(300), 3, 33);
      const keptNone = copyOf(none);
      const redraw = () => cast(grain(scene(294), 8, 34), [3, 3, -4]);
      const made = composeFirst(none, redraw(), SLOT, false);
      expect(made.picture).toBeNull();
      expect(made.facts).toMatchObject({ made: false, why: "removal", share: 0 });
      expect(made.facts.removed).toBeLessThan(0.05);
      expect(differing(none, keptNone, null).beyond).toBe(0);
      // The logo drawn below the rectangle and removed there: the rectangle itself shows no removal.
      const elsewhere = scene();
      box(elsewhere, 150, 130, 180, 158, [255, 255, 255]);
      box(elsewhere, 190, 130, 250, 158, [255, 255, 255]);
      expect(composeFirst(elsewhere, scene(), SLOT, false).facts).toMatchObject({ made: false, why: "removal", removed: 0 });
      // A found drawing's rectangle needs no such measure: the search is the fact.
      expect(composeFirst(grain(scene(300), 3, 33), redraw(), SLOT, true).facts.made).toBe(true);
    });

    it("with one fifth of its cells far apart is a place the logo was removed from, whatever else the pictures differ in", () => {
      // Whole cells of the slot (30 by 10 cells) lighter by 60 levels in the first picture, as ink that was removed, and the same
      // kind of difference in a place of the slot's size far below it.
      const inked = (count: number, below: number) => {
        const first = scene();
        for (let k = 0; k < count; k++) cellsInked(first, [[35 + (k % 10) * 2, 10 + Math.floor(k / 10)]]);
        for (let k = 0; k < below; k++) cellsInked(first, [[35 + (k % 10) * 2, 40 + Math.floor(k / 10)]]);
        return composeFirst(first, scene(), SLOT, false).facts;
      };
      // 60 of 300: composed, also with far more of it elsewhere, and nothing is read against the pair.
      expect(inked(60, 0)).toMatchObject({ made: true, removed: 0.2 });
      expect(inked(60, 100)).toMatchObject({ made: true, removed: 0.2 });
      expect(inked(60, 100).measured).toBeUndefined();
    });

    it("under one fifth is such a place only with clearly more cells far apart than any place of its size holds elsewhere", () => {
      const inked = (count: number, below: number) => {
        const first = scene();
        for (let k = 0; k < count; k++) cellsInked(first, [[35 + (k % 10) * 2, 10 + Math.floor(k / 10)]]);
        for (let k = 0; k < below; k++) cellsInked(first, [[35 + (k % 10) * 2, 40 + Math.floor(k / 10)]]);
        return composeFirst(first, scene(), SLOT, false).facts;
      };
      // 59 of 300, and as many or more in a place elsewhere: no removal, answered exactly as before this reading.
      expect(inked(59, 59)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.1967, measured: { floor: 0.1967 } });
      expect(inked(59, 100)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.1967, measured: { floor: 0.3333 } });
      // More than the most elsewhere by no more than the few cells the rule lets through anywhere: still no removal.
      expect(inked(59, 58)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.1967, measured: { floor: 0.1933 } });
      expect(inked(59, 55)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.1967, measured: { floor: 0.1833 } });
      // Five cells more than the most elsewhere: the logo was removed here.
      expect(inked(59, 54)).toMatchObject({ made: true, removed: 0.1967, measured: { floor: 0.18 } });
      expect(inked(59, 0)).toMatchObject({ made: true, removed: 0.1967, measured: { floor: 0 } });
      // A stray cell or four in an empty rectangle, on a pair that differs nowhere else: not a removed logo.
      expect(inked(1, 0)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.0033, measured: { floor: 0 } });
      expect(inked(4, 0)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.0133, measured: { floor: 0 } });
      expect(inked(5, 0)).toMatchObject({ made: true, removed: 0.0167, measured: { floor: 0 } });
      // Nothing far apart at the slot is never above a floor of nothing.
      expect(inked(0, 0)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0, measured: { floor: 0 } });
      // The place is the one a slot with one fifth has: the slot, carried out to where the removal ends.
      const first = scene();
      for (let k = 0; k < 59; k++) cellsInked(first, [[35 + (k % 10) * 2, 10 + Math.floor(k / 10)]]);
      const sixty = cellsInked(copyOf(first), [[35 + 18, 15]]);
      expect(composeFirst(first, scene(), SLOT, false).facts.box).toEqual(composeFirst(sixty, scene(), SLOT, false).facts.box);
    });

    it("that only the reading against the pair made a place is no reason to make a design again when its join fails", () => {
      // Stripes run through the slot's surroundings; the cleaned picture has them 12 pixels off, so no join is clean there.
      const striped = (shift: number) => {
        const r = scene();
        for (let x = 100 + shift; x < 300; x += 24) box(r, x, 0, x + 12, 34, [230, 232, 236]);
        return r;
      };
      // A thin logo: 12% of the slot's cells. The floor is what the stripes are elsewhere: nothing, they are all in the surroundings.
      const thin = (r: Raster) => thinLogo(r, 40, 12, 9, 4);
      const first = thin(striped(0));
      const kept = copyOf(first);
      const made = composeFirst(first, striped(12), SLOT, false);
      expect(made.facts).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.12, measured: { floor: 0, join: made.facts.measured!.join } });
      expect(made.facts.measured!.join).toBeGreaterThan(FIRST_PICTURE_RULE.joinMax);
      expect(made.picture).toBeNull();
      expect(differing(first, kept, null).beyond).toBe(0);
      // Exactly what the rule answered before: "removal", and the worker goes on from the cleaned picture.
      expect(composeBefore(thin(striped(0)), striped(12), SLOT, false).facts).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.12 });
      // With a clean ring the same thin logo is composed, which it was not before.
      expect(composeFirst(thin(striped(0)), striped(0), SLOT, false).facts).toMatchObject({ made: true, removed: 0.12, measured: { floor: 0 } });
      expect(composeBefore(thin(striped(0)), striped(0), SLOT, false).facts).toMatchObject({ made: false, why: "removal" });
      // A slot with one fifth of its cells far apart and the same ring is the refusal that makes a design again, as before.
      expect(composeFirst(withLogo(striped(0)), striped(12), SLOT, false).facts).toMatchObject({ made: false, why: "join" });
    });

    it("does not take a faint logo for a removal, while a found one is composed", () => {
      // A logo 30 levels from its ground: under the level a cell is apart at.
      const faint = () => {
        const r = scene();
        box(r, 150, 46, 250, 74, [GROUND[0] + 30, GROUND[1] + 30, GROUND[2] + 30]);
        return r;
      };
      expect(composeFirst(faint(), scene(), SLOT, false).facts).toMatchObject({ made: false, why: "removal", removed: 0 });
      expect(composeFirst(faint(), scene(), SLOT, true).facts).toMatchObject({ made: true, removed: 0 });
    });

    it("is carried out to where the removal ends when the model drew the logo larger or lower than the canvas had it", () => {
      // The drawing runs 20 pixels past the slot on the left and 32 below it, in two lines with a gap, as a wordmark has.
      const larger = () => {
        const r = scene();
        box(r, 120, 46, 250, 66, [255, 255, 255]);
        box(r, 120, 72, 250, 112, [255, 255, 255]);
        return r;
      };
      const first = grain(larger(), 3, 35);
      const kept = copyOf(first);
      const { picture, facts } = composeFirst(first, grain(scene(), 6, 36), SLOT, false);
      expect(facts.made).toBe(true);
      // The whole drawing is gone, also the part outside the slot, and nothing outside the patch changed.
      for (const [x, y] of [[124, 50], [124, 108], [246, 110], [200, 60]]) {
        for (const [c, v] of pixel(picture!, x, y).entries()) expect(Math.abs(v - GROUND[c])).toBeLessThanOrEqual(8);
      }
      expect(facts.box!.x).toBeLessThanOrEqual(120 - 8);
      expect(facts.box!.y + facts.box!.height).toBeGreaterThanOrEqual(112 + 8);
      expect(differing(picture!, kept, facts.box!).beyond).toBe(0);
      // The same pictures with a found slot: the rectangle is the search's, so the ring crosses the drawing and nothing is composed.
      expect(composeFirst(grain(larger(), 3, 35), grain(scene(), 6, 36), SLOT, true).facts).toMatchObject({ made: false, why: "join" });
    });

    it("is carried out by its shorter side at most: a removal that runs on past that is not composed", () => {
      // The slot is 10 cells high. Ink runs down from it for 100 pixels: the rectangle stops after 40, the ring still shows ink.
      const first = withLogo(scene());
      box(first, 150, 74, 250, 180, [255, 255, 255]);
      const kept = copyOf(first);
      const made = composeFirst(first, scene(), SLOT, false);
      expect(made.facts).toMatchObject({ made: false, why: "join" });
      expect(differing(first, kept, null).beyond).toBe(0);
    });

    it("changes no pixel outside the patch it answers, whatever the two pictures show", () => {
      const next = seeded(20261118);
      let composed = 0;
      for (let run = 0; run < 40; run++) {
        const w = 120 + next(160), h = 120 + next(160);
        const random = () => {
          const r = flat(w, h, [next(256), next(256), next(256)]);
          for (let k = 0; k < 10; k++) {
            const x = next(w), y = next(h);
            box(r, x, y, x + 1 + next(w), y + 1 + next(h), [next(256), next(256), next(256)]);
          }
          return grain(r, 1 + next(8), 1 + next(1000));
        };
        const first = random(), kept = copyOf(first);
        const slot: Rect = { x: next(w - 40), y: next(h - 30), width: 16 + next(60), height: 8 + next(30) };
        const made = composeFirst(first, random(), slot, false, { ...FIRST_PICTURE_RULE, joinMax: 1000, apartCells: 1e9 });
        if (!made.picture) expect(differing(first, kept, null).beyond).toBe(0);
        else {
          composed++;
          expect(differing(first, kept, made.facts.box!).beyond).toBe(0);
          // The patch is the slot carried out by its shorter side at most, plus the margin and the ring.
          const most = (Math.min(Math.ceil(slot.width / 4), Math.ceil(slot.height / 4)) + 1) * 4 + patchReach();
          expect(near(slot, most, made.facts.box!.x, made.facts.box!.y)).toBe(true);
          expect(near(slot, most, made.facts.box!.x + made.facts.box!.width - 1, made.facts.box!.y + made.facts.box!.height - 1)).toBe(true);
        }
      }
      expect(composed).toBeGreaterThan(10);
    });

    it("is held to the same join as a found one", () => {
      const striped = (shift: number) => {
        const r = scene();
        for (let x = 100 + shift; x < 300; x += 24) box(r, x, 0, x + 12, 34, [230, 232, 236]);
        return r;
      };
      expect(composeFirst(withLogo(striped(0)), striped(12), SLOT, false).facts).toMatchObject({ made: false, why: "join" });
      expect(composeFirst(withLogo(striped(0)), striped(0), SLOT, false).facts.made).toBe(true);
    });
  });

  it("composes nothing when the pictures are not one size, or the slot has no place or no ring on the picture", () => {
    const first = withLogo(scene());
    const kept = copyOf(first);
    expect(composeFirst(first, flat(W, H - 4, GROUND), SLOT, true).facts).toEqual({ made: false, why: "size", share: 0, join: 0 });
    expect(composeFirst(first, scene(), { x: -500, y: -500, width: 100, height: 40 }, true).facts).toEqual({ made: false, why: "slot", share: 0, join: 0 });
    expect(composeFirst(first, scene(), { x: 0, y: 0, width: W, height: H }, true).facts).toEqual({ made: false, why: "slot", share: 0, join: 0 });
    expect(differing(first, kept, null).beyond).toBe(0);
  });

  it("handles a slot at the picture's edge and a picture whose sides are not whole cells", () => {
    const odd = (logo: boolean) => {
      const r = flat(203, 157, GROUND);
      if (logo) box(r, 150, 20, 190, 40, [255, 255, 255]);
      return r;
    };
    const first = odd(true);
    const { picture, facts } = composeFirst(first, odd(false), { x: 146, y: 16, width: 57, height: 28 }, true);
    expect(facts.made).toBe(true);
    expect(pixel(picture!, 202, 30)).toEqual(GROUND);
    expect(pixel(picture!, 170, 30)).toEqual(GROUND);
    expect(facts.box!.x + facts.box!.width).toBeLessThanOrEqual(203);
    expect(facts.box!.y + facts.box!.height).toBeLessThanOrEqual(157);
  });
});

// The two readings against the pair of pictures itself (17 Nov 2026, evening). Each only adds: every outcome is either what the
// rule answered before (firstPictureBefore.ts), or a composed picture whose join passed.
describe("read against the pair of pictures itself", () => {
  const facts = (first: Raster, cleaned: Raster, slot: Rect, found: boolean) => composeFirst(copyOf(first), cleaned, slot, found).facts;
  const before = (first: Raster, cleaned: Raster, slot: Rect, found: boolean) => composeBefore(copyOf(first), cleaned, slot, found).facts;

  // The live case: a thin wordmark drawn smaller than the canvas had it, on a picture full of points of light the redraw moved.
  describe("on a picture the redraw changed all over", () => {
    const SW = 800, SH = 640;
    /** A slot of 60 cells by 25. The model drew its logo 27 cells by 10 inside it. */
    const SKY_SLOT: Rect = { x: 280, y: 60, width: 240, height: 100 };
    const LOGO: Rect = { x: 84 * 4, y: 20 * 4, width: 27 * 4, height: 40 };
    /** A night sky over water: points of light all over, thicker over the water (the lower three eighths). A redraw has other points. */
    const sky = (seed: number) => grain(stars(stars(flat(SW, SH, GROUND), 160, seed, 0, 400), 420, seed + 7, 400, SH), 3, seed + 1);
    const withThin = (r: Raster) => thinLogo(r, 84, 20, 14, 10);

    it("recognizes a small thin logo at the canvas rectangle and composes it, which a fixed share did not", () => {
      const first = withThin(sky(45)), cleaned = sky(47);
      const kept = copyOf(first);
      const made = composeFirst(first, cleaned, SKY_SLOT, false);
      // A tenth of the rectangle's cells are far apart: under one fifth, and above anything of its size elsewhere on the pair.
      expect(before(kept, cleaned, SKY_SLOT, false)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.1073 });
      expect(made.facts).toMatchObject({ made: true, removed: 0.1073, measured: { floor: 0.0647 } });
      // The ring holds 22 cells far apart, points all of them, where four are allowed; the ring in the middle of the 7,424 laid
      // elsewhere holds 31, and none of the ring's touches another.
      expect(made.facts.measured).toEqual({ floor: 0.0647, ring: { cells: 824, apart: 22, touching: 0 }, rings: { cells: 824, apart: 31, rings: 7424 } });
      // The logo is gone, and outside the patch every pixel is the first picture's own.
      for (let k = 0; k < 14; k++) {
        const x = (84 + k * 2) * 4 + 1, y = 100;
        expect(pixel(kept, x, y)).toEqual([255, 255, 255]);
        for (const [c, v] of pixel(made.picture!, x, y).entries()) expect(Math.abs(v - pixel(cleaned, x, y)[c])).toBeLessThanOrEqual(4);
      }
      expect(differing(made.picture!, kept, made.facts.box!).beyond).toBe(0);
      expect(differing(cleaned, kept, null).beyond).toBeGreaterThan(SW * SH * 0.9);
    });

    it("leaves a rectangle that carries only what the redraw did everywhere exactly as it was answered before", () => {
      for (const [x, y] of [[SKY_SLOT.x, SKY_SLOT.y], [40, 80], [500, 250], [60, 500], [300, 480]]) {
        const slot = { ...SKY_SLOT, x, y };
        const got = facts(sky(45), sky(47), slot, false);
        const { measured, ...rest } = got;
        expect(rest, `${x},${y}`).toEqual(before(sky(45), sky(47), slot, false));
        expect(got).toMatchObject({ made: false, why: "removal", share: 0, join: 0 });
        expect(measured!.floor).toBeGreaterThan(0);
      }
      // The last of them lies on the water, where the pictures differ most: it holds more than its floor (read on the sky) and
      // its ring holds more than the rings elsewhere, so it is no place either.
      const water = facts(sky(45), sky(47), { ...SKY_SLOT, x: 300, y: 480 }, false);
      expect(water.removed).toBeGreaterThan(water.measured!.floor!);
      expect(water.measured!.ring!.apart).toBeGreaterThan(water.measured!.rings!.apart);
    });

    it("composes a found drawing whose ring holds points, which a count of cells refused", () => {
      const first = withThin(sky(45)), cleaned = sky(47);
      expect(before(first, cleaned, LOGO, true)).toMatchObject({ made: false, why: "join" });
      const made = facts(first, cleaned, LOGO, true);
      expect(made).toMatchObject({ made: true, measured: { ring: { cells: 424, apart: 7, touching: 0 }, rings: { cells: 424, apart: 10, rings: 19118 } } });
      expect(made.box).toEqual({ x: LOGO.x - 28, y: LOGO.y - 28, width: LOGO.width + 56, height: LOGO.height + 56 });
    });

    it("still refuses what is no point on such a picture: marks beside the drawing, a stroke of it that crosses the ring, text the redraw moved", () => {
      const cleaned = sky(47);
      const refusedFor = (first: Raster, cleanedOf: Raster = cleaned) => {
        const got = facts(first, cleanedOf, LOGO, true);
        // More than four of the ring's cells far apart touch another: the rule's own count refuses, and the pair is not asked.
        expect(got).toMatchObject({ made: false, why: "join" });
        expect(got.measured!.ring!.touching).toBeGreaterThan(FIRST_PICTURE_RULE.apartCells);
        expect(got.measured!.rings).toBeUndefined();
        // Exactly what was answered before.
        const { measured: _measured, ...rest } = got;
        expect(rest).toEqual(before(first, cleanedOf, LOGO, true));
      };
      // Eight small marks 8 pixels square, 20 pixels under the found rectangle, that the removal took out.
      const marks = withThin(sky(45));
      for (let k = 0; k < 8; k++) box(marks, LOGO.x + k * 12, LOGO.y + LOGO.height + 20, LOGO.x + k * 12 + 8, LOGO.y + LOGO.height + 28, [255, 255, 255]);
      refusedFor(marks);
      // One stroke of the drawing, 8 pixels wide, runs 40 pixels on under the rectangle, through the ring.
      refusedFor(box(withThin(sky(45)), LOGO.x, LOGO.y + LOGO.height, LOGO.x + 8, LOGO.y + LOGO.height + 40, [255, 255, 255]));
      // A thin line of words 12 pixels under the rectangle, 3 pixels off in the cleaned picture.
      const words = (r: Raster, off: number) => textLine(r, LOGO.x - 40 + off, LOGO.y + LOGO.height + 12, [250, 250, 250]);
      refusedFor(words(withThin(sky(45)), 0), words(sky(47), 3));
    });

    it("refuses a ground the redraw gave another texture, on which the patch would show: cells far apart that touch, all over the pair", () => {
      // Gravel in place of points: every far cell of a redraw has others beside it. The rings elsewhere hold as many, and it is no join.
      const gravel = (seed: number) => {
        const r = flat(SW, SH, GROUND);
        const next = seeded(seed);
        for (let k = 0; k < 900; k++) { const x = next(SW - 12), y = next(SH - 8); box(r, x, y, x + 12, y + 8, [GROUND[0] + 70, GROUND[1] + 70, GROUND[2] + 70]); }
        return grain(r, 3, seed + 1);
      };
      const first = withThin(gravel(61)), cleaned = gravel(67);
      const got = facts(first, cleaned, LOGO, true);
      expect(got).toMatchObject({ made: false, why: "join" });
      expect(got.join).toBeLessThanOrEqual(FIRST_PICTURE_RULE.joinMax);
      expect(got.measured!.ring!.touching).toBeGreaterThan(FIRST_PICTURE_RULE.apartCells);
      expect(got.measured!.rings).toBeUndefined();
      const { measured: _measured, ...rest } = got;
      expect(rest).toEqual(before(first, cleaned, LOGO, true));
    });
  });

  // The cases an independent review drew (17 Nov 2026), as it drew them: a light paper ground with grain, 1088 by 1360, and a
  // redraw that is the scene again, softened (each pixel the mean of its three by three) with noise of its own.
  describe("the review's cases", () => {
    const RW = 1088, RH = 1360;
    type Paint = (x: number, y: number) => number[];
    let state = 1;
    const rnd = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const painted = (paint: Paint): Raster => {
      const r = flat(RW, RH, [0, 0, 0]);
      for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) r.data.set(paint(x, y), (y * RW + x) * 4);
      return r;
    };
    const paper: Paint = () => { const v = 225 + (rnd() - 0.5) * 6; return [v, v, v - 10]; };
    const softened = (r: Raster, noise = 3): Raster => {
      const o = copyOf(r);
      for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
        const sum = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const p = (Math.min(RH - 1, Math.max(0, y + dy)) * RW + Math.min(RW - 1, Math.max(0, x + dx))) * 4;
          sum[0] += r.data[p]; sum[1] += r.data[p + 1]; sum[2] += r.data[p + 2];
        }
        const e = (rnd() - 0.5) * 2 * noise;
        o.data.set(sum.map((v) => v / 9 + e), (y * RW + x) * 4);
      }
      return o;
    };
    const INK: Rgb = [40, 40, 60];

    it("refuses a found drawing with small marks just outside its rectangle, removed or moved by the redraw", () => {
      const FOUND: Rect = { x: 400, y: 200, width: 240, height: 80 };
      const drawn = (at: number, down: number) => {
        const r = painted(paper);
        for (let i = 0; i < 8; i++) box(r, at + i * 30, down, at + i * 30 + 8, down + 8, INK);
        return r;
      };
      for (const cleanedOf of [() => softened(painted(paper)), () => softened(drawn(408, 302))]) {
        state = 1;
        const first = box(drawn(404, 300), 410, 210, 630, 270, INK);
        const kept = copyOf(first);
        const cleaned = cleanedOf();
        const made = composeFirst(first, cleaned, FOUND, true);
        // 20 cells of the marks on the ring, every one touching another: the rule's own count refuses them.
        expect(made.facts).toMatchObject({ made: false, why: "join", measured: { ring: { apart: 20, touching: 20 } } });
        expect(made.facts.measured!.rings).toBeUndefined();
        expect(made.picture).toBeNull();
        expect(differing(first, kept, null).beyond).toBe(0);
        const { measured: _measured, ...rest } = made.facts;
        expect(rest).toEqual(before(kept, cleaned, FOUND, true));
      }
    });

    const CANVAS: Rect = { x: 360, y: 80, width: 368, height: 128 };

    it("leaves no part of a logo with a small icon or dots beside its wordmark: the whole rectangle is the place, or nothing is composed", () => {
      const inked = (first: Raster, is: (x: number, y: number) => boolean) => { for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) if (is(x, y)) first.data.set([20, 60, 140], (y * RW + x) * 4); return first; };
      const icon = (x: number, y: number) => (x >= 400 && x < 700 && y >= 140 && y < 164) || (x >= 400 && x < 412 && y >= 108 && y < 120);
      const dots = (x: number, y: number) => (x >= 400 && x < 700 && y >= 120 && y < 132) || (y >= 152 && y < 160 && x >= 400 && x < 700 && (x - 400) % 50 < 8);
      // With or without a block of text elsewhere that the redraw moved 3 pixels.
      const text = (off: number): Paint => (x, y) => (y >= 700 && y < 1000 && x >= 80 && x < 1000 && (y - 700) % 16 < 3 && ((x + off) >> 5) % 5 !== 0 ? [30, 30, 30] : paper(x, y));
      for (const [logo, scene, removed] of [[icon, () => paper, 0.1559], [icon, text, 0.1559], [dots, text, 0.0866]] as Array<[typeof icon, (off: number) => Paint, number]>) {
        state = 1;
        const first = inked(painted(scene(0)), logo);
        const kept = copyOf(first);
        const cleaned = painted(scene(3));
        expect(before(kept, cleaned, CANVAS, false)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed });
        const made = composeFirst(first, cleaned, CANVAS, false);
        expect(made.facts).toMatchObject({ made: true, removed });
        expect(made.facts.removed).toBeGreaterThan(made.facts.measured!.floor!);
        // The patch is the whole rectangle with its margin and ring, as for any canvas rectangle, and not one pixel of the logo is left.
        expect(made.facts.box).toEqual({ x: 332, y: 52, width: 424, height: 184 });
        let left = 0;
        for (let y = 100; y < 170; y++) for (let x = 390; x < 710; x++) if (logo(x, y) && pixel(made.picture!, x, y)[0] < 150) left++;
        expect(left).toBe(0);
        expect(differing(made.picture!, kept, made.facts.box!).beyond).toBe(0);
      }
    });

    it("still composes a clear logo when a busy area elsewhere, which the redraw moved, is changed far more than the slot", () => {
      const logo = (x: number, y: number) => (x >= 380 && x < 710 && y >= 110 && y < 136) || (x >= 380 && x < 580 && y >= 150 && y < 162);
      for (const [busy, period, shift] of [[680, 12, 3], [450, 16, 4], [300, 10, 2]]) {
        state = 1;
        const scene = (off: number): Paint => (x, y) => {
          const n = (rnd() - 0.5) * 6;
          if (y >= RH - busy) { const v = Math.floor((x + off) / (period / 2)) % 2 ? 230 : 40; return [v + n, v + n, v + n]; }
          return [225 + n, 225 + n, 215 + n];
        };
        const first = painted((x, y) => (logo(x, y) ? [20, 60, 140] : scene(0)(x, y)));
        const cleaned = painted(scene(shift));
        const made = composeFirst(copyOf(first), cleaned, CANVAS, false), was = composeBefore(copyOf(first), cleaned, CANVAS, false);
        // The same answer and the same picture, byte for byte, as before: one fifth of the rectangle decides alone.
        expect(was.facts).toMatchObject({ made: true, removed: 0.2653 });
        expect(made.facts).toEqual(was.facts);
        expect(Buffer.from(made.picture!.data).equals(Buffer.from(was.picture!.data))).toBe(true);
      }
    });
  });

  // The measure itself, on points laid in a regular grid (one cell in every six across and down, in the first picture only), so
  // every ring on the picture holds nearly the same count and the middle one is known.
  describe("a ring against the rings elsewhere", () => {
    const LW = 600, LH = 480;
    const grid = (by = 60) => {
      const cells: Array<[number, number]> = [];
      for (let cy = 2; cy < LH / 4; cy += 6) for (let cx = 2; cx < LW / 4; cx += 6) cells.push([cx, cy]);
      return cellsInked(flat(LW, LH, GROUND), cells, by);
    };
    /** A found drawing 20 cells by 10 from cell (cx, cy), drawn on the first picture. */
    const found = (cx: number, cy: number): Rect => ({ x: cx * 4, y: cy * 4, width: 80, height: 40 });
    const drawn = (r: Raster, at: Rect) => box(r, at.x + 8, at.y + 8, at.x + at.width - 8, at.y + at.height - 8, [255, 255, 255]);

    it("is clean when it holds no more cells far apart than the middle ring, and not when it holds more", () => {
      let level = 0, under = 0, over = 0;
      for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
        const at = found(60 + dx, 50 + dy);
        const got = facts(drawn(grid(), at), flat(LW, LH, GROUND), at, true);
        // A ring that falls between the points holds four or fewer: composed as it always was, with nothing read against the pair.
        if (!got.measured) { expect(got.made).toBe(true); continue; }
        const ring = got.measured.ring!, rings = got.measured.rings!;
        // None of the points touches another, and the ring in the middle of the 8,160 elsewhere holds 12.
        expect(ring.apart).toBeGreaterThan(FIRST_PICTURE_RULE.apartCells);
        expect([ring.cells, ring.touching]).toEqual([368, 0]);
        expect(rings).toEqual({ cells: 368, apart: 12, rings: 8160 });
        expect(got.made, `${dx},${dy}: ${ring.apart} against ${rings.apart}`).toBe(ring.apart <= rings.apart);
        expect(got.why).toBe(got.made ? undefined : "join");
        if (ring.apart === rings.apart) level++; else if (ring.apart < rings.apart) under++; else over++;
      }
      // Every side of the line was met: rings with exactly the middle count (composed), with fewer (composed), with more (refused).
      expect([level, under, over]).toEqual([16, 4, 8]);
    });

    it("reads every cell with the ring's own color correction", () => {
      // The cleaned picture came back 20 levels lighter all over, and the points are 60 levels: under the level before the
      // correction, over it after. The ring and the rings elsewhere are read the same way, so the ring is as clean as they are.
      const at = found(61, 51);
      const got = facts(drawn(grid(), at), flat(LW, LH, [GROUND[0] + 20, GROUND[1] + 20, GROUND[2] + 20]), at, true);
      expect(got).toMatchObject({ made: true, measured: { ring: { cells: 368, apart: 6 }, rings: { cells: 368, apart: 12 } } });
    });

    it("compares a ring the picture's edge cuts by its share of cells, not by its count", () => {
      // A drawing at the top edge: its ring has 224 of the 368 cells. With 10 of them far apart it holds fewer than the middle
      // ring's 12, and a larger share (10 of 224 against 12 of 368): refused. With 7 of 224 it is composed.
      const more = facts(drawn(grid(), found(61, 0)), flat(LW, LH, GROUND), found(61, 0), true);
      expect(more).toMatchObject({ made: false, why: "join", measured: { ring: { cells: 224, apart: 10, touching: 0 }, rings: { cells: 368, apart: 12 } } });
      const fewer = facts(drawn(grid(), found(60, 0)), flat(LW, LH, GROUND), found(60, 0), true);
      expect(fewer).toMatchObject({ made: true, measured: { ring: { cells: 224, apart: 7, touching: 0 }, rings: { cells: 368, apart: 12 } } });
    });

    it("keeps the rule's own count for the cells that touch another: four are let through, five are not, whatever the rings elsewhere hold", () => {
      // A ring that holds half the middle count, and on it a run of cells side by side.
      const at = found(61, 51);
      const run = (cells: Array<[number, number]>) => facts(cellsInked(drawn(grid(), at), cells), flat(LW, LH, GROUND), at, true);
      expect(run([])).toMatchObject({ made: true, measured: { ring: { apart: 6, touching: 0 } } });
      expect(run(block(64, 47, 4, 1))).toMatchObject({ made: true, measured: { ring: { apart: 10, touching: 4 }, rings: { apart: 12 } } });
      const five = run(block(64, 47, 5, 1));
      expect(five).toMatchObject({ made: false, why: "join", measured: { ring: { apart: 11, touching: 5 } } });
      // The count is under the middle ring's: the cells that touch are what kept it out, and the pair was not asked.
      expect(five.measured!.rings).toBeUndefined();
      // Cells that meet at a corner touch as well; the same five with a cell between each two are five points.
      expect(run([[64, 47], [65, 46], [66, 47], [67, 46], [68, 47]])).toMatchObject({ made: false, why: "join", measured: { ring: { apart: 11, touching: 5 } } });
      expect(run([[64, 47], [66, 47], [68, 47], [70, 47], [72, 47]])).toMatchObject({ made: true, measured: { ring: { apart: 11, touching: 0 } } });
    });

    it("is not let through by rings elsewhere that hold as many cells that touch", () => {
      // The same grid with every point two cells wide: on every ring of the pair the cells far apart touch another.
      const wide = () => {
        const cells: Array<[number, number]> = [];
        for (let cy = 2; cy < LH / 4; cy += 6) for (let cx = 2; cx < LW / 4; cx += 6) cells.push([cx, cy], [cx + 1, cy]);
        return cellsInked(flat(LW, LH, GROUND), cells);
      };
      const at = found(61, 51);
      const got = facts(drawn(wide(), at), flat(LW, LH, GROUND), at, true);
      expect(got).toMatchObject({ made: false, why: "join" });
      expect(got.measured!.ring!.touching).toBe(got.measured!.ring!.apart);
      expect(got.measured!.ring!.touching).toBeGreaterThan(FIRST_PICTURE_RULE.apartCells);
      expect(got.measured!.rings).toBeUndefined();
    });
  });

  it("answers as before where the picture has no place of the slot's size, or no ring of the patch's, outside the slot's surroundings", () => {
    // 100 cells by 30: the surroundings of a slot 30 by 10 are the page's whole height, and the bands beside them are 25 cells wide.
    const wide = (cells: Array<[number, number]>) => cellsInked(flat(400, 120, GROUND), cells);
    const thin = block(40, 12, 12, 2);
    expect(facts(wide(thin), wide([]), SLOT, false)).toEqual({ made: false, why: "removal", share: 0, join: 0, removed: 0.08 });
    // A found drawing there with five single cells far apart on its ring: refused, as five always were.
    const ringed = facts(wide([...block(36, 11, 28, 8), [30, 10], [30, 12], [30, 14], [30, 16], [30, 18]]), wide([]), SLOT, true);
    expect(ringed).toMatchObject({ made: false, why: "join", measured: { ring: { apart: 5, touching: 0 } } });
    expect(ringed.measured!.rings).toBeUndefined();
  });

  it("is, on every generated pair, either the answer the rule gave before or a composed picture whose join passed", () => {
    const next = seeded(20261119);
    const tally: Record<string, number> = {};
    for (let run = 0; run < 140; run++) {
      const w = 320 + next(240), h = 320 + next(240);
      const paper: Rgb = [40 + next(160), 40 + next(160), 40 + next(160)];
      const ink: Rgb = [paper[0] > 128 ? 10 : 245, paper[1] > 128 ? 10 : 245, paper[2] > 128 ? 10 : 245];
      const slot: Rect = { x: 40 + next(w - 200), y: 30 + next(h - 160), width: 60 + next(80), height: 20 + next(36) };
      const points = [0, 0, 30, 90, 200][next(5)], moved = next(3);
      const draw = (seed: number, off: number) => {
        const r = flat(w, h, paper);
        // A band of the photo with an edge, and a line of words, both a little off in the redraw on some runs.
        box(r, 0, h - 60 + (moved === 1 ? off : 0), w, h, [paper[0] + 40, paper[1] + 30, paper[2] + 20]);
        if (run % 3 === 0) textLine(r, 20 + (moved === 2 ? off : 0), h - 150, ink);
        return grain(stars(r, points, seed), 1 + next(4), seed + 1);
      };
      const first = draw(3000 + run, 0), cleaned = draw(5000 + run, 3);
      // On the first picture, a drawing of some size at the slot, near it, or nowhere; and sometimes small marks beside it.
      const kind = run % 7;
      if (kind < 5) {
        const x = slot.x + (kind === 3 ? -24 : 4) + next(12), y = slot.y + (kind === 4 ? 14 : 2) + next(6);
        const dw = kind === 1 ? 10 + next(20) : Math.floor(slot.width * (0.4 + next(60) / 100)), dh = kind === 1 ? 4 + next(6) : Math.floor(slot.height * (0.3 + next(60) / 100));
        for (let sx = x; sx < x + dw; sx += 8) box(first, sx, y, sx + 3 + next(5), y + dh, ink);
        if (run % 4 === 1) for (let k = 0; k < 5; k++) box(first, x + k * 14, y + dh + 14, x + k * 14 + 6, y + dh + 20, ink);
      }
      for (const found of [false, true]) {
        const now = composeFirst(copyOf(first), cleaned, slot, found), was = composeBefore(copyOf(first), cleaned, slot, found);
        const { measured, ...rest } = now.facts;
        const key = `${found ? "found" : "canvas"}: ${ended(was.facts)} then, ${ended(now.facts)} now`;
        tally[key] = (tally[key] ?? 0) + 1;
        if (was.facts.made) {
          // Composed before: composed now, with the same box and the same pixels.
          expect(rest, key).toEqual(was.facts);
          expect(Buffer.from(now.picture!.data).equals(Buffer.from(was.picture!.data))).toBe(true);
        } else if (!now.facts.made) {
          // Not composed now: the same answer as before, to the last number.
          expect(rest, key).toEqual(was.facts);
          expect(now.picture).toBeNull();
          // The ring's mean is kept apart only for a place the floor alone made, whose answer has no join.
          if (was.facts.why === "join") expect(measured?.join).toBeUndefined();
        } else {
          // Composed now and not before: only for a reason one of the two readings covers, and with a join that passed.
          expect(["removal", "join"], key).toContain(was.facts.why);
          expect(now.facts.join).toBeLessThanOrEqual(FIRST_PICTURE_RULE.joinMax);
          if (was.facts.why === "removal") {
            expect(found).toBe(false);
            expect(now.facts.removed).toBeLessThan(0.2);
            expect(now.facts.removed).toBeGreaterThan(measured!.floor!);
          }
          const ring = measured?.ring, rings = measured?.rings;
          if (was.facts.why === "join") expect(ring).toBeDefined();
          if (ring) {
            // More than four cells far apart on the ring: no more than four of them touch another, and the ring holds no larger
            // share of them than the ring in the middle of those elsewhere.
            expect(ring.apart).toBeGreaterThan(FIRST_PICTURE_RULE.apartCells);
            expect(ring.touching).toBeLessThanOrEqual(FIRST_PICTURE_RULE.apartCells);
            expect(ring.apart * rings!.cells).toBeLessThanOrEqual(rings!.apart * ring.cells);
          }
          // And the picture is the first picture outside its box.
          expect(differing(now.picture!, first, now.facts.box!).beyond).toBe(0);
        }
      }
    }
    // Every kind of outcome was reached, the two new ones among them.
    for (const key of ["canvas: composed then, composed now", "canvas: removal then, removal now", "canvas: removal then, composed now", "found: composed then, composed now", "found: join then, join now", "found: join then, composed now"]) {
      expect(tally[key] ?? 0, `${key} in ${JSON.stringify(tally)}`).toBeGreaterThan(0);
    }
    // Nothing that was composed is now refused, and nothing is refused for another reason than before.
    for (const key of Object.keys(tally)) expect(key).toMatch(/: (composed then, composed now|(\w+) then, \2 now|(removal|join) then, composed now)$/);
  }, 120_000);
});
