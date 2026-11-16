// @vitest-environment node
// server/test/raster.test.ts
//
// The raster core against imagescript 1.3.0 (12 Nov 2026): every pixel
// operation the workers used must give the same bytes on the same inputs,
// and decoding must give the pixels imagescript gave.

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { Image } from "imagescript";
import { alphaBox, crop, decodeRaster, encodeJpeg, encodePng, fill, overlay, raster, resizeNearest, type Raster } from "../src/picture/raster.ts";
import { clone, fromImage, randomRaster, toImage } from "./fixtures.ts";

function rawInput(r: Raster) {
  return sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), { raw: { width: r.width, height: r.height, channels: 4 } });
}

describe("fill", () => {
  it("paints every pixel the color imagescript's fill gives", () => {
    const r = randomRaster(13, 9, 7, "random");
    const expected = toImage(clone(r)).fill(Image.rgbaToColor(70, 70, 76, 255));
    expect(Buffer.from(fill(r, [70, 70, 76, 255]).data)).toEqual(Buffer.from(expected.bitmap));
  });
});

describe("overlay", () => {
  it("matches imagescript's composite pixel for pixel on random layers, including offsets that leave the ground", () => {
    const cases: Array<[number, number, number]> = [[1, 0, 0], [2, 10, 7], [3, -5, -9], [4, 50, 40], [5, 63, 47], [6, 70, 0], [7, 2.7, -3.4]];
    for (const [seed, x, y] of cases) {
      const bg = randomRaster(64, 48, seed, "random");
      const fg = randomRaster(20, 30, seed + 100, "edges");
      const expected = toImage(clone(bg)).composite(toImage(fg), x, y);
      expect(Buffer.from(overlay(bg, fg, x, y).data)).toEqual(Buffer.from(expected.bitmap));
    }
  });
});

describe("resizeNearest", () => {
  it("matches imagescript's resize for the title's half size, for odd ratios, and for the same size", () => {
    const cases: Array<[number, number, number, number]> = [[1088, 1936, 544, 968], [37, 53, 20, 11], [10, 10, 25, 7], [37, 53, 20.9, 11.5], [3, 2, 147, 98], [49, 10, 49, 10], [103, 7, 103, 7], [49, 10, 49.6, 10.2]];
    for (const [sw, sh, w, h] of cases) {
      const src = randomRaster(sw, sh, sw + sh, "random");
      const expected = toImage(src).resize(w, h);
      const out = resizeNearest(src, w, h);
      expect([out.width, out.height]).toEqual([expected.width, expected.height]);
      expect(Buffer.compare(Buffer.from(out.data), Buffer.from(expected.bitmap))).toBe(0);
    }
    const src = randomRaster(49, 10, 59, "random");
    expect(resizeNearest(src, 49, 10).data).not.toBe(src.data);
  });
});

describe("crop", () => {
  it("matches imagescript's crop, including one that runs past the row", () => {
    const cases: Array<[number, number, number, number]> = [[5, 7, 20, 10], [30, 0, 10, 5], [3.9, 2.2, 8.7, 4.1]];
    for (const [x, y, w, h] of cases) {
      const src = randomRaster(32, 24, 11, "random");
      const expected = toImage(src).crop(x, y, w, h);
      const out = crop(src, x, y, w, h);
      expect([out.width, out.height]).toEqual([expected.width, expected.height]);
      expect(Buffer.from(out.data)).toEqual(Buffer.from(expected.bitmap));
    }
  });
});

describe("decodeRaster and encodePng", () => {
  it("decodes RGBA, RGB, palette and gray PNGs to the pixels imagescript gives", async () => {
    const base = randomRaster(40, 30, 21, "random");
    const variants = {
      rgba: await rawInput(base).png().toBuffer(),
      rgb: await rawInput(base).removeAlpha().png().toBuffer(),
      palette: await rawInput(base).png({ palette: true, colours: 64 }).toBuffer(),
      gray: await rawInput(base).toColourspace("b-w").png().toBuffer(),
    };
    for (const [name, bytes] of Object.entries(variants)) {
      const decoded = await decodeRaster(bytes);
      const expected = await Image.decode(bytes);
      expect([name, decoded.width, decoded.height]).toEqual([name, expected.width, expected.height]);
      expect([name, Buffer.compare(Buffer.from(decoded.data), Buffer.from(expected.bitmap))]).toEqual([name, 0]);
    }
  });

  it("decodes a 16-bit PNG to within one step of imagescript", async () => {
    const bytes = await rawInput(randomRaster(40, 30, 22, "random")).toColourspace("rgb16").png().toBuffer();
    expect(bytes[24]).toBe(16);
    const decoded = await decodeRaster(bytes);
    const expected = await Image.decode(bytes);
    expect([decoded.width, decoded.height]).toEqual([expected.width, expected.height]);
    let most = 0;
    for (let i = 0; i < decoded.data.length; i++) most = Math.max(most, Math.abs(decoded.data[i] - expected.bitmap[i]));
    expect(most).toBeLessThanOrEqual(1);
  });

  it("round-trips through encodePng unchanged, and imagescript reads the result back identically", async () => {
    const r = randomRaster(40, 30, 23, "edges");
    const png = await encodePng(r);
    expect(Buffer.from((await decodeRaster(png)).data)).toEqual(Buffer.from(r.data));
    expect(Buffer.from(fromImage(await Image.decode(png)).data)).toEqual(Buffer.from(r.data));
  });

  it("refuses bytes that are not a picture, in the product's words", async () => {
    await expect(decodeRaster(new TextEncoder().encode("<html>not found</html>"))).rejects.toThrow("The file is not a picture that can be read.");
  });
});

describe("encodeJpeg", () => {
  it("writes a JPEG of the raster's size at the asked quality, dropping alpha as the old encoder did", async () => {
    const r = randomRaster(40, 30, 24, "random");
    for (const quality of [0, 80, 500]) {
      const meta = await sharp(await encodeJpeg(r, quality)).metadata();
      expect([meta.format, meta.width, meta.height, meta.channels]).toEqual(["jpeg", 40, 30, 3]);
    }
    expect((await encodeJpeg(r, 10)).length).toBeLessThan((await encodeJpeg(r, 95)).length);
  });
});

describe("alphaBox", () => {
  it("finds the box of visible pixels above the threshold, and nothing on an empty layer", () => {
    const r = raster(100, 60);
    const setAlpha = (x: number, y: number, a: number) => { r.data[(y * r.width + x) * 4 + 3] = a; };
    setAlpha(10, 5, 200);
    setAlpha(40, 30, 200);
    setAlpha(90, 50, 16);
    expect(alphaBox(r, 16)).toEqual({ x: 10, y: 5, width: 31, height: 26 });
    expect(alphaBox(raster(8, 8), 16)).toBeNull();
  });
});
