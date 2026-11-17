// @vitest-environment node
// server/test/searchSame.test.ts
//
// Every search the service runs gives the answer it gave before the search
// had steps (17 Nov 2026), on this folder's own fixtures at the sizes the
// product works at: a 1088x1360 picture, the wide 700x239 logo and the
// square 2160x2160 one. The oracle is the search as main had it, copied as it
// was (supabase/tests/_shared/design/searchBefore.ts): it ran in one go and
// made its own luminance and shrunk pictures for every template. The
// rectangle and the score are compared exactly, number for number, for the
// slot (each template, in either tone), the look for the drawing in the
// cleaned slot, locate and a post. A search cut up at many points and
// carried on through JSON, as a call that works to a budget cuts it, ends in
// the same answer too.

import { describe, expect, it } from "vitest";
import { canvasLogoRect } from "../../supabase/functions/_shared/canva/brief.ts";
import { LOGO_MIN_SCORE, LOGO_SCALES } from "../../supabase/functions/_shared/design/logoMatch.ts";
import type { Searched, TemplateIn } from "../../supabase/functions/_shared/design/logoTone.ts";
import type { Placement, Rgb } from "../../supabase/functions/_shared/picture/contract.ts";
import { drawLogo, flat, inked } from "../../supabase/tests/_shared/design/draw.ts";
import { findLogoBefore, searchTemplatesBefore } from "../../supabase/tests/_shared/design/searchBefore.ts";
import { locateLogo } from "../src/picture/locate.ts";
import type { Raster } from "../src/picture/raster.ts";
import { findSlot, findSlotSteps, slotFile, slotFileSteps } from "../src/picture/slot.ts";
import { locateTemplates, postLogo } from "../src/picture/tone.ts";
import { pagePicture, ringAndBarLogo, wideLogo } from "./fixtures.ts";

const BIG = 120_000;
const W = 1088, H = 1360;
const LIGHT: Rgb = [255, 255, 255], DARK: Rgb = [11, 14, 26];
const center: Placement = { anchor: "center", width: 0.25, top: 0.04 };
const left: Placement = { anchor: "left", left: 0.06, width: 0.3, top: 0.05 };

const wide = inked(wideLogo(), [24, 28, 40]);
const wideWhite = inked(wide, [255, 255, 255]);
const square = ringAndBarLogo();
const squareWhite = inked(square, [255, 255, 255]);

/** A fixture picture with a logo drawn near its usual spot, at `k` of its usual width. */
function drawn(picture: Raster, logo: Raster, placement: Placement, k: number, dx: number, dy: number, color?: Rgb) {
  const usual = canvasLogoRect(placement, logo.width, logo.height, picture.width, picture.height);
  const rect = { x: usual.x + dx, y: usual.y + dy, width: Math.round(usual.width * k), height: Math.round((usual.width * k * logo.height) / logo.width) };
  return { picture: drawLogo(picture, logo, rect, color), rect };
}

const onGrain = drawn(pagePicture(W, H, 7), wide, center, 0.8, 14, 9);
const whiteOnDark = drawn(flat(W, H, [16, 40, 76]), wide, left, 1.1, -12, 17, [255, 255, 255]);
const squareOnGrain = drawn(pagePicture(W, H, 11), square, center, 0.9, 10, -6);
const nothing = pagePicture(W, H, 13);

const wideSet: TemplateIn[] = [{ file: "stored", raster: wide, ground: LIGHT }, { file: "other", raster: wideWhite, ground: DARK }];
const squareSet: TemplateIn[] = [{ file: "stored", raster: square, ground: LIGHT }, { file: "other", raster: squareWhite, ground: DARK }];

const SLOTS: Array<{ name: string; picture: Raster; templates: TemplateIn[]; placement: Placement }> = [
  { name: "the wide logo on a grainy picture, one template", picture: onGrain.picture, templates: [wideSet[0]], placement: center },
  { name: "the wide logo drawn in white on a dark picture, two templates", picture: whiteOnDark.picture, templates: wideSet, placement: left },
  { name: "the square 2160 logo on a grainy picture, two templates", picture: squareOnGrain.picture, templates: squareSet, placement: center },
  { name: "a picture with no logo on it, two templates", picture: nothing, templates: wideSet, placement: center },
];

describe("the slot's search gives the answer it gave before it had steps", () => {
  for (const c of SLOTS) {
    it(c.name, () => {
      const before = searchTemplatesBefore(c.picture, c.templates, c.placement, LOGO_SCALES, { either: true });
      const now = findSlot(c.picture, c.templates, c.placement, LOGO_SCALES);
      // The rectangle and the score, exactly; and with them which template matched and what each scored.
      expect(now.drawn).toEqual(before.rect);
      expect(now.score).toBe(before.score);
      expect(now.scores).toEqual(before.scores);
      expect([now.index, now.matched]).toEqual([before.index, before.matched]);
    }, BIG);
  }

  it("finds the drawings it is given: the test is of real matches, not of two searches that both find nothing", () => {
    const found = findSlot(onGrain.picture, [wideSet[0]], center, LOGO_SCALES);
    expect(found.from).toBe("drawn");
    // Where it was drawn, to within the two pixels a nearest-pixel drawing can be off by.
    for (const side of ["x", "y", "width", "height"] as const) expect(Math.abs(found.slot[side] - onGrain.rect[side]), side).toBeLessThanOrEqual(2);
    // Drawn in white on a dark ground: found by the stored file's template in either tone.
    expect(findSlot(whiteOnDark.picture, wideSet, left, LOGO_SCALES)).toMatchObject({ from: "drawn" });
    expect(findSlot(nothing, wideSet, center, LOGO_SCALES)).toMatchObject({ from: "canvas" });
  }, BIG);

  it("ends in the same answer when it is cut at many points and carried on through JSON, as a call that works to a budget cuts it", () => {
    for (const c of [SLOTS[1], SLOTS[2]]) {
      const whole = findSlot(c.picture, c.templates, c.placement, LOGO_SCALES);
      // Every point the search could be stopped at, in the first template and in the second.
      const points: Searched[] = [];
      const search = findSlotSteps(c.picture, c.templates, c.placement, LOGO_SCALES);
      for (;;) {
        const step = search.next();
        if (step.done) break;
        points.push(step.value);
      }
      expect(points.some((p) => p.done.length === 0)).toBe(true);
      expect(points.some((p) => p.done.length === 1)).toBe(true);
      // Carried on from five of them, each from what an earlier call would have sent back.
      const every = Math.floor(points.length / 5);
      for (let i = every - 1; i < points.length; i += every) {
        const from = JSON.parse(JSON.stringify(points[i])) as Searched;
        const rest = findSlotSteps(c.picture, c.templates, c.placement, LOGO_SCALES, from);
        let step = rest.next();
        while (!step.done) step = rest.next();
        expect(step.value, `${c.name}, from point ${i}`).toEqual(whole);
      }
    }
  }, BIG);
});

describe("the look for the drawing in the cleaned slot gives the answer it gave before it had steps", () => {
  const cases = [
    { name: "the drawing is still there", picture: onGrain.picture, rect: onGrain.rect, logo: wide, white: wideWhite },
    { name: "the drawing is gone", picture: pagePicture(W, H, 17), rect: onGrain.rect, logo: wide, white: wideWhite },
    { name: "the square 2160 logo, still there", picture: squareOnGrain.picture, rect: squareOnGrain.rect, logo: square, white: squareWhite },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const before = findLogoBefore(c.picture.data, W, H, c.logo.data, c.logo.width, c.logo.height, c.rect, LIGHT, { reach: 0.03, scales: [0.9, 1.1], either: true });
      const files = [{ file: "stored" as const, raster: c.logo }, { file: "white" as const, raster: c.white, last: true }];
      const now = slotFile(c.picture, c.rect, [W, H], "stored", files, { file: "stored", ground: LIGHT });
      expect(now.drawn).toEqual({ score: before.score, found: before.score >= LOGO_MIN_SCORE });
      // Stopped after its first step and carried on from there: the whole answer again.
      const first = slotFileSteps(c.picture, c.rect, [W, H], "stored", files, { file: "stored", ground: LIGHT }).next();
      if (first.done) throw new Error("expected a step");
      const rest = slotFileSteps(c.picture, c.rect, [W, H], "stored", files, { file: "stored", ground: LIGHT }, JSON.parse(JSON.stringify(first.value)) as Searched);
      let step = rest.next();
      while (!step.done) step = rest.next();
      expect(step.value).toEqual(now);
    }, BIG);
  }

  it("says the drawing is there for the one and gone for the other", () => {
    const files = [{ file: "stored" as const, raster: wide }];
    expect(slotFile(onGrain.picture, onGrain.rect, [W, H], "stored", files, { file: "stored", ground: LIGHT }).drawn?.found).toBe(true);
    expect(slotFile(pagePicture(W, H, 17), onGrain.rect, [W, H], "stored", files, { file: "stored", ground: LIGHT }).drawn?.found).toBe(false);
  }, BIG);
});

describe("locate and a post's search give the answer they gave before the search had steps", () => {
  it("locate with one file", () => {
    const usual = canvasLogoRect(center, wide.width, wide.height, W, H);
    const before = findLogoBefore(onGrain.picture.data, W, H, wide.data, wide.width, wide.height, usual, LIGHT, { scales: LOGO_SCALES });
    const now = locateLogo(onGrain.picture, wide, center, LIGHT, LOGO_SCALES);
    expect({ x: now.x, y: now.y, width: now.width, height: now.height, score: now.score }).toEqual(before);
    expect(before.score).toBeGreaterThan(LOGO_MIN_SCORE);
  }, BIG);

  it("locate with two templates, and a post", () => {
    const before = searchTemplatesBefore(whiteOnDark.picture, wideSet, left, LOGO_SCALES);
    const located = locateTemplates(whiteOnDark.picture, wideSet, [], left, LOGO_SCALES);
    expect({ x: located.x, y: located.y, width: located.width, height: located.height }).toEqual(before.rect);
    expect(located.score).toBe(before.score);
    expect(located.scores).toEqual(before.scores);
    const post = postLogo(whiteOnDark.picture, wideSet, [], left, LOGO_SCALES);
    expect(post).toMatchObject({ found: true, rect: before.rect, matched: before.matched });
    expect(post.score).toBe(before.score);
  }, BIG);
});
