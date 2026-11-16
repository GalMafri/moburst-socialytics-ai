// @vitest-environment node
// server/test/ops.test.ts
//
// The five picture operations against the workers' own code (12 Nov 2026).
// Each reference below is the worker's lines transcribed into imagescript
// 1.3.0 calls, the library the workers ran, so an operation passes only
// when it gives the same bytes the worker gave on the same inputs. The
// fixtures are synthetic but at the real sizes.

import { describe, expect, it } from "vitest";
import { Image } from "imagescript";
import { canvasLogoRect, resampleRGBA } from "../../supabase/functions/_shared/canva/brief.ts";
import { TITLE_ALPHA_MIN, TITLE_GROUND, type Placement, type Rect, type Rgb, type Size } from "../../supabase/functions/_shared/picture/contract.ts";
import { generationCanvas } from "../src/picture/canvas.ts";
import { finishPicture } from "../src/picture/finish.ts";
import { locateLogo } from "../src/picture/locate.ts";
import { readPictures } from "../src/picture/read.ts";
import { raster, type Raster } from "../src/picture/raster.ts";
import { titleRead } from "../src/picture/title.ts";
import { clone, pagePicture, ringAndBarLogo, titleLayer, toImage, wideLogo } from "./fixtures.ts";

const BIG = 60_000;

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return Buffer.from(a as Uint8ClampedArray).equals(Buffer.from(b as Uint8ClampedArray));
}

// design-worker/index.ts:474-491 (generateDesign), transcribed.
function referenceCanvas(logoFile: Raster, placement: Placement, page: Size, background: Rgb) {
  const W = page.width, H = page.height;
  const file = toImage(logoFile);
  const rect = canvasLogoRect(placement, file.width, file.height, W, H);
  const logo = new Image(rect.width, rect.height);
  logo.bitmap.set(resampleRGBA(file.bitmap, file.width, file.height, rect.width, rect.height));
  const [r, gr, b] = background;
  const canvas = new Image(W, H).fill(Image.rgbaToColor(r, gr, b, 255));
  canvas.composite(logo, rect.x, rect.y);
  const mask = new Image(W, H);
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      if (logo.bitmap[(y * logo.width + x) * 4 + 3] === 0) continue;
      const tx = x + rect.x, ty = y + rect.y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      mask.bitmap.set([255, 255, 255, 255], (ty * W + tx) * 4);
    }
  }
  return { canvas, mask, rect };
}

// design-worker/index.ts:348-375 (finish), transcribed.
function referenceFinish(picture: Raster, logoFile: Raster, rect: Rect, frame: [number, number], output: Size): Image {
  const pic = toImage(picture);
  const logo = toImage(logoFile);
  const W = pic.width, H = pic.height;
  const k = W / frame[0];
  const r = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  const lp = resampleRGBA(logo.bitmap, logo.width, logo.height, r.width, r.height);
  const px = pic.bitmap;
  for (let y = 0; y < r.height; y++) {
    const ty = r.y + y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < r.width; x++) {
      const tx = r.x + x;
      if (tx < 0 || tx >= W) continue;
      const k = (y * r.width + x) * 4, a = lp[k + 3];
      if (a === 0) continue;
      const i = (ty * W + tx) * 4, f = a / 255;
      px[i] = Math.round(lp[k] * f + px[i] * (1 - f));
      px[i + 1] = Math.round(lp[k + 1] * f + px[i + 1] * (1 - f));
      px[i + 2] = Math.round(lp[k + 2] * f + px[i + 2] * (1 - f));
      px[i + 3] = 255;
    }
  }
  const out = new Image(output.width, output.height);
  out.bitmap.set(resampleRGBA(pic.bitmap, W, H, output.width, output.height));
  return out;
}

// _shared/video/steps.ts:201-216 (title_check), transcribed.
function referenceTitle(layer: Raster) {
  const hook = toImage(layer);
  let x0 = hook.width, y0 = hook.height, x1 = -1, y1 = -1;
  for (let y = 0; y < hook.height; y++) {
    for (let x = 0; x < hook.width; x++) {
      if (hook.bitmap[(y * hook.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const ground = new Image(hook.width, hook.height).fill(Image.rgbaToColor(70, 70, 76, 255));
  ground.composite(hook, 0, 0);
  return { box, read: ground.resize(Math.round(hook.width / 2), Math.round(hook.height / 2)) };
}

describe("generationCanvas", () => {
  // design-worker/index.ts:474-491
  const page = { width: 1088, height: 1360 };
  const background: Rgb = [12, 34, 56];

  it("builds the canvas and the logo-shaped mask the generate step built, pixel for pixel", () => {
    const placement: Placement = { anchor: "center", width: 0.32, top: 0.08 };
    const logo = wideLogo();
    const expected = referenceCanvas(logo, placement, page, background);
    const got = generationCanvas(logo, placement, page, background);
    expect(got.rect).toEqual(canvasLogoRect(placement, logo.width, logo.height, page.width, page.height));
    expect(got.rect).toEqual(expected.rect);
    expect([got.canvas.width, got.canvas.height, got.mask.width, got.mask.height]).toEqual([1088, 1360, 1088, 1360]);
    expect(sameBytes(got.canvas.data, expected.canvas.bitmap)).toBe(true);
    expect(sameBytes(got.mask.data, expected.mask.bitmap)).toBe(true);
  });

  it("clips a logo the placement pushes past the page edge instead of throwing", () => {
    const placement: Placement = { anchor: "left", left: 0.95, width: 0.32, top: 0.97 };
    const logo = wideLogo();
    const expected = referenceCanvas(logo, placement, page, background);
    const got = generationCanvas(logo, placement, page, background);
    expect(got.rect.x + got.rect.width).toBeGreaterThan(page.width);
    expect(got.rect).toEqual(expected.rect);
    expect(sameBytes(got.canvas.data, expected.canvas.bitmap)).toBe(true);
    expect(sameBytes(got.mask.data, expected.mask.bitmap)).toBe(true);
  });
});

describe("finishPicture", () => {
  // design-worker/index.ts:348-375
  const logo = ringAndBarLogo();
  const picture = pagePicture(2176, 2720, 11);
  const output = { width: 1440, height: 1800 };

  it("places the logo file where the model drew it and delivers 1440 wide, pixel for pixel as the finish step did", () => {
    const rect = { x: 980, y: 2240, width: 370, height: 370 };
    const expected = referenceFinish(picture, logo, rect, [2176, 2720], output);
    const got = finishPicture(clone(picture), logo, rect, [2176, 2720], output);
    expect([got.width, got.height]).toEqual([1440, 1800]);
    expect(sameBytes(got.data, expected.bitmap)).toBe(true);
  }, BIG);

  it("scales a rectangle found on a frame of another size by the picture's width, as the step did", () => {
    const rect = { x: 490, y: 1120, width: 185, height: 185 };
    const expected = referenceFinish(picture, logo, rect, [1088, 1360], output);
    const got = finishPicture(clone(picture), logo, rect, [1088, 1360], output);
    expect(sameBytes(got.data, expected.bitmap)).toBe(true);
  }, BIG);

  it("clips a logo rectangle that leaves the picture", () => {
    const rect = { x: -40, y: 2600, width: 370, height: 370 };
    const expected = referenceFinish(picture, logo, rect, [2176, 2720], output);
    const got = finishPicture(clone(picture), logo, rect, [2176, 2720], output);
    expect(sameBytes(got.data, expected.bitmap)).toBe(true);
  }, BIG);

  it("blends the logo into the picture it is given, in place, as the step did", () => {
    const rect = { x: 980, y: 2240, width: 370, height: 370 };
    const target = clone(picture);
    finishPicture(target, logo, rect, [2176, 2720], output);
    expect(sameBytes(target.data, picture.data)).toBe(false);
    expect(target.data[((2240 + 185) * 2176 + 980 + 30) * 4 + 3]).toBe(255);
  }, BIG);

  it("finishes a Story at 2160x3840 to 1440x2560 in a few seconds", () => {
    const story = pagePicture(2160, 3840, 23);
    const started = performance.now();
    const got = finishPicture(story, logo, { x: 900, y: 3100, width: 360, height: 360 }, [2160, 3840], { width: 1440, height: 2560 });
    const ms = performance.now() - started;
    console.info(`[ops.test] Story finish took ${Math.round(ms)} ms`);
    expect([got.width, got.height]).toEqual([1440, 2560]);
    expect(ms).toBeLessThan(10_000);
  }, BIG);
});

describe("readPictures", () => {
  // design-worker/index.ts:322-323 (marks), :386-388, :400-402 and :411-417 (verify)
  it("brings the picture to the page size for reading, cuts the Story's band from it and the logo's area at full size", () => {
    const picture = pagePicture(2160, 3840, 31);
    const page = { width: 1152, height: 2048 };
    const band = { x: 69, y: 287, width: 1014, height: 1044 };
    const area = { x: 502, y: 1335, width: 538, height: 465 };

    const final = toImage(picture);
    const small = new Image(page.width, page.height);
    small.bitmap.set(resampleRGBA(final.bitmap, final.width, final.height, page.width, page.height));
    const bandImage = small.clone().crop(band.x, band.y, band.width, band.height);
    const areaImage = final.clone().crop(area.x, area.y, area.width, area.height);

    const got = readPictures(picture, page, { band, area });
    expect([got.page.width, got.page.height]).toEqual([1152, 2048]);
    expect(sameBytes(got.page.data, small.bitmap)).toBe(true);
    expect([got.band?.width, got.band?.height]).toEqual([1014, 1044]);
    expect(sameBytes(got.band!.data, bandImage.bitmap)).toBe(true);
    expect([got.area?.width, got.area?.height]).toEqual([538, 465]);
    expect(sameBytes(got.area!.data, areaImage.bitmap)).toBe(true);
  }, BIG);

  it("gives only the page-size picture when no crops are asked for", () => {
    const got = readPictures(pagePicture(64, 48, 3), { width: 32, height: 24 }, {});
    expect(Object.keys(got)).toEqual(["page"]);
  });
});

describe("titleRead", () => {
  // _shared/video/steps.ts:201-216
  it("finds the lettering's box and makes the grey read-back at half size, pixel for pixel as title_check did", () => {
    expect([TITLE_GROUND, TITLE_ALPHA_MIN]).toEqual([[70, 70, 76], 16]);
    const layer = titleLayer();
    const expected = referenceTitle(layer);
    const got = titleRead(layer);
    expect(got.box).toEqual(expected.box);
    expect([got.read?.width, got.read?.height]).toEqual([544, 968]);
    expect(sameBytes(got.read!.data, expected.read.bitmap)).toBe(true);
  });

  it("gives no box and no read-back for an empty layer", () => {
    expect(titleRead(raster(1088, 1936))).toEqual({ box: null, read: null });
  });
});

describe("locateLogo", () => {
  // design-worker/index.ts:284-287, with the fixture of supabase/tests/_shared/design/pipeline.test.ts:30-58
  it("finds a logo drawn smaller than usual where it was drawn, and reports the usual spot and the frame", () => {
    const lw = 40, lh = 16;
    const logo = raster(lw, lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const ink = !(x > 10 && x < 18 && y > 4 && y < 12) && (x < 30 || y < 8);
      logo.data.set(ink ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * lw + x) * 4);
    }
    const W = 320, H = 240;
    const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
    const usual = canvasLogoRect(placement, lw, lh, W, H);
    expect(usual).toEqual({ x: 60, y: 30, width: 80, height: 32 });
    // Stamped at 0.8 of the usual width, 6 px right and 4 px down of the usual spot.
    const sw = Math.round(usual.width * 0.8), sh = Math.round((usual.width * 0.8 * lh) / lw), sx = usual.x + 6, sy = usual.y + 4;
    const design = raster(W, H);
    for (let i = 0; i < W * H; i++) design.data.set([10, 12, 30, 255], i * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const lx = Math.floor((x * lw) / sw), ly = Math.floor((y * lh) / sh);
      if (logo.data[(ly * lw + lx) * 4 + 3]) design.data.set([255, 255, 255, 255], ((sy + y) * W + sx + x) * 4);
    }

    const got = locateLogo(design, logo, placement, [10, 12, 30], [0.45, 1.15]);
    expect(Math.abs(got.x - sx)).toBeLessThanOrEqual(2);
    expect(Math.abs(got.y - sy)).toBeLessThanOrEqual(2);
    expect(Math.abs(got.width - sw)).toBeLessThanOrEqual(2);
    expect(Math.abs(got.height - sh)).toBeLessThanOrEqual(2);
    expect(got.score).toBeGreaterThanOrEqual(0.75);
    expect(got.usual).toEqual(usual);
    expect(got.frame).toEqual([320, 240]);
  });
});
