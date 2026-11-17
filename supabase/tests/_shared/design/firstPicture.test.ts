// The first picture as the base (17 Nov 2026, spec 2026-11-16-logo-tone-design.md, section 14).
// Pictures are drawn here, in made-up neutral colors: a first picture with a
// drawn logo in its slot, and "cleaned" pictures that differ from it the way
// a redraw does (grain, a color cast, edges and thin strokes a few pixels off).
import { describe, expect, it } from "vitest";
import type { Rect, Rgb } from "../../../functions/_shared/picture/contract";
import type { Raster } from "../../../functions/_shared/design/logoTone";
import { FIRST_PICTURE_RULE, composeFirst, patchReach } from "../../../functions/_shared/design/firstPicture";
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
    expect(FIRST_PICTURE_RULE).toEqual({ cell: 4, grow: 2, feather: 4, joinMax: 20, apartLevel: 48, apartCells: 4 });
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
    const { picture, facts } = composeFirst(first, cleaned, SLOT);

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
      const made = composeFirst(first, cleaned, slot, { ...FIRST_PICTURE_RULE, joinMax: 1000, apartCells: 1e9 });
      if (made.picture) composed++;
      expect(differing(first, kept, slot, reach).beyond).toBe(0);
      if (made.facts.box) {
        expect(differing(first, kept, made.facts.box).beyond).toBe(0);
        expect(near(slot, reach, made.facts.box.x, made.facts.box.y)).toBe(true);
        expect(near(slot, reach, made.facts.box.x + made.facts.box.width - 1, made.facts.box.y + made.facts.box.height - 1)).toBe(true);
      }
      // With the rule's own join test the same holds, and a refusal writes nothing at all.
      const again = copyOf(kept);
      const ruled = composeFirst(again, cleaned, slot);
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
        const { picture, facts } = composeFirst(first, cleaned, SLOT);
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
    const { picture, facts } = composeFirst(first, scene(), SLOT);
    expect(facts.made).toBe(true);
    // Still there: the read for marks judges this picture and finds it.
    expect(pixel(picture!, 336, 188)).toEqual([215, 215, 205]);
  });

  it("brings the patch to the first picture's color by the ring around it", () => {
    const first = withLogo(scene());
    // The cleaned picture came back with a cast of its own.
    const cleaned = cast(scene(), [4, -6, 5]);
    const { picture, facts } = composeFirst(first, cleaned, SLOT);
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
    const { picture, facts } = composeFirst(first, cleaned, SLOT);
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
    const made = composeFirst(one, striped(12), SLOT);
    expect(made.picture).toBeNull();
    expect(made.facts.made).toBe(false);
    expect(made.facts.why).toBe("join");
    expect(made.facts.join).toBeGreaterThan(FIRST_PICTURE_RULE.joinMax);
    expect(made.facts.box).toBeUndefined();
    // The first picture was not touched.
    expect(differing(one, kept, null).beyond).toBe(0);
    // The same stripes where they belong join cleanly.
    expect(composeFirst(withLogo(striped(0)), striped(0), SLOT).facts.made).toBe(true);
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
        const made = composeFirst(first, grain(draw(dx, dy, false), 6, 22), SLOT);
        expect(made.picture).toBeNull();
        expect(made.facts.made).toBe(false);
        expect(made.facts.why).toBe("join");
        // At 3 pixels the mean alone would have let it through.
        if (Math.abs(dx) === 3) expect(made.facts.join).toBeLessThan(FIRST_PICTURE_RULE.joinMax);
        expect(differing(first, kept, null).beyond).toBe(0);
        // The same line where it belongs is no reason to refuse.
        expect(composeFirst(grain(draw(0, 0, true), 3, 21), grain(draw(0, 0, false), 6, 22), SLOT).facts.made).toBe(true);
      }
    }
  });

  it("allows four ring cells far apart and refuses five", () => {
    // Whole cells of the ring, left of the slot, differ by 60 levels in the cleaned picture.
    const cellsApart = (count: number) => {
      const cleaned = scene();
      for (let k = 0; k < count; k++) box(cleaned, 30 * 4, (11 + k) * 4, 31 * 4, (12 + k) * 4, [GROUND[0] + 60, GROUND[1], GROUND[2]]);
      return composeFirst(withLogo(scene()), cleaned, SLOT);
    };
    expect(cellsApart(4).facts.made).toBe(true);
    expect(cellsApart(5).facts).toMatchObject({ made: false, why: "join" });
    expect(cellsApart(5).facts.join).toBeLessThan(FIRST_PICTURE_RULE.joinMax);
    // At the level itself a cell is not apart: only over it.
    const at = scene();
    for (let k = 0; k < 8; k++) box(at, 30 * 4, (11 + k) * 4, 31 * 4, (12 + k) * 4, [GROUND[0] + 48, GROUND[1], GROUND[2]]);
    expect(composeFirst(withLogo(scene()), at, SLOT).facts.made).toBe(true);
  });

  it("composes nothing when the pictures are not one size, or the slot has no place or no ring on the picture", () => {
    const first = withLogo(scene());
    const kept = copyOf(first);
    expect(composeFirst(first, flat(W, H - 4, GROUND), SLOT).facts).toEqual({ made: false, why: "size", share: 0, join: 0 });
    expect(composeFirst(first, scene(), { x: -500, y: -500, width: 100, height: 40 }).facts).toEqual({ made: false, why: "slot", share: 0, join: 0 });
    expect(composeFirst(first, scene(), { x: 0, y: 0, width: W, height: H }).facts).toEqual({ made: false, why: "slot", share: 0, join: 0 });
    expect(differing(first, kept, null).beyond).toBe(0);
  });

  it("handles a slot at the picture's edge and a picture whose sides are not whole cells", () => {
    const odd = (logo: boolean) => {
      const r = flat(203, 157, GROUND);
      if (logo) box(r, 150, 20, 190, 40, [255, 255, 255]);
      return r;
    };
    const first = odd(true);
    const { picture, facts } = composeFirst(first, odd(false), { x: 146, y: 16, width: 57, height: 28 });
    expect(facts.made).toBe(true);
    expect(pixel(picture!, 202, 30)).toEqual(GROUND);
    expect(pixel(picture!, 170, 30)).toEqual(GROUND);
    expect(facts.box!.x + facts.box!.width).toBeLessThanOrEqual(203);
    expect(facts.box!.y + facts.box!.height).toBeLessThanOrEqual(157);
  });
});
