// @vitest-environment node
// A logo file read as parts, the figure it has on a light and on a dark
// ground, and everything the logo set decides from them. Every raster is
// drawn here, in made-up neutral colors.
import { describe, expect, it } from "vitest";
import { canvasLogoRect, resampleRGBA } from "../../../functions/_shared/canva/brief";
import { logoFound } from "../../../functions/_shared/design/logoMatch";
import { bestNeutral, contrast, weakestContrast } from "../../../functions/_shared/lifecycle/designSettings";
import type { LogoFileName, LogoSetResult, Placement, PostLogo, Rgb } from "../../../functions/_shared/picture/contract";
import {
  DARK, LIGHT, chooseSet, colorGap, figure, groundAround, hidesPart, isSmall, jobLogos, lostOn, nameFile, ownGround, partsOf, postSearchPlan, restGround, sameLogo, searchTemplates, showsOn, showsWhole, stampList, stampRect, wholeExposedInks, wholeInks,
  type Found, type LogoSet, type Raster, type SetPaths,
} from "../../../functions/_shared/design/logoTone";
import { blank, box, drawLogo, flat, inked, mark } from "./draw";

describe("a logo file's parts", () => {
  it("joins pixels within 16 per channel into one part, by edges and never by corners", () => {
    const gradient = blank(400, 1);
    for (let x = 0; x < 400; x++) gradient.data.set([Math.round((x * 255) / 399), 90, 90, 255], x * 4);
    expect(partsOf(gradient).parts).toHaveLength(1);

    const halves = box(box(blank(20, 10), 0, 0, 10, 10, [200, 200, 200]), 10, 0, 20, 10, [40, 40, 40]);
    const two = partsOf(halves);
    expect(two.parts).toHaveLength(2);
    expect(two.parts[0].touches.get(1)).toBe(10);
    expect(two.parts[1].touches.get(0)).toBe(10);

    const corners = box(box(blank(4, 4), 0, 0, 2, 2, [120, 120, 120]), 2, 2, 4, 4, [120, 120, 120]);
    const apart = partsOf(corners);
    expect(apart.parts).toHaveLength(2);
    expect(apart.parts[0].touches.size).toBe(0);
    expect(apart.parts[1].touches.size).toBe(0);
  });

  it("numbers parts in the order their first pixel is met, and averages a part's color by alpha", () => {
    const r = blank(6, 2);
    // Row 0: a part at x = 4. Row 1: a part at x = 0 and 1 (one solid pixel, one at alpha 51).
    box(r, 4, 0, 5, 1, [10, 20, 30]);
    box(r, 0, 1, 1, 2, [100, 100, 100], 255);
    box(r, 1, 1, 2, 2, [110, 110, 110], 51);
    const { parts, label, ink } = partsOf(r);
    expect(parts.map((p) => p.id)).toEqual([0, 1]);
    expect(parts[0].color).toEqual([10, 20, 30]);
    // (100 * 1 + 110 * 0.2) / 1.2 = 101.67
    expect(parts[1].color).toEqual([102, 102, 102]);
    expect(parts[1].ink).toBeCloseTo(1.2, 10);
    expect(ink).toBeCloseTo(2.2, 10);
    expect(label[4]).toBe(0);
    expect(label[6]).toBe(1);
    expect(label[0]).toBe(-1);
  });

  it("leaves out pixels fainter than alpha 16", () => {
    const r = box(box(blank(3, 1), 0, 0, 1, 1, [9, 9, 9], 15), 1, 0, 2, 1, [9, 9, 9], 16);
    const { parts, label } = partsOf(r);
    expect(parts).toHaveLength(1);
    expect([label[0], label[1], label[2]]).toEqual([-1, 0, -1]);
  });

  it("knows an exposed part from an inside one", () => {
    const r = box(box(blank(14, 14), 1, 1, 13, 13, [30, 60, 200]), 5, 5, 9, 9, [250, 250, 250]);
    const { parts } = partsOf(r);
    expect(parts).toHaveLength(2);
    expect(parts[0].exposed).toBe(true);
    expect(parts[1].exposed).toBe(false);
    expect(parts[1].touches.get(0)).toBe(16);
    // A part on the file's edge is exposed too.
    expect(partsOf(box(blank(4, 4), 0, 0, 4, 4, [1, 2, 3])).parts[0].exposed).toBe(true);
  });
});

describe("a file's figure on a ground", () => {
  /** Two exposed parts that do not touch: `faint` pixels of a color near white, the rest near black, 100 pixels in all. */
  const twoParts = (faint: number): Raster => box(box(blank(102, 3), 0, 1, faint, 2, [235, 235, 235]), faint + 1, 1, 101, 2, [20, 20, 20]);

  it("takes the figure at the part where more than 10% of the exposed ink has been passed", () => {
    const low = contrast([235, 235, 235], LIGHT), high = contrast([20, 20, 20], LIGHT);
    expect(low).toBeLessThan(1.3);
    expect(high).toBeGreaterThan(8);
    // 5% of the ink is faint on white: the figure is the dark part's contrast.
    expect(figure(partsOf(twoParts(5)), LIGHT)).toBeCloseTo(high, 10);
    // 15% is faint: more than 10% is passed inside the faint part.
    expect(figure(partsOf(twoParts(15)), LIGHT)).toBeCloseTo(low, 10);
    expect(figure(partsOf(blank(4, 4)), LIGHT)).toBe(0);
  });

  it("takes the ground with the higher figure as the file's own, and light when equal", () => {
    const black = partsOf(box(blank(8, 8), 1, 1, 7, 7, [0, 0, 0]));
    const white = partsOf(box(blank(8, 8), 1, 1, 7, 7, [255, 255, 255]));
    expect(ownGround(black)).toBe("light");
    expect(ownGround(white)).toBe("dark");
    expect(ownGround(partsOf(blank(8, 8)))).toBe("light");
    expect(showsOn(black, "light")).toBe(true);
    expect(showsOn(black, "dark")).toBe(false);
    expect(showsOn(white, "dark")).toBe(true);
    expect(DARK).toEqual([11, 14, 26]);
    expect(LIGHT).toEqual([255, 255, 255]);
  });

  it("takes the one neutral a file shows whole on as its own, before the figure", () => {
    // 94 pixels of a mid-tone that shows on both neutrals, and a near-black part of 6 pixels that does not touch it.
    const MID: Rgb = [40, 120, 235], NEAR_BLACK: Rgb = [26, 25, 25];
    const parts = partsOf(box(box(blank(102, 3), 0, 1, 94, 2, MID), 95, 1, 101, 2, NEAR_BLACK));
    // By the figure alone the file would be made for dark pictures: 90% of its ink shows best there, and its near-black part does not show there at all.
    expect(figure(parts, DARK)).toBeGreaterThan(figure(parts, LIGHT));
    expect(contrast(NEAR_BLACK, DARK)).toBeLessThan(1.2);
    expect(ownGround(parts)).toBe("light");
    // It does not serve the dark ground either: a file shows on a ground when its figure is 3 or more and every whole part has 3:1 there.
    expect(figure(parts, DARK)).toBeGreaterThan(3);
    expect(showsOn(parts, "dark")).toBe(false);
    expect(showsOn(parts, "light")).toBe(true);
    // The other way round: a white part of 6 pixels beside the mid-tone makes the file one for dark pictures only.
    const light = partsOf(box(box(blank(102, 3), 0, 1, 94, 2, MID), 95, 1, 101, 2, [250, 250, 250]));
    expect(ownGround(light)).toBe("dark");
    expect(showsOn(light, "light")).toBe(false);
    // A file that shows whole on both neutrals keeps the ground with the higher figure, and serves the other one too.
    const mid = partsOf(box(blank(102, 3), 0, 1, 100, 2, MID));
    expect(ownGround(mid)).toBe("dark");
    expect(showsOn(mid, "light")).toBe(true);
    // So does a file that shows whole on neither: two letters under 3:1 on white and a near-black one.
    const neither = partsOf(box(box(blank(102, 3), 0, 1, 70, 2, [59, 172, 85]), 71, 1, 101, 2, NEAR_BLACK));
    expect(contrast([59, 172, 85], LIGHT)).toBeLessThan(3);
    expect(ownGround(neither)).toBe("light");
    expect(showsOn(neither, "dark")).toBe(false);
  });

  it("lists the whole exposed parts with their share of the ink", () => {
    // A 20 by 10 box (200 pixels) with a 4 by 4 inside part, and a single pixel far away (a small part).
    const r = box(box(box(blank(40, 12), 1, 1, 21, 11, [30, 60, 200]), 5, 4, 9, 8, [250, 250, 250]), 30, 5, 31, 6, [200, 30, 30]);
    const parts = partsOf(r);
    expect(parts.parts).toHaveLength(3);
    expect(isSmall(parts, parts.parts[2])).toBe(true);
    expect(isSmall(parts, parts.parts[1])).toBe(false);
    const inks = wholeExposedInks(parts);
    expect(inks).toHaveLength(1);
    expect(inks[0].color).toEqual([30, 60, 200]);
    expect(inks[0].share).toBeCloseTo(184 / 201, 10);
    // A copy's colors stand in for the parts' own.
    expect(wholeExposedInks(parts, [[1, 2, 3], [4, 5, 6], [7, 8, 9]])[0].color).toEqual([1, 2, 3]);
  });
});

describe("a file shown whole on a color", () => {
  // Two letters in a mid green and one near-black letter between them: made for light pictures.
  const GREEN: Rgb = [40, 140, 70], NEAR_BLACK: Rgb = [26, 25, 25];
  const threeLetters = box(box(box(blank(64, 20), 2, 2, 20, 18, GREEN), 24, 2, 40, 18, NEAR_BLACK), 44, 2, 62, 18, GREEN);

  it("reads the colors of a file's whole exposed parts once each, and its own ground", () => {
    expect(wholeInks(threeLetters)).toEqual({ inks: [GREEN, NEAR_BLACK], own: "light" });
    expect(wholeInks(box(blank(20, 10), 2, 2, 18, 8, [255, 255, 255]))).toEqual({ inks: [[255, 255, 255]], own: "dark" });
    expect(wholeInks(blank(8, 8))).toEqual({ inks: [], own: "light" });
  });

  it("holds a file to its weakest whole part: the average of its ink says nothing", () => {
    const { inks } = wholeInks(threeLetters);
    // The near-black letter vanishes on a near-black ground that the two green letters stand out on.
    expect(contrast(GREEN, [26, 26, 26])).toBeGreaterThan(3);
    expect(contrast(NEAR_BLACK, [26, 26, 26])).toBeLessThan(1.1);
    expect(showsWhole(inks, [26, 26, 26])).toBe(false);
    expect(showsWhole(inks, [255, 255, 255])).toBe(true);
    expect(showsWhole([], [26, 26, 26])).toBe(true);
  });

  it("rests a file on the settings background when it shows whole there, and on the neutral of its own ground when it does not", () => {
    const { inks, own } = wholeInks(threeLetters);
    expect(restGround(inks, "#fafafa", own)).toEqual({ ground: "#FAFAFA", from: "settings" });
    expect(restGround(inks, "#1A1A1A", own)).toEqual({ ground: "#FFFFFF", from: "pole" });
    expect(restGround([[255, 255, 255]], "#ffffff", "dark")).toEqual({ ground: "#0B0E1A", from: "pole" });
    // A background that is no color says nothing: the own neutral.
    expect(restGround(inks, "blue", own)).toEqual({ ground: "#FFFFFF", from: "pole" });
  });

  it("knows a part that does not show on a ground from a part that is only weak there", () => {
    const { inks } = wholeInks(threeLetters);
    // The near-black letter on a near-black ground, and a green letter on a green: not a part of its own there.
    expect(hidesPart(inks, [26, 26, 26])).toBe(true);
    expect(hidesPart(inks, [40, 140, 70])).toBe(true);
    // A black wordmark on a near-black 35 apart in a channel (1.29:1) does not show either.
    expect(hidesPart([[0, 0, 0]], [0x23, 0x1f, 0x20])).toBe(true);
    // Under 3:1 is not that: a lighter green shows on a light gray.
    expect(contrast([120, 200, 90], [240, 240, 240])).toBeLessThan(3);
    expect(hidesPart([[120, 200, 90], NEAR_BLACK], [240, 240, 240])).toBe(false);
    // An orange part on a coral of nearly its lightness does not, whatever its hue.
    expect(contrast([255, 157, 47], [252, 128, 91])).toBeLessThan(1.3);
    expect(hidesPart([[255, 157, 47]], [252, 128, 91])).toBe(true);
    expect(hidesPart([], [26, 26, 26])).toBe(false);
  });

  it("rests a file with a light and a dark part on a gray both show on, and never on a neutral that hides one while another ground is free of that", () => {
    // A navy wordmark with a white letter, and brand colors that are no help: white hides the letter, the dark neutral nearly hides the navy.
    const NAVY: Rgb = [20, 30, 70], WHITE: Rgb = [255, 255, 255];
    const navyWhite = box(box(blank(64, 20), 2, 2, 54, 18, NAVY), 56, 2, 62, 18, WHITE);
    const { inks, own } = wholeInks(navyWhite);
    expect(inks).toEqual([NAVY, WHITE]);
    expect(hidesPart(inks, LIGHT)).toBe(true);
    expect(weakestContrast(inks, DARK)).toBeLessThan(1.5);
    const gray = bestNeutral(inks, own);
    expect(gray).toMatch(/^#([0-9A-F]{2})\1\1$/);
    const g = parseInt(gray.slice(1, 3), 16);
    expect(showsWhole(inks, [g, g, g])).toBe(true);
    expect(restGround(inks, "#FFFFFF", own)).toEqual({ ground: gray, from: "pole" });
    expect(restGround(inks, "#0B0E1A", own)).toEqual({ ground: gray, from: "pole" });
    // A black half and a white half: the gray between them, at the same contrast with each.
    const halves = bestNeutral([[0, 0, 0], [255, 255, 255]], "light");
    const h = parseInt(halves.slice(1, 3), 16);
    expect(contrast([0, 0, 0], [h, h, h])).toBeGreaterThan(4);
    expect(contrast([255, 255, 255], [h, h, h])).toBeGreaterThan(4);
    // Every file that shows whole on the neutral of its own ground rests there, as before.
    expect(bestNeutral([[20, 30, 60]], "light")).toBe("#FFFFFF");
    expect(bestNeutral([[255, 255, 255], [250, 100, 110]], "dark")).toBe("#0B0E1A");
    expect(bestNeutral([[40, 120, 235]], "dark")).toBe("#0B0E1A");
    expect(bestNeutral([], "light")).toBe("#FFFFFF");
    // Two inks neither neutral shows whole: the neutral the weakest one shows best on, never the one that hides a part.
    expect(bestNeutral([GREEN, NEAR_BLACK], "light")).toBe("#FFFFFF");
    expect(bestNeutral([GREEN, NEAR_BLACK], "dark")).toBe("#FFFFFF");
  });

  it("keeps a row's background when no neutral shows the file better, and a person's background unless it hides a part", () => {
    const { inks, own } = wholeInks(threeLetters);
    // A light gray the green has under 3:1 on: white shows the green better, so a row the lifecycle wrote rests on white.
    expect(contrast(GREEN, [215, 215, 215])).toBeLessThan(contrast(GREEN, [255, 255, 255]));
    expect(restGround(inks, "#D7D7D7", own)).toEqual({ ground: "#FFFFFF", from: "pole" });
    // A person chose that gray: it is believed, as a post of the client's is.
    expect(restGround(inks, "#D7D7D7", own, true)).toEqual({ ground: "#D7D7D7", from: "settings" });
    // A person's background a part does not show on is not: their file rests on its neutral, and nothing of theirs is written.
    expect(restGround(inks, "#1A1A1A", own, true)).toEqual({ ground: "#FFFFFF", from: "pole" });
  });
});

describe("the same logo in another tone", () => {
  const stored = mark(120, 48, [24, 28, 40]);
  const parts = partsOf(stored);

  it("knows the same logo in another tone and refuses another logo, a copy on the same ground and a narrower file", () => {
    expect(sameLogo(stored, parts, inked(stored, [255, 255, 255]))).toEqual({ same: true, overlap: 1 });

    // Redrawn at 61% of the width: the same shape, and too small to stamp.
    const narrow: Raster = { width: 73, height: 29, data: resampleRGBA(inked(stored, [255, 255, 255]).data, 120, 48, 73, 29) };
    const smaller = sameLogo(stored, parts, narrow);
    expect(smaller.same).toBe(false);
    expect(smaller.overlap).toBeGreaterThanOrEqual(0.9);

    // Another logo that fills the same box.
    const another = box(box(blank(120, 48), 0, 0, 120, 12, [255, 255, 255]), 50, 12, 70, 48, [255, 255, 255]);
    const different = sameLogo(stored, parts, another);
    expect(different.same).toBe(false);
    expect(different.overlap).toBeLessThan(0.9);

    // The same logo in another dark ink is made for the same ground.
    expect(sameLogo(stored, parts, inked(stored, [60, 20, 20]))).toEqual({ same: false, overlap: 1 });

    // A file of another shape.
    expect(sameLogo(stored, parts, mark(120, 60, [255, 255, 255])).same).toBe(false);
  });
});

describe("the color distance between a file and a picture", () => {
  const file = mark(40, 16, [100, 100, 100]);
  const rect = { x: 30, y: 20, width: 80, height: 32 };
  const pictureWith = (color: Rgb) => drawLogo(flat(160, 100, [10, 12, 30]), file, rect, color);

  it("measures the color distance over the file's solid ink only, and skips pixels off the picture", () => {
    expect(colorGap(pictureWith([100, 100, 100]), file, rect)).toBe(0);
    expect(colorGap(pictureWith([103, 104, 100]), file, rect)).toBeCloseTo(5, 10);
    // Ink under alpha 128 is not measured: a faint bar over the ground does not move the distance.
    const faint = box({ width: 40, height: 16, data: new Uint8ClampedArray(file.data) }, 36, 0, 40, 8, [250, 0, 0], 100);
    expect(colorGap(pictureWith([100, 100, 100]), faint, rect)).toBe(0);
    // A rectangle that runs off the picture is measured over the part that is on it.
    const off = { x: 120, y: 20, width: 80, height: 32 };
    const picture = drawLogo(flat(160, 100, [10, 12, 30]), file, off, [100, 100, 100]);
    expect(colorGap(picture, file, off)).toBe(0);
    expect(colorGap(picture, file, { x: 400, y: 20, width: 80, height: 32 })).toBe(Infinity);
  });

  it("says a post shows the file closest to it in color, and the stored file when equal", () => {
    const stored = file, white = inked(file, [200, 200, 200]);
    const found: Found = { index: 0, matched: "stored", rect, score: 0.9, usual: rect, scores: [0.9] };
    const templates = [{ file: "stored" as const, raster: stored, ground: DARK }];
    const compare = [{ file: "white" as const, raster: white }];
    const order = ["stored", "other", "white"] as const;
    const closer = nameFile(pictureWith([160, 160, 160]), found, templates, compare, [...order]);
    expect(closer.file).toBe("white");
    expect(closer.gaps.white).toBeLessThan(closer.gaps.stored!);
    const equal = nameFile(pictureWith([150, 150, 150]), found, templates, compare, [...order]);
    expect(equal.gaps.stored).toBe(equal.gaps.white);
    expect(equal.file).toBe("stored");
    // With the white file first in the order, the same tie goes to it.
    expect(nameFile(pictureWith([150, 150, 150]), found, templates, compare, ["white", "stored", "other"]).file).toBe("white");
  });
});

describe("the ground around a found logo", () => {
  it("takes the ground around the found logo from outside its rectangle, as a real pixel", () => {
    // The left 100 columns are one color, the rest another; the logo sits on the left part.
    const twoColors = () => box(flat(200, 120, [200, 60, 40]), 0, 0, 100, 120, [20, 40, 90]);
    const rect = { x: 20, y: 40, width: 60, height: 20 };
    const got = groundAround(drawLogo(twoColors(), mark(40, 16, [255, 255, 255]), rect), rect)!;
    expect(got.ground).toEqual([20, 40, 90]);
    // The widened rectangle runs from x = 5 to 95 and y = 30 to 70: every sampled pixel is on the left color.
    expect(got.flat).toBe(1);

    // Moved right, the widened rectangle crosses onto the other color: the ground is still the color most of it has.
    const across = { x: 30, y: 40, width: 60, height: 20 };
    const second = groundAround(drawLogo(twoColors(), mark(40, 16, [255, 255, 255]), across), across)!;
    expect(second.ground).toEqual([20, 40, 90]);
    let left = 0, all = 0;
    for (let y = 30; y < 70; y += 2) for (let x = 15; x < 105; x += 2) {
      if (x >= 30 && x < 90 && y >= 40 && y < 60) continue;
      all++;
      if (x < 100) left++;
    }
    expect(second.flat).toBeCloseTo(left / all, 10);
    // The logo's own pixels are never sampled, whatever color they are.
    expect(groundAround(drawLogo(flat(200, 120, [20, 40, 90]), flat(4, 4, [255, 255, 255]), rect), rect)).toEqual({ ground: [20, 40, 90], flat: 1 });
    // Nothing to sample: the rectangle covers the picture.
    expect(groundAround(flat(20, 10, [1, 2, 3]), { x: -40, y: -40, width: 400, height: 400 })).toBeNull();
  });
});

describe("the search over one or two templates", () => {
  const W = 320, H = 240;
  const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
  const scales: [number, number] = [0.45, 1.35];
  const shape = mark(40, 16, [24, 28, 40]);
  const usual = canvasLogoRect(placement, 40, 16, W, H);
  const drawn = { x: usual.x + 6, y: usual.y + 4, width: Math.round(usual.width * 0.8), height: Math.round((usual.width * 0.8 * 16) / 40) };
  const whiteOn = (ground: Rgb) => drawLogo(flat(W, H, ground), shape, drawn, [255, 255, 255]);

  it("answers the better of two templates, the first when equal, with each score", () => {
    const design = whiteOn([10, 12, 30]);
    const stored = { file: "stored" as const, raster: shape, ground: LIGHT };
    const other = { file: "other" as const, raster: inked(shape, [255, 255, 255]), ground: DARK };
    const found = searchTemplates(design, [stored, other], placement, scales);
    expect(found.index).toBe(1);
    expect(found.matched).toBe("other");
    expect(found.scores).toHaveLength(2);
    expect(found.score).toBe(found.scores[1]);
    expect(found.scores[1]).toBeGreaterThanOrEqual(0.75);
    expect(found.scores[1]).toBeGreaterThan(found.scores[0]);
    expect(found.usual).toEqual(usual);
    expect(logoFound({ width: found.rect.width, score: found.score }, found.usual.width)).toBe(true);
    expect(Math.abs(found.rect.x - drawn.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(found.rect.width - drawn.width)).toBeLessThanOrEqual(3);

    // The same pixels under two names: the first wins.
    const twice = searchTemplates(design, [{ ...other, file: "stored" }, other], placement, scales);
    expect(twice.scores[0]).toBe(twice.scores[1]);
    expect(twice.matched).toBe("stored");
    expect(twice.index).toBe(0);

    // One template.
    const one = searchTemplates(design, [other], placement, scales);
    expect(one.scores).toEqual([found.scores[1]]);
    expect(one.rect).toEqual(found.rect);
  });

  it("prefers a template that passes the size test over a higher score at an end of the sizes searched", () => {
    // The logo drawn in white at a size the client uses, and beside it a small light block that a half-inked
    // second file matches exactly, and only at the smallest size searched.
    const design = box(whiteOn([10, 12, 30]), 22, 20, 40, 34, [255, 255, 255]);
    const stored = { file: "stored" as const, raster: inked(shape, [255, 255, 255]), ground: DARK };
    const other = { file: "other" as const, raster: box(blank(40, 16), 0, 0, 20, 16, [255, 255, 255]), ground: DARK };
    const pass = (f: Found) => logoFound({ width: f.rect.width, score: f.score }, f.usual.width);
    // Alone, the second file scores higher than the first and fails the size half of the one test.
    const alone = searchTemplates(design, [other], placement, scales);
    const first = searchTemplates(design, [stored], placement, scales);
    expect(alone.score).toBeGreaterThan(first.score);
    expect(pass(alone)).toBe(false);
    expect(pass(first)).toBe(true);
    // Together: the match that is the logo by the one test is answered, with both scores.
    const found = searchTemplates(design, [stored, other], placement, scales);
    expect(found).toMatchObject({ index: 0, matched: "stored", score: first.score, rect: first.rect });
    expect(found.scores).toEqual([first.score, alone.score]);
    expect(pass(found)).toBe(true);
    expect(searchTemplates(design, [other, stored], placement, scales)).toMatchObject({ index: 1, matched: "stored", scores: [alone.score, first.score] });
    // When no template passes, the better score is answered as before.
    const none = box(flat(W, H, [10, 12, 30]), 22, 20, 40, 34, [255, 255, 255]);
    const best = searchTemplates(none, [stored, other], placement, scales);
    expect(best.matched).toBe("other");
    expect(pass(best)).toBe(false);
  });

  it("names the white file when the drawn logo is white on a mid-tone ground, whichever template matched", () => {
    // A mid-tone file that shows on both grounds, drawn in white on a mid-tone picture.
    const mid: Rgb = [40, 120, 235];
    const stored = inked(shape, mid), white = inked(shape, [255, 255, 255]);
    const design = whiteOn([150, 110, 80]);
    const templates = [{ file: "white" as const, raster: white, ground: [42, 149, 253] as Rgb }, { file: "stored" as const, raster: stored, ground: LIGHT }];
    const found = searchTemplates(design, templates, placement, scales);
    expect(found.score).toBeGreaterThanOrEqual(0.75);
    const named = nameFile(design, found, templates, [], [found.matched, "stored", "other", "white"]);
    expect(named.file).toBe("white");
    expect(named.gaps.white).toBeLessThan(named.gaps.stored!);

    // The stored file's own template matches the same drawing (the score compares light and dark, never color), and the white file is still named.
    const fromStored = [{ file: "stored" as const, raster: stored, ground: DARK }];
    const again = searchTemplates(design, fromStored, placement, scales);
    expect(again.matched).toBe("stored");
    expect(again.score).toBeGreaterThanOrEqual(0.75);
    expect(nameFile(design, again, fromStored, [{ file: "white", raster: white }], ["stored", "stored", "other", "white"]).file).toBe("white");
  });

  it("stamps only a file that serves the ground the matched template covers, whatever a color distance says", () => {
    // A two-ink file made for light pictures and its copy for dark ones: one small dark part turned white.
    const stored = box(inked(shape, [60, 170, 90]), 25, 1, 28, 4, [24, 28, 40]);
    const copy = box(inked(shape, [60, 170, 90]), 25, 1, 28, 4, [255, 255, 255]);
    // Drawn on a dark picture with the small part left as dark as the ground: the copy's template still matches, and the stored file is closer in color.
    const ground: Rgb = [20, 24, 36];
    const design = drawLogo(flat(W, H, ground), box(inked(shape, [60, 170, 90]), 25, 1, 28, 4, ground), drawn);
    const templates = (names?: LogoFileName[]) => [
      { file: "other" as const, raster: copy, ground: DARK, ...(names ? { names } : {}) },
      { file: "stored" as const, raster: stored, ground: LIGHT, ...(names ? { names: [] as LogoFileName[] } : {}) },
    ];
    const found = searchTemplates(design, templates(), placement, scales);
    expect(found.matched).toBe("other");
    expect(found.score).toBeGreaterThanOrEqual(0.75);
    // With no list, as a job from before this rule sends it: the closest in color, which here is a file made for light pictures.
    const before = nameFile(design, found, templates(), [], ["other", "stored", "other", "white"]);
    expect(before.file).toBe("stored");
    // With the list: the stored file does not serve the dark ground, so the copy is stamped. Both distances are still measured.
    const named = nameFile(design, found, templates([]), [], ["other", "stored", "other", "white"]);
    expect(named.file).toBe("other");
    expect(named.gaps.stored).toBeLessThan(named.gaps.other!);
    // A file the list names may win.
    expect(nameFile(design, found, templates(["stored"]), [], ["other", "stored", "other", "white"]).file).toBe("stored");
    // A file to compare is held to the same list.
    const white = { file: "white" as const, raster: stored };
    expect(nameFile(design, found, templates([]), [white], ["other", "stored", "other", "white"]).file).toBe("other");
    expect(nameFile(design, found, templates(["white"]), [white], ["other", "stored", "other", "white"]).file).toBe("white");
  });

  it("names a person's file when its template matched and measures nothing", () => {
    const design = whiteOn([10, 12, 30]);
    const templates = [
      { file: "stored" as const, raster: shape, ground: LIGHT },
      { file: "other" as const, raster: inked(shape, [255, 255, 255]), ground: DARK, fixed: true },
    ];
    const found = searchTemplates(design, templates, placement, scales);
    expect(found.matched).toBe("other");
    expect(nameFile(design, found, templates, [{ file: "white", raster: inked(shape, [250, 250, 250]) }], ["other", "stored", "other", "white"])).toEqual({ file: "other", gaps: {} });

    // When the stored file's template matched, a person's file is left out of the comparison.
    const dark = drawLogo(flat(W, H, [250, 250, 250]), shape, drawn, [24, 28, 40]);
    const onLight = searchTemplates(dark, templates, placement, scales);
    expect(onLight.matched).toBe("stored");
    const named = nameFile(dark, onLight, templates, [], ["stored", "stored", "other", "white"]);
    expect(named.file).toBe("stored");
    expect(Object.keys(named.gaps)).toEqual(["stored"]);
  });

  it("names no file one of whose whole parts does not show on the picture's ground around the found logo", () => {
    // A two-ink file made for light pictures (a green body and a near-black part of over 1% of its ink) and its copy with that part in white.
    const GREEN: Rgb = [60, 170, 90], NEAR_BLACK: Rgb = [26, 25, 25];
    const stored = box(inked(shape, GREEN), 24, 0, 40, 7, NEAR_BLACK);
    const copy = box(inked(shape, GREEN), 24, 0, 40, 7, [255, 255, 255]);
    expect(wholeInks(stored).inks).toEqual([GREEN, NEAR_BLACK]);
    // The model kept the canvas logo and painted a near-black band behind it: two colors of three show.
    const band: Rgb = [28, 28, 27];
    const kept = drawLogo(flat(W, H, band), stored, drawn);
    // Read as on 16 Nov, with the file over that near-black ground, the match is high: the score does not know a part is gone.
    const blind = [{ file: "stored" as const, raster: stored, ground: [26, 26, 26] as Rgb }];
    const found = searchTemplates(kept, blind, placement, scales);
    expect(found.score).toBeGreaterThanOrEqual(0.75);
    const around = groundAround(kept, found.rect)!;
    expect(around.ground).toEqual(band);
    // Without the picture's ground the stored file is named, as before; with it, no file is.
    expect(nameFile(kept, found, blind, [], ["stored", "stored", "other", "white"]).file).toBe("stored");
    expect(nameFile(kept, found, blind, [], ["stored", "stored", "other", "white"], around.ground)).toEqual({ file: null, gaps: { stored: expect.any(Number) } });
    expect(lostOn(kept, stored, found.rect)).toEqual({ ground: band, lost: true });
    // A file the matched template lists and that shows there is named in its place: the copy with the white part.
    const listed = [{ ...blind[0], names: ["other"] as LogoFileName[] }];
    expect(nameFile(kept, found, listed, [{ file: "other", raster: copy }], ["stored", "stored", "other", "white"], around.ground).file).toBe("other");
    // A file that is not listed is not, whatever it would show.
    expect(nameFile(kept, found, [{ ...blind[0], names: [] }], [{ file: "other", raster: copy }], ["stored", "stored", "other", "white"], around.ground).file).toBeNull();
    // A person's file is held to the same ground.
    expect(nameFile(kept, found, [{ ...blind[0], fixed: true }], [], ["stored"], around.ground)).toEqual({ file: null, gaps: {} });

    // The whole logo in one ink, kept on a picture of that ink's own color: no file.
    const one = inked(shape, [0, 191, 217]);
    const same = drawLogo(flat(W, H, [4, 186, 212]), one, drawn, [0, 191, 217]);
    expect(lostOn(same, one, drawn)).toEqual({ ground: [4, 186, 212], lost: true });

    // A part that is only weak on the ground still shows (2.37:1 here, as one client's own posts show its green).
    const light: Rgb = [232, 232, 232];
    const onLight = drawLogo(flat(W, H, light), stored, drawn);
    const template = [{ file: "stored" as const, raster: stored, ground: light }];
    const seen = searchTemplates(onLight, template, placement, scales);
    expect(contrast(GREEN, light)).toBeLessThan(3);
    expect(nameFile(onLight, seen, template, [], ["stored"], groundAround(onLight, seen.rect)!.ground).file).toBe("stored");
    // An orange mark kept on a coral of nearly its lightness does not show, whatever its hue.
    const orange = inked(shape, [255, 157, 47]);
    const coral = drawLogo(flat(W, H, [252, 128, 91]), orange, drawn);
    expect(contrast([255, 157, 47], [252, 128, 91])).toBeLessThan(1.3);
    expect(lostOn(coral, orange, drawn)).toEqual({ ground: [252, 128, 91], lost: true });
    // A black wordmark kept on a near-black 35 apart in a channel: matched well, and lost.
    const black = inked(shape, [0, 0, 0]);
    const nearBlack = drawLogo(flat(W, H, [0x23, 0x1f, 0x20]), black, drawn);
    const onNearBlack = [{ file: "stored" as const, raster: black, ground: [255, 255, 255] as Rgb }];
    const kept2 = searchTemplates(nearBlack, onNearBlack, placement, scales);
    expect(nameFile(nearBlack, kept2, onNearBlack, [], ["stored"], groundAround(nearBlack, kept2.rect)!.ground).file).toBeNull();
    expect(lostOn(nearBlack, black, drawn)).toEqual({ ground: [0x23, 0x1f, 0x20], lost: true });
    // A rectangle with nothing around it to sample says nothing.
    expect(lostOn(flat(8, 8, band), stored, { x: 0, y: 0, width: 8, height: 8 })).toEqual({ ground: null, lost: false });
  });

  it("gives a file of another shape its own height around the same center, and nothing for a file of the same shape", () => {
    const rect = { x: 100, y: 50, width: 200, height: 80 };
    expect(stampRect(rect, blank(40, 16), blank(40, 16))).toBeNull();
    expect(stampRect(rect, blank(40, 16), blank(400, 168))).toEqual({ x: 100, y: 48, width: 200, height: 84 });
    expect(stampRect(rect, blank(40, 16), blank(80, 30))).toEqual({ x: 100, y: 53, width: 200, height: 75 });
  });
});

// ── The choice ──────────────────────────────────────────────────────────────

const OF = "c1/design-settings/logo-site-aaaa.png";
const MADE = { other: "c1/design-settings/logo-0123456789abcdef-other.png", white: "c1/design-settings/logo-0123456789abcdef-white.png" };
const NO_PATHS: SetPaths = { other: null, white: null, site: null, person: null };
const AT = "2026-11-16T09:00:00.000Z";

/** What the service answered about a stored file: a dark one-color logo with both copies made, unless said otherwise. */
function facts(over: Partial<LogoSetResult> = {}): LogoSetResult {
  return {
    size: { width: 300, height: 90 }, own: "light", both: false,
    made: { other: { turned: 1 }, white: { turned: 1 } },
    site: null, person: null,
    inks: { stored: [{ color: [20, 30, 60], share: 1 }], other: [{ color: [255, 255, 255], share: 1 }], white: [{ color: [255, 255, 255], share: 1 }] },
    ...over,
  };
}
/** A post with a found logo that shows `shows` on `ground`. */
function post(shows: LogoFileName, ground: Rgb = [16, 40, 76], flat = 0.9, matched: LogoFileName = shows === "white" ? "stored" : shows): PostLogo {
  return { found: true, score: 0.95, matched, rect: { x: 10, y: 10, width: 100, height: 30 }, gaps: { [shows]: 12 }, shows, ground, flat };
}
const MISSED: PostLogo = { found: false, score: 0.31 };
const choose = (over: Partial<Parameters<typeof chooseSet>[0]> = {}): LogoSet =>
  chooseSet({ of: OF, source: "lifecycle", background: "#fafafa", facts: facts(), paths: { ...NO_PATHS, ...MADE }, posts: [], at: AT, ...over });

describe("which files a client's set holds", () => {
  it("uses a copy only when a post shows it", () => {
    // A post in a third color is closer to the stored file: the copy is left out, and kept on record.
    const none = choose({ posts: [post("stored"), MISSED, null] });
    expect(none.other).toBeNull();
    expect(none.white).toBeNull();
    expect(none.made).toEqual(MADE);
    expect(none.posts).toEqual({ read: 2, found: 1, shown: { stored: 1, other: 0, white: 0 } });
    expect(none).toMatchObject({ of: OF, rule: 2, own: "light", both: false, site: null, at: AT });
    // The colors of the stored file's whole parts are kept, each once, for the ground a design starts from.
    expect(none.inks).toEqual([[20, 30, 60]]);
    const twoParts = facts({ inks: { stored: [{ color: [20, 30, 60], share: 0.4 }, { color: [120, 200, 90], share: 0.3 }, { color: [20, 30, 60], share: 0.3 }], other: null, white: null } });
    expect(choose({ facts: twoParts }).inks).toEqual([[20, 30, 60], [120, 200, 90]]);

    const shown = choose({ posts: [post("other"), post("stored"), post("white")] });
    expect(shown.other).toEqual({ path: MADE.other, from: "made", size: [300, 90] });
    expect(shown.white).toEqual({ path: MADE.white });
    expect(shown.posts.shown).toEqual({ stored: 1, other: 1, white: 1 });

    // A copy the rule dropped does not exist, whatever a post says.
    const dropped = choose({ facts: facts({ made: { other: { turned: 1 }, white: null } }), paths: { ...NO_PATHS, other: MADE.other }, posts: [post("white")] });
    expect(dropped.white).toBeNull();
    expect(dropped.made).toEqual({ other: MADE.other, white: null });
  });

  it("puts a person's file second and the website file after it, and takes a white copy only from the stored file", () => {
    const person = "c1/design-settings/logo-other-9.png", site = "c1/design-settings/logo-site-bbbb.png";
    const both = facts({ site: { index: 2, overlap: 0.97, size: { width: 640, height: 190 } }, person: { size: { width: 500, height: 200 } } });
    // A brand's own file needs no post to show it.
    const withPerson = choose({ facts: both, paths: { ...MADE, site, person } });
    expect(withPerson.other).toEqual({ path: person, from: "person", size: [500, 200] });
    expect(withPerson.site).toBe(site);
    expect(withPerson.made).toEqual(MADE);
    expect("person" in withPerson).toBe(false);
    const withSite = choose({ facts: { ...both, person: null }, paths: { ...MADE, site, person: null } });
    expect(withSite.other).toEqual({ path: site, from: "site", size: [640, 190] });
    // The white file is the stored file's white copy, and still needs a post.
    expect(withSite.white).toBeNull();
    expect(choose({ facts: { ...both, person: null }, paths: { ...MADE, site, person: null }, posts: [post("white")] }).white).toEqual({ path: MADE.white });
  });
});

describe("which file the canvas carries, and on what ground", () => {
  it("carries the file most found posts show, and the stored file on a tie or with no found post", () => {
    expect(choose({ posts: [post("other"), post("other"), post("stored")] }).canvas.file).toBe("other");
    expect(choose({ posts: [post("other"), post("stored")] }).canvas.file).toBe("stored");
    expect(choose({ posts: [post("white"), post("white"), post("other"), post("other")] }).canvas.file).toBe("other");
    expect(choose({ posts: [post("white"), post("white"), post("other")] }).canvas.file).toBe("white");
    expect(choose({ posts: [MISSED, null] }).canvas).toEqual({ file: "stored", ground: "#FAFAFA", from: "settings" });
  });

  it("takes the most typical ground the canvas file shows on, then the flatter one, then the earlier post", () => {
    // Five grounds, two of them the same: that one is closest to the others.
    const five = choose({ posts: [post("other", [59, 56, 73]), post("other", [59, 57, 70]), post("other", [12, 42, 80]), post("other", [15, 41, 76], 0.5), post("other", [15, 41, 76], 0.8)] });
    expect(five.canvas).toEqual({ file: "other", ground: "#0F294C", from: "client_posts" });
    // Two grounds at equal sums: the flatter.
    expect(choose({ posts: [post("other", [10, 20, 30], 0.4), post("other", [40, 20, 30], 0.7)] }).canvas.ground).toBe("#28141E");
    // Equal flatness: the earlier post.
    expect(choose({ posts: [post("other", [10, 20, 30], 0.7), post("other", [40, 20, 30], 0.7)] }).canvas.ground).toBe("#0A141E");
  });

  it("puts the grounds the canvas file shows whole on first", () => {
    // White ink does not show on the pale ground two posts have; it does on the third.
    expect(contrast([255, 255, 255], [199, 171, 134])).toBeLessThan(3);
    const set = choose({ posts: [post("other", [199, 171, 134]), post("other", [199, 171, 134]), post("other", [42, 100, 200], 0.2)] });
    expect(set.canvas).toEqual({ file: "other", ground: "#2A64C8", from: "client_posts" });
  });

  it("uses a ground the client's posts show the file on under 3:1 when they show it on no other", () => {
    // A file of two inks made for light pictures. Its posts show it on a light gray where the green has under 3:1.
    const twoInks = facts({ inks: { stored: [{ color: [20, 30, 60], share: 0.6 }, { color: [120, 200, 90], share: 0.4 }], other: null, white: null }, made: { other: null, white: null } });
    expect(contrast([20, 30, 60], [240, 240, 240])).toBeGreaterThan(3);
    expect(contrast([120, 200, 90], [240, 240, 240])).toBeLessThan(3);
    // The brand shows its logo there: the bar does not overrule the brand's own posts.
    expect(choose({ facts: twoInks, paths: NO_PATHS, posts: [post("stored", [240, 240, 240]), post("stored", [240, 240, 238], 0.4)] }).canvas).toEqual({ file: "stored", ground: "#F0F0F0", from: "client_posts" });
    // The same file with a dark settings background and as many posts for its copy: the stored file, on the ground its own posts have.
    const withCopy = facts({ inks: { stored: [{ color: [60, 170, 90], share: 0.76 }, { color: [26, 25, 25], share: 0.24 }], other: [{ color: [60, 170, 90], share: 0.76 }, { color: [255, 255, 255], share: 0.24 }], white: null }, made: { other: { turned: 0.24 }, white: null } });
    const set = choose({ facts: withCopy, paths: { ...NO_PATHS, other: MADE.other }, background: "#1A1A1A", posts: [post("stored", [232, 232, 232]), post("stored", [232, 232, 232]), post("other", [26, 26, 26]), post("other", [26, 26, 26])] });
    expect(set.canvas).toEqual({ file: "stored", ground: "#E8E8E8", from: "client_posts" });
    expect(set.other?.from).toBe("made");
  });

  it("never carries a file on a ground where a whole part of it is no longer a part of its own, even when posts show it there", () => {
    // Two inks. On the dark blue two posts have, the navy ink has under 1.2:1: it does not show there.
    const twoInks = facts({ inks: { stored: [{ color: [20, 30, 60], share: 0.6 }, { color: [120, 200, 90], share: 0.4 }], other: null, white: null }, made: { other: null, white: null } });
    expect(contrast([20, 30, 60], [24, 34, 64])).toBeLessThan(1.2);
    // The posts on the ground that hides a part are the majority; the one under 3:1 that hides nothing is used.
    const mixed = choose({ facts: twoInks, paths: NO_PATHS, background: "#FFFFFF", posts: [post("stored", [24, 34, 64]), post("stored", [24, 34, 64]), post("stored", [240, 240, 240], 0.4)] });
    expect(mixed.canvas).toEqual({ file: "stored", ground: "#F0F0F0", from: "client_posts" });
    // Posts only on grounds that hide a part say nothing usable: the file rests where rule 2 puts it. The green has about 2:1 on the
    // white background and the navy almost nothing on the dark neutral, so it rests on the gray between them, where each shows better.
    const only = choose({ facts: twoInks, paths: NO_PATHS, background: "#FFFFFF", posts: [post("stored", [24, 34, 64]), post("stored", [24, 34, 64])] });
    expect(only.canvas).toMatchObject({ file: "stored", from: "pole" });
    const g = parseInt(only.canvas.ground.slice(1, 3), 16);
    expect(only.canvas.ground).toBe(`#${g.toString(16).padStart(2, "0").repeat(3)}`.toUpperCase());
    expect(hidesPart([[20, 30, 60], [120, 200, 90]], [g, g, g])).toBe(false);
    expect(weakestContrast([[20, 30, 60], [120, 200, 90]], [g, g, g])).toBeGreaterThan(weakestContrast([[20, 30, 60], [120, 200, 90]], [255, 255, 255]));
    // The same file on a dark blue settings background that hides the same part rests there too.
    expect(choose({ facts: twoInks, paths: NO_PATHS, background: "#18223E", posts: [post("stored", [24, 34, 64])] }).canvas).toEqual(only.canvas);
    // A ground a part is only weak on (1.8:1 here) is still the brand's own.
    const weak = choose({ facts: twoInks, paths: NO_PATHS, background: "#FFFFFF", posts: [post("stored", [240, 240, 240])] });
    expect(weak.canvas).toEqual({ file: "stored", ground: "#F0F0F0", from: "client_posts" });
  });

  it("counts a post for a file's ground only when that file's own search found the logo there", () => {
    // A cyan file made for dark pictures. On one post a darker logo was found by the copy's search, and the stored file is only the closest in color.
    const cyan = facts({ own: "dark", inks: { stored: [{ color: [0, 193, 213], share: 1 }], other: [{ color: [11, 14, 26], share: 1 }], white: [{ color: [255, 255, 255], share: 1 }] } });
    const set = choose({ facts: cyan, background: "#0B0E1A", posts: [post("stored", [213, 238, 245], 0.99, "other")] });
    // The post still says the stored file is the closest, so no copy is used. It says nothing about where the stored file sits.
    expect(set.posts.shown).toEqual({ stored: 1, other: 0, white: 0 });
    expect(set.other).toBeNull();
    expect(set.canvas).toEqual({ file: "stored", ground: "#0B0E1A", from: "settings" });
    // The white file has no search of its own: it counts when it is the closest in color.
    const white = choose({ facts: cyan, background: "#0B0E1A", posts: [post("white", [1, 100, 120]), post("white", [1, 100, 120])] });
    expect(white.canvas).toEqual({ file: "white", ground: "#016478", from: "client_posts" });
  });

  it("rests the stored file on the settings background only when every whole part shows there, and another file on the neutral of the ground it serves", () => {
    // No post says where the stored file sits: the row's background, on which its one ink shows.
    expect(choose({ posts: [MISSED] }).canvas).toEqual({ file: "stored", ground: "#FAFAFA", from: "settings" });
    // A background chosen for the average of two inks, where the near-black one has 1.01:1: the file's own neutral.
    const twoInks = facts({ inks: { stored: [{ color: [60, 170, 90], share: 0.76 }, { color: [26, 25, 25], share: 0.24 }], other: null, white: null }, made: { other: null, white: null } });
    expect(contrast([26, 25, 25], [26, 26, 26])).toBeLessThan(1.1);
    expect(choose({ facts: twoInks, paths: NO_PATHS, background: "#1A1A1A", posts: [MISSED] }).canvas).toEqual({ file: "stored", ground: "#FFFFFF", from: "pole" });
    // A file other than the stored one whose posts do not count for its ground: the neutral of the ground it serves.
    expect(choose({ posts: [post("other", [240, 240, 240], 0.9, "stored")] }).canvas).toEqual({ file: "other", ground: "#0B0E1A", from: "pole" });
    const forDark = facts({ own: "dark", inks: { stored: [{ color: [255, 255, 255], share: 1 }], other: [{ color: [11, 14, 26], share: 1 }], white: null }, made: { other: { turned: 1 }, white: null } });
    expect(choose({ facts: forDark, paths: { ...NO_PATHS, other: MADE.other }, posts: [post("other", [20, 20, 20], 0.9, "stored")] }).canvas).toEqual({ file: "other", ground: "#FFFFFF", from: "pole" });
  });

  it("never rests a file on a neutral that hides a whole part of it: a dark file with a white part, and a white file with a dark part", () => {
    // No brand color helps (the background is white) and no post is found.
    const navyWhite = facts({ own: "light", inks: { stored: [{ color: [20, 30, 70], share: 0.92 }, { color: [255, 255, 255], share: 0.08 }], other: null, white: null }, made: { other: null, white: null } });
    const dark = choose({ facts: navyWhite, paths: NO_PATHS, background: "#FFFFFF", posts: [MISSED] });
    expect(dark.canvas.from).toBe("pole");
    const g = parseInt(dark.canvas.ground.slice(1, 3), 16);
    expect(showsWhole([[20, 30, 70], [255, 255, 255]], [g, g, g])).toBe(true);
    // A job started from that set never lays the file on white or on the dark neutral.
    const job = jobLogos({ logo_path: OF, background: "#FFFFFF", logo_set: dark })!;
    expect(job.background).toBe(dark.canvas.ground);
    expect(job.logos).toMatchObject({ canvas: "stored", second: null });
    // The mirror: a white wordmark with a near-black part, made for dark pictures, on a dark settings background.
    const whiteDark = facts({ own: "dark", inks: { stored: [{ color: [255, 255, 255], share: 0.7 }, { color: [12, 14, 24], share: 0.3 }], other: null, white: null }, made: { other: null, white: null } });
    const light = choose({ facts: whiteDark, paths: NO_PATHS, background: "#0B0E1A", posts: [MISSED] });
    const v = parseInt(light.canvas.ground.slice(1, 3), 16);
    expect(light.canvas.from).toBe("pole");
    expect(showsWhole([[255, 255, 255], [12, 14, 24]], [v, v, v])).toBe(true);
  });

  it("keeps a person's file as the canvas whatever the posts show, on their background when their file shows whole there", () => {
    const whiteLogo = facts({ own: "dark", inks: { stored: [{ color: [255, 255, 255], share: 1 }], other: [{ color: [11, 14, 26], share: 1 }], white: null }, made: { other: { turned: 1 }, white: null } });
    const set = choose({ source: "person", background: "#0c1d2f", facts: whiteLogo, paths: { ...NO_PATHS, other: MADE.other }, posts: [post("other", [240, 240, 240]), post("other", [240, 240, 240])] });
    expect(set.canvas).toEqual({ file: "stored", ground: "#0C1D2F", from: "settings" });
    // The file their posts show is still in the set, so a design drawn that way is recognized.
    expect(set.other?.from).toBe("made");
    // A background a whole part of their file does not show on (under 1.5:1): a design starts from the file's own neutral. Nothing of theirs is written.
    expect(choose({ source: "person", background: "#0c1d2f", posts: [post("other"), post("other")] }).canvas).toEqual({ file: "stored", ground: "#FFFFFF", from: "pole" });
    // A background their file is only weak on is theirs to choose, as a post of the client's is believed under 3:1.
    expect(contrast([20, 30, 60], [90, 100, 120])).toBeLessThan(3);
    expect(choose({ source: "person", background: "#5A6478", posts: [post("other"), post("other")] }).canvas).toEqual({ file: "stored", ground: "#5A6478", from: "settings" });
    // The same background on a row the lifecycle wrote gives way to the neutral the file shows better on.
    expect(choose({ background: "#5A6478", posts: [MISSED] }).canvas).toEqual({ file: "stored", ground: "#FFFFFF", from: "pole" });
  });
});

describe("the searches a post gets", () => {
  it("gives the stored file both grounds when it shows on both, and no second template when nothing serves the other ground", () => {
    const noCopy = { made: { other: null, white: { turned: 1 } }, inks: { stored: [{ color: [40, 120, 235] as Rgb, share: 1 }], other: null, white: [{ color: [255, 255, 255] as Rgb, share: 1 }] } };
    const both = postSearchPlan(OF, facts({ own: "dark", both: true, ...noCopy }), { ...NO_PATHS, white: MADE.white });
    expect(both.searches).toEqual([{ file: "stored", path: OF, ground: [11, 14, 26] }, { file: "stored", path: OF, ground: [255, 255, 255] }]);
    expect(both.compare).toEqual([{ file: "white", path: MADE.white }]);

    const one = postSearchPlan(OF, facts({ own: "dark", both: false, ...noCopy }), { ...NO_PATHS, white: MADE.white });
    expect(one.searches).toEqual([{ file: "stored", path: OF, ground: [11, 14, 26] }]);

    // The made copy searches the other ground; a website file comes before it, a person's file before both.
    expect(postSearchPlan(OF, facts(), { ...NO_PATHS, ...MADE }).searches[1]).toEqual({ file: "other", path: MADE.other, ground: [11, 14, 26] });
    expect(postSearchPlan(OF, facts(), { ...MADE, site: "c1/s.png", person: null }).searches[1]).toEqual({ file: "other", path: "c1/s.png", ground: [11, 14, 26] });
    expect(postSearchPlan(OF, facts(), { ...MADE, site: "c1/s.png", person: "c1/p.png" }).searches[1]).toEqual({ file: "other", path: "c1/p.png", ground: [11, 14, 26], fixed: true });
    expect(postSearchPlan(OF, facts(), NO_PATHS).compare).toEqual([]);
  });
});

describe("what a job reads from the set", () => {
  const row = (set: unknown, over: Record<string, unknown> = {}) => ({ logo_path: OF, background: "#FAFAFA", logo_set: set, ...over });
  /** A set for a file of one dark ink made for light pictures; `over.own: "dark"` makes it one white ink unless inks are given. */
  const stored = (over: Partial<LogoSet> = {}): LogoSet => ({
    of: OF, rule: 2, own: "light", both: false, other: null, white: null, made: { other: null, white: null }, site: null,
    inks: over.both ? [[40, 120, 235]] : over.own === "dark" ? [[255, 255, 255]] : [[20, 30, 60]],
    posts: { read: 0, found: 0, shown: { stored: 0, other: 0, white: 0 } }, canvas: { file: "stored", ground: "#FAFAFA", from: "settings" }, at: AT, ...over,
  });
  const made = { path: MADE.other, from: "made" as const, size: [300, 90] as [number, number] };

  it("builds the job's templates, compare list and fixed list from a set", () => {
    // The copy on the canvas: the stored file covers its own ground second.
    expect(jobLogos(row(stored({ other: made, canvas: { file: "other", ground: "#0F294C", from: "client_posts" } })))).toEqual({
      logo_path: MADE.other, background: "#0F294C",
      logos: { files: { stored: OF, other: MADE.other }, canvas: "other", second: { file: "stored", ground: "#FFFFFF" }, fixed: [], names: { canvas: [], second: [] } },
    });
    // The stored file on the canvas: the copy covers the other ground.
    expect(jobLogos(row(stored({ other: made })))).toEqual({
      logo_path: OF, background: "#FAFAFA",
      logos: { files: { stored: OF, other: MADE.other }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: [], names: { canvas: [], second: [] } },
    });
    // A file that shows on both grounds, with its white copy on the canvas: the stored file covers the light ground, and may be stamped on a dark one too.
    expect(jobLogos(row(stored({ own: "dark", both: true, white: { path: MADE.white }, canvas: { file: "white", ground: "#2A95FD", from: "client_posts" } })))).toEqual({
      logo_path: MADE.white, background: "#2A95FD",
      logos: { files: { stored: OF, white: MADE.white }, canvas: "white", second: { file: "stored", ground: "#FFFFFF" }, fixed: [], names: { canvas: ["stored"], second: [] } },
    });
    // Nothing serves the light ground: one template. The white file serves the dark ground the stored file is on.
    expect(jobLogos(row(stored({ own: "dark", white: { path: MADE.white } }), { background: "#0B0E1A" }))?.logos).toEqual({ files: { stored: OF, white: MADE.white }, canvas: "stored", second: null, fixed: [], names: { canvas: ["white"], second: [] } });
    // The stored file serves both grounds with no other file: it is the second template too, over the neutral its canvas color does not sit on.
    expect(jobLogos(row(stored({ own: "dark", both: true }), { background: "#101820" }))?.logos.second).toEqual({ file: "stored", ground: "#FFFFFF" });
    // A person's file is marked, and is never in a list of names.
    const person = { path: "c1/design-settings/logo-other-9.png", of: OF, at: AT };
    expect(jobLogos(row(stored({ other: { path: person.path, from: "person", size: [500, 200] }, white: { path: MADE.white }, person })))?.logos).toEqual({
      files: { stored: OF, other: person.path, white: MADE.white }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: ["other"], names: { canvas: [], second: ["white"] },
    });
  });

  it("gives every ground a file of the set serves a template", () => {
    // A file made for light pictures whose posts show it in white and never as its copy: the white file takes the dark ground.
    expect(jobLogos(row(stored({ white: { path: MADE.white } })))?.logos).toEqual({
      files: { stored: OF, white: MADE.white }, canvas: "stored", second: { file: "white", ground: "#0B0E1A" }, fixed: [], names: { canvas: [], second: [] },
    });
    // With a second file, that file takes the dark ground and the white file may be stamped there.
    expect(jobLogos(row(stored({ other: made, white: { path: MADE.white } })))?.logos).toMatchObject({ second: { file: "other", ground: "#0B0E1A" }, names: { canvas: [], second: ["white"] } });
    // The white file never takes the light ground.
    expect(jobLogos(row(stored({ own: "dark", white: { path: MADE.white } }), { background: "#0B0E1A" }))?.logos.second).toBeNull();
  });

  it("covers the ground a both-grounds file's canvas color sits on, and searches the other one second", () => {
    const both = (own: "light" | "dark", canvas: LogoSet["canvas"]) => stored({ own, both: true, canvas });
    const second = (set: LogoSet, over: Record<string, unknown> = {}) => jobLogos(row(set, over))?.logos.second;
    // A row the lifecycle wrote, its canvas ground from the client's posts: the stored file on white already is the light search.
    expect(second(both("dark", { file: "stored", ground: "#FFFFFF", from: "client_posts" }))).toEqual({ file: "stored", ground: "#0B0E1A" });
    // Its canvas ground from the settings, read from the row, in either letter case.
    expect(second(both("dark", { file: "stored", ground: "#FFFFFF", from: "settings" }), { background: "#FFFFFF" })).toEqual({ file: "stored", ground: "#0B0E1A" });
    expect(second(both("dark", { file: "stored", ground: "#FFFFFF", from: "settings" }), { background: "#ffffff" })).toEqual({ file: "stored", ground: "#0B0E1A" });
    expect(second(both("light", { file: "stored", ground: "#0B0E1A", from: "settings" }), { background: "#0B0E1A" })).toEqual({ file: "stored", ground: "#FFFFFF" });
    // A row a person set: their file on their background.
    expect(second(both("dark", { file: "stored", ground: "#FFFFFF", from: "settings" }), { source: "person", background: "#ffffff" })).toEqual({ file: "stored", ground: "#0B0E1A" });
    expect(second(both("light", { file: "stored", ground: "#0B0E1A", from: "settings" }), { source: "person", background: "#0B0E1A" })).toEqual({ file: "stored", ground: "#FFFFFF" });
    // A ground near a neutral sits on that neutral's side, so the two templates never search one side twice.
    expect(second(both("dark", { file: "stored", ground: "#FAFAFA", from: "client_posts" }))).toEqual({ file: "stored", ground: "#0B0E1A" });
    expect(second(both("light", { file: "stored", ground: "#10141F", from: "client_posts" }))).toEqual({ file: "stored", ground: "#FFFFFF" });
    // With a second file for the ground the stored file was not made for, that file takes that ground.
    const made2 = { path: MADE.other, from: "made" as const, size: [300, 90] as [number, number] };
    expect(second({ ...both("dark", { file: "stored", ground: "#0B0E1A", from: "settings" }), other: made2 }, { background: "#0B0E1A" })).toEqual({ file: "other", ground: "#FFFFFF" });
    expect(second({ ...both("dark", { file: "stored", ground: "#FFFFFF", from: "settings" }), other: made2 }, { background: "#FFFFFF" })).toEqual({ file: "stored", ground: "#0B0E1A" });
    // No template is ever the first one again: the same file over the same color.
    for (const own of ["light", "dark"] as const) for (const ground of ["#FFFFFF", "#0B0E1A", "#7F7F7F", "#2A95FD"]) {
      const job = jobLogos(row(both(own, { file: "stored", ground, from: "client_posts" })))!;
      expect(job.logos.second).not.toEqual({ file: "stored", ground: job.background });
    }
  });

  it("never starts a design from the stored file on a background one of its whole parts does not show on", () => {
    // Two green letters and a near-black one, made for light pictures, on a near-black settings background: the canvas is the file's own neutral.
    const twoInks = stored({ other: { path: MADE.other, from: "made", size: [300, 90] }, inks: [[40, 140, 70], [26, 25, 25]] });
    const job = jobLogos(row(twoInks, { background: "#1A1A1A" }))!;
    expect(job).toMatchObject({ logo_path: OF, background: "#FFFFFF" });
    // The first template is then the stored file on a light ground, and the copy still searches the dark one.
    expect(job.logos.second).toEqual({ file: "other", ground: "#0B0E1A" });
    // The same row once its settings background is one the file shows whole on.
    expect(jobLogos(row(twoInks, { background: "#F4F4F4" }))?.background).toBe("#F4F4F4");
    // A set whose ground came from an older background, or that says the file rests on its neutral, is read against the row as it is now.
    expect(jobLogos(row({ ...twoInks, canvas: { file: "stored", ground: "#FFFFFF", from: "pole" } }, { background: "#F4F4F4" }))?.background).toBe("#F4F4F4");
    expect(jobLogos(row({ ...twoInks, canvas: { file: "stored", ground: "#F4F4F4", from: "settings" } }, { background: "#1A1A1A" }))?.background).toBe("#FFFFFF");
    // A row a person set is held to the same rule, and nothing of theirs is written.
    expect(jobLogos(row(twoInks, { source: "person", background: "#1A1A1A" }))).toMatchObject({ logo_path: OF, background: "#FFFFFF" });
  });

  it("reads a settings background from the row itself, and a person's row always starts from their own file", () => {
    // The canvas ground of a set that came from the settings is the row's background: a background changed since is used at once.
    expect(jobLogos(row(stored({ other: made }), { background: "#f0f0f0" }))).toMatchObject({ logo_path: OF, background: "#F0F0F0" });
    // A ground from the client's posts is the set's own.
    expect(jobLogos(row(stored({ other: made, canvas: { file: "stored", ground: "#F7E8E5", from: "client_posts" } }), { background: "#101010" }))?.background).toBe("#F7E8E5");
    // A person's row: their file on their background, whatever the set's canvas says, and the set's files are still carried.
    const theirs = jobLogos(row(stored({ own: "dark", other: made, canvas: { file: "other", ground: "#F2EADF", from: "client_posts" } }), { source: "person", background: "#0c1d2f" }));
    expect(theirs).toEqual({
      logo_path: OF, background: "#0C1D2F",
      logos: { files: { stored: OF, other: MADE.other }, canvas: "stored", second: { file: "other", ground: "#FFFFFF" }, fixed: [], names: { canvas: [], second: [] } },
    });
  });

  it("reads a set of the rule of 16 Nov until the lifecycle has made it again, so no client goes back to one file in between", () => {
    // A set of rule 1 has the same files and no inks.
    const rule1 = (over: Partial<LogoSet> = {}) => ({ ...stored(over), rule: 1, inks: undefined });
    // Its canvas ground came from the client's posts, or its canvas file is another file: read as it is, with the lists of names.
    expect(jobLogos(row(rule1({ other: made, canvas: { file: "stored", ground: "#F7E8E5", from: "client_posts" } })))).toEqual({
      logo_path: OF, background: "#F7E8E5",
      logos: { files: { stored: OF, other: MADE.other }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: [], names: { canvas: [], second: [] } },
    });
    expect(jobLogos(row(rule1({ own: "dark", white: { path: MADE.white }, canvas: { file: "white", ground: "#0B0E1A", from: "pole" } })))).toMatchObject({ logo_path: MADE.white, background: "#0B0E1A", logos: { canvas: "white", second: null } });
    // The stored file on a ground from the settings: where it rests needs the colors of its whole parts, which a set of rule 1 does not hold.
    const settled = rule1({ other: made, canvas: { file: "stored", ground: "#1A1A1A", from: "settings" } });
    expect(jobLogos(row(settled, { background: "#1A1A1A" }))).toBeNull();
    // Read from the file's own pixels by the caller: two green letters and a near-black one rest on white, and the copy keeps its template.
    const whole = { inks: [[40, 140, 70], [26, 25, 25]] as Rgb[], own: "light" as const };
    expect(jobLogos(row(settled, { background: "#1A1A1A" }), whole)).toEqual({
      logo_path: OF, background: "#FFFFFF",
      logos: { files: { stored: OF, other: MADE.other }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: [], names: { canvas: [], second: [] } },
    });
    // A row a person set, the same way.
    expect(jobLogos(row(rule1(), { source: "person", background: "#F0F0F0" }))).toBeNull();
    expect(jobLogos(row(rule1(), { source: "person", background: "#F0F0F0" }), { inks: [[20, 30, 60]], own: "light" })).toMatchObject({ logo_path: OF, background: "#F0F0F0" });
    // A set of rule 2 never needs them, and its own inks come first.
    expect(jobLogos(row(stored(), { background: "#F0F0F0" }), { inks: [[240, 240, 240]], own: "dark" })?.background).toBe("#F0F0F0");
  });

  it("starts a job with one file when the set belongs to another logo, has an unknown rule, or names a person's file that was removed", () => {
    expect(jobLogos(row(null))).toBeNull();
    expect(jobLogos(row(undefined))).toBeNull();
    expect(jobLogos(row("x"))).toBeNull();
    expect(jobLogos(row(stored(), { logo_path: "c1/another.png" }))).toBeNull();
    expect(jobLogos(row({ ...stored(), rule: 3 }))).toBeNull();
    expect(jobLogos(row({ ...stored(), rule: undefined }))).toBeNull();
    expect(jobLogos(row({ ...stored(), inks: undefined }))).toBeNull();
    expect(jobLogos(row(stored({ canvas: { file: "other", ground: "#0F294C", from: "client_posts" } })))).toBeNull();
    expect(jobLogos(row(stored({ canvas: { file: "stored", ground: "blue", from: "settings" } })))).toBeNull();
    const person = { path: "c1/design-settings/logo-other-9.png", from: "person" as const, size: [500, 200] as [number, number] };
    // Removed: the row's person key is gone, the set still names the file until it is settled again.
    expect(jobLogos(row(stored({ other: person })))).toBeNull();
    // Put beside another main logo.
    expect(jobLogos(row(stored({ other: person, person: { path: person.path, of: "c1/older.png", at: AT } })))).toBeNull();
    // Replaced by another file.
    expect(jobLogos(row(stored({ other: person, person: { path: "c1/design-settings/logo-other-10.png", of: OF, at: AT } })))).toBeNull();
    expect(jobLogos(row(stored()))).not.toBeNull();
  });
});

describe("the files a design may be stamped with", () => {
  const LOGO = "c9/design-settings/logo-site-aaaa.png";
  const COPY = { other: "c9/design-settings/logo-aaaa-other.png", white: "c9/design-settings/logo-aaaa-white.png" };
  const when = "2026-11-17T09:00:00.000Z";
  const set = (over: Record<string, unknown> = {}) => ({
    of: LOGO, rule: 2, own: "light", both: false, inks: [[20, 30, 60]], other: null, white: null, made: { other: null, white: null }, site: null,
    posts: { read: 0, found: 0, shown: { stored: 0, other: 0, white: 0 } }, canvas: { file: "stored", ground: "#FAFAFA", from: "settings" }, at: when, ...over,
  });
  const stamp = (s: unknown) => stampList(LOGO, s as Partial<LogoSet>);

  it("lists the stored file, the second file and the white copy, with the copies the service made whether or not a post shows them", () => {
    // No copy was made: the stored file alone.
    expect(stamp(set())).toEqual([{ file: "stored", path: LOGO }]);
    // Both copies were made and no post was found: all three, none last. The templates do not change with it.
    const job = jobLogos({ logo_path: LOGO, background: "#FAFAFA", logo_set: set({ made: COPY }) })!;
    expect(stamp(set({ made: COPY }))).toEqual([{ file: "stored", path: LOGO }, { file: "other", path: COPY.other }, { file: "white", path: COPY.white }]);
    expect(job.logos.files).toEqual({ stored: LOGO });
    expect(job.logos.second).toBeNull();
    // Only one copy was made.
    expect(stamp(set({ made: { other: COPY.other, white: null } }))).toEqual([{ file: "stored", path: LOGO }, { file: "other", path: COPY.other }]);
    expect(stamp(set({ made: { other: null, white: COPY.white } }))).toEqual([{ file: "stored", path: LOGO }, { file: "white", path: COPY.white }]);
  });

  it("keeps a made copy for last when logos were found on the client's posts and none shows it", () => {
    const posts = (shown: { stored: number; other: number; white: number }) => ({ read: 12, found: shown.stored + shown.other + shown.white, shown });
    // Found on three posts: the stored file on one, the white copy on two, the other copy on none.
    expect(stamp(set({ made: COPY, white: { path: COPY.white }, posts: posts({ stored: 1, other: 0, white: 2 }) }))).toEqual([
      { file: "stored", path: LOGO }, { file: "other", path: COPY.other, last: true }, { file: "white", path: COPY.white },
    ]);
    // Every found post shows the stored file: both copies last.
    expect(stamp(set({ made: COPY, posts: posts({ stored: 4, other: 0, white: 0 }) }))).toEqual([
      { file: "stored", path: LOGO }, { file: "other", path: COPY.other, last: true }, { file: "white", path: COPY.white, last: true },
    ]);
    // Posts were read and no logo was found on any: they say nothing.
    expect(stamp(set({ made: COPY, posts: { read: 12, found: 0, shown: { stored: 0, other: 0, white: 0 } } }))).toEqual([
      { file: "stored", path: LOGO }, { file: "other", path: COPY.other }, { file: "white", path: COPY.white },
    ]);
  });

  it("puts the brand's own second file in the second place, never last, with the white copy after it", () => {
    const site = { path: "c9/design-settings/logo-site-bbbb.png", from: "site", size: [600, 180] };
    expect(stamp(set({ other: site, site: site.path, made: COPY, posts: { read: 8, found: 3, shown: { stored: 3, other: 0, white: 0 } } }))).toEqual([
      { file: "stored", path: LOGO }, { file: "other", path: site.path }, { file: "white", path: COPY.white, last: true },
    ]);
    const person = { path: "c9/design-settings/logo-other-9.png", of: LOGO, at: when };
    expect(stamp(set({ other: { path: person.path, from: "person", size: [500, 200] }, person, made: COPY }))).toEqual([
      { file: "stored", path: LOGO }, { file: "other", path: person.path }, { file: "white", path: COPY.white },
    ]);
  });

  it("reads a set of rule 1 the same way", () => {
    const rule1 = { ...set({ made: COPY, other: { path: COPY.other, from: "made", size: [300, 90] }, canvas: { file: "other", ground: "#0F294C", from: "client_posts" }, posts: { read: 16, found: 5, shown: { stored: 0, other: 5, white: 0 } } }), rule: 1, inks: undefined };
    expect(stamp(rule1)).toEqual([{ file: "stored", path: LOGO }, { file: "other", path: COPY.other }, { file: "white", path: COPY.white, last: true }]);
  });
});
