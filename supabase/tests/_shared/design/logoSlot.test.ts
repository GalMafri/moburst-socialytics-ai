// @vitest-environment node
// The slot (17 Nov 2026): where the logo goes on a design, the ground under
// it once the model's drawing is cleaned out, and the file that is stamped.
// Rasters are drawn here, in made-up neutral colors.
import { describe, expect, it } from "vitest";
import { canvasLogoRect } from "../../../functions/_shared/canva/brief";
import { findLogo, LOGO_SCALES, logoFound } from "../../../functions/_shared/design/logoMatch";
import { fitRect, groundUnder, pickStamp, slotOf, stillDrawn } from "../../../functions/_shared/design/logoSlot";
import { searchTemplates } from "../../../functions/_shared/design/logoTone";
import type { Placement, Rgb } from "../../../functions/_shared/picture/contract";
import { box, drawLogo, flat, inked, mark } from "./draw";

const W = 320, H = 240;
const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
const DARK_INK: Rgb = [24, 28, 40];
const shape = mark(40, 16, DARK_INK);
const usual = canvasLogoRect(placement, 40, 16, W, H);
const drawn = { x: usual.x + 6, y: usual.y + 4, width: Math.round(usual.width * 0.8), height: Math.round((usual.width * 0.8 * 16) / 40) };
const LIGHT: Rgb = [255, 255, 255];

describe("the search, read in either tone", () => {
  const darkOnLight = drawLogo(flat(W, H, [236, 240, 244]), shape, drawn);
  const lightOnDark = drawLogo(flat(W, H, [40, 20, 60]), shape, drawn, [250, 250, 250]);
  const find = (picture: typeof darkOnLight, either: boolean) => findLogo(picture.data, W, H, shape.data, 40, 16, usual, LIGHT, { scales: LOGO_SCALES, either });

  it("finds a one-color logo drawn lighter than its ground with the template of the dark file, where it was drawn", () => {
    const dark = find(darkOnLight, true), light = find(lightOnDark, true);
    expect(logoFound(dark, usual.width)).toBe(true);
    expect(logoFound(light, usual.width)).toBe(true);
    // The tone decides nothing: the same shape scores the same, at the same place.
    expect(Math.abs(dark.score - light.score)).toBeLessThan(0.01);
    expect({ x: light.x, y: light.y, width: light.width }).toEqual({ x: dark.x, y: dark.y, width: dark.width });
    expect(Math.abs(light.x - drawn.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(light.y - drawn.y)).toBeLessThanOrEqual(2);
  });

  it("leaves the search every earlier caller makes as it was: the other tone is no match there", () => {
    expect(logoFound(find(darkOnLight, false), usual.width)).toBe(true);
    expect(logoFound(find(lightOnDark, false), usual.width)).toBe(false);
    expect(find(darkOnLight, false)).toEqual(find(darkOnLight, true));
  });

  it("finds nothing on a flat picture, in either tone", () => {
    const none = find(flat(W, H, [120, 120, 120]), true);
    expect(none.score).toBeLessThan(0.75);
  });
});

describe("the slot", () => {
  const canvas = { file: "stored" as const, rect: usual };
  const found = (score: number, rect = drawn, matched: "stored" | "other" = "stored") => ({ matched, rect, score, usual });

  it("is the found rectangle when the match is the logo by the existing test", () => {
    expect(slotOf(found(0.75), canvas)).toEqual({ rect: drawn, from: "drawn", of: "stored" });
    // The shape is the matched template's file.
    expect(slotOf(found(0.93, drawn, "other"), canvas)).toEqual({ rect: drawn, from: "drawn", of: "other" });
  });

  it("is the rectangle the canvas carried when the match is weak, wherever the weak match sits", () => {
    expect(slotOf(found(0.749), canvas)).toEqual({ rect: usual, from: "canvas", of: "stored" });
    // A stray match on a headline, far from the canvas rectangle, at a size the client uses.
    const stray = { x: usual.x - 40, y: usual.y + 70, width: Math.round(usual.width * 0.5), height: 16 };
    expect(slotOf(found(0.26, stray, "other"), canvas)).toEqual({ rect: usual, from: "canvas", of: "stored" });
  });

  it("is the canvas rectangle when the match is strong at a size the client never uses", () => {
    const tiny = { ...drawn, width: Math.round(usual.width * 0.46) };
    const huge = { ...drawn, width: Math.round(usual.width * 1.34) };
    expect(slotOf(found(0.97, tiny), canvas).from).toBe("canvas");
    expect(slotOf(found(0.97, huge), canvas).from).toBe("canvas");
  });

  it("comes out of the search on a real picture: the drawing when it is the logo, the canvas place when the model drew something else", () => {
    const templates = [{ file: "stored" as const, raster: shape, ground: LIGHT }];
    const kept = drawLogo(flat(W, H, [40, 20, 60]), shape, drawn, [250, 250, 250]);
    const a = searchTemplates(kept, templates, placement, LOGO_SCALES, { either: true });
    expect(slotOf(a, canvas).from).toBe("drawn");
    // Another shape where the logo was: bars the file does not have.
    const other = flat(W, H, [40, 20, 60]);
    for (let i = 0; i < 6; i++) box(other, drawn.x + i * 11, drawn.y, drawn.x + i * 11 + 4, drawn.y + drawn.height, [250, 250, 250]);
    const b = searchTemplates(other, templates, placement, LOGO_SCALES, { either: true });
    expect(slotOf(b, canvas)).toEqual({ rect: usual, from: "canvas", of: "stored" });
  });
});

describe("the ground under the slot", () => {
  it("is a real pixel from inside the slot, the middle one by brightness", () => {
    const picture = flat(W, H, [10, 10, 10]);
    box(picture, drawn.x, drawn.y, drawn.x + drawn.width, drawn.y + drawn.height, [98, 2, 73]);
    // A third of the slot is lighter: the middle pixel is still the larger part's.
    box(picture, drawn.x, drawn.y, drawn.x + Math.round(drawn.width / 3), drawn.y + drawn.height, [200, 180, 190]);
    const under = groundUnder(picture, drawn)!;
    expect(under.ground).toEqual([98, 2, 73]);
    expect(under.flat).toBeGreaterThan(0.6);
    expect(under.flat).toBeLessThan(0.7);
    // Nothing outside the slot is read.
    expect(groundUnder(flat(W, H, [10, 10, 10]), drawn)!.ground).toEqual([10, 10, 10]);
  });

  it("is null for a slot with no pixel on the picture", () => {
    expect(groundUnder(flat(W, H, [10, 10, 10]), { x: W + 10, y: 0, width: 20, height: 8 })).toBeNull();
  });
});

describe("the file that is stamped", () => {
  const BLACK: Rgb = [0, 0, 0], WHITE: Rgb = [255, 255, 255], INK: Rgb = [11, 14, 26], MID: Rgb = [0, 193, 213];
  const set = (stored: Rgb, other: Rgb | null, white: boolean, last: Array<"other" | "white"> = []) => [
    { file: "stored" as const, inks: [stored] },
    ...(other ? [{ file: "other" as const, inks: [other], ...(last.includes("other") ? { last: true } : {}) }] : []),
    ...(white ? [{ file: "white" as const, inks: [WHITE], ...(last.includes("white") ? { last: true } : {}) }] : []),
  ];

  it("is the first file in the order whose whole parts all show on the ground", () => {
    // A dark one-color logo with its white copy: the stored file on a light ground, the copy on a dark one.
    expect(pickStamp(set(BLACK, WHITE, false), [215, 197, 247]).file).toBe("stored");
    expect(pickStamp(set(BLACK, WHITE, false), [8, 1, 2]).file).toBe("other");
    // The stored file is weak on a deep color (under 3:1, over 1.5:1): the copy that shows whole wins.
    const deep = pickStamp(set(BLACK, WHITE, false), [98, 2, 73]);
    expect(deep.file).toBe("other");
    expect(deep.shows.stored).toBeGreaterThan(1.5);
    expect(deep.shows.stored).toBeLessThan(3);
    expect(deep.shows.other).toBeGreaterThan(3);
    // Both show whole: the stored file comes first.
    expect(pickStamp(set([120, 170, 255], WHITE, false), [20, 20, 20]).file).toBe("stored");
  });

  it("takes a file that is only weaker than 3:1 when no file shows whole, in the same order", () => {
    // A mid-tone ground: the mid-tone ink has 1.5:1 or more, white is hidden.
    const got = pickStamp(set(MID, null, true), [212, 240, 245]);
    expect(got.file).toBe("stored");
    expect(got.shows.stored).toBeGreaterThanOrEqual(1.5);
    expect(got.shows.white).toBeLessThan(1.5);
  });

  it("keeps a made copy the client's posts never show for last, at both lines", () => {
    // Weak stored file, strong copy the posts speak against: the stored file.
    expect(pickStamp(set(MID, INK, true, ["other"]), [212, 240, 245]).file).toBe("stored");
    // The same files with nothing said against the copy: the copy that shows whole.
    expect(pickStamp(set(MID, INK, true), [212, 240, 245]).file).toBe("other");
    // On the ink's own color the stored file is hidden: the white copy the posts show, weak, before the strong copy they never show.
    expect(pickStamp(set(MID, INK, true, ["other"]), [0, 191, 217]).file).toBe("white");
    // When nothing else shows at all, the copy is used.
    expect(pickStamp(set(WHITE, INK, false, ["other"]), [250, 250, 250]).file).toBe("other");
  });

  it("names no file when every file has a whole part that does not show", () => {
    // A file of two inks, one light and one dark, and its white copy, on a ground near the light ink.
    const files = [{ file: "stored" as const, inks: [[250, 250, 250], [200, 30, 40]] as Rgb[] }, { file: "white" as const, inks: [WHITE] }];
    const got = pickStamp(files, [244, 244, 244]);
    expect(got.file).toBeNull();
    expect(got.shows.stored).toBeLessThan(1.5);
  });

  it("holds a file to its weakest whole part", () => {
    const files = [{ file: "stored" as const, inks: [[51, 136, 70], [10, 10, 10]] as Rgb[] }, { file: "other" as const, inks: [[51, 136, 70], WHITE] as Rgb[] }];
    // On a dark band the stored file's dark part is hidden; the copy shows whole.
    expect(pickStamp(files, [26, 26, 26]).file).toBe("other");
    // On a light gray the green is under 3:1 in both, and the copy's white part is hidden: the stored file, by the second line.
    expect(pickStamp(files, [232, 232, 232]).file).toBe("stored");
  });
});

describe("the drawing after cleaning", () => {
  const template = { raster: shape, ground: LIGHT };

  it("is still found where the removal left it, in either tone, and not on a cleaned picture", () => {
    const left = drawLogo(flat(W, H, [40, 20, 60]), shape, drawn, [250, 250, 250]);
    const still = stillDrawn(left, template, drawn);
    expect(still.found).toBe(true);
    expect(still.score).toBeGreaterThanOrEqual(0.75);
    // Cleaned to a flat ground, and cleaned to a ground with a soft shade across it.
    expect(stillDrawn(flat(W, H, [40, 20, 60]), template, drawn).found).toBe(false);
    const shaded = flat(W, H, [40, 20, 60]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) shaded.data[(y * W + x) * 4] = 40 + Math.round((x / W) * 30);
    expect(stillDrawn(shaded, template, drawn).found).toBe(false);
  });
});

describe("where a file of another shape is stamped", () => {
  it("keeps the slot for a file of the slot's own shape, and fits another shape to the slot's width and center", () => {
    const same = inked(shape, [255, 255, 255]);
    expect(fitRect(drawn, shape, same)).toEqual(drawn);
    const taller = mark(80, 34, DARK_INK);
    const height = Math.round((drawn.width * 34) / 80);
    expect(fitRect(drawn, shape, taller)).toEqual({ x: drawn.x, y: Math.round(drawn.y + drawn.height / 2 - height / 2), width: drawn.width, height });
    // With no file to take the slot's shape from, the slot is used as it is.
    expect(fitRect(drawn, null, taller)).toEqual(drawn);
  });
});
