// server/src/picture/raster.ts
//
// The raster core of the picture service (12 Nov 2026): pictures in and out
// through sharp, and the five pixel operations the edge workers used from
// imagescript 1.3.0 (fill, crop, overlay, nearest-neighbor resize, and the
// box of visible pixels), ported with the same integer and floating-point
// arithmetic so the output is the same bytes imagescript gave. The tests
// keep imagescript as the oracle.

import sharp from "sharp";
import type { Rect } from "../../../supabase/functions/_shared/picture/contract.ts";

/** RGBA, straight alpha, row-major, 4 bytes per pixel: the layout imagescript's Image.bitmap had. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

const UNREADABLE = "The file is not a picture that can be read.";

/** A raster of the given size, every byte zero (clear black). */
export function raster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Any picture sharp reads, as 8-bit RGBA; anything else is refused in the product's words. */
export async function decodeRaster(bytes: Uint8Array): Promise<Raster> {
  try {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
  } catch {
    throw new Error(UNREADABLE);
  }
}

function rawInput(r: Raster): ReturnType<typeof sharp> {
  return sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), { raw: { width: r.width, height: r.height, channels: 4 } });
}

export async function encodePng(r: Raster): Promise<Uint8Array> {
  return rawInput(r).png({ compressionLevel: 6 }).toBuffer();
}

/** Alpha is dropped, as imagescript's encodeJPEG did; quality is clamped to 1..100 as it was there. */
export async function encodeJpeg(r: Raster, quality: number): Promise<Uint8Array> {
  return rawInput(r).removeAlpha().jpeg({ quality: Math.max(1, Math.min(100, quality)) }).toBuffer();
}

/** Every pixel set to the color, in place; returns the same raster. */
export function fill(r: Raster, rgba: [number, number, number, number]): Raster {
  const [red, green, blue, alpha] = rgba.map((c) => c & 0xff);
  const d = r.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = red;
    d[i + 1] = green;
    d[i + 2] = blue;
    d[i + 3] = alpha;
  }
  return r;
}

function pixels(r: Raster): Uint32Array {
  return new Uint32Array(r.data.buffer, r.data.byteOffset, r.data.byteLength >> 2);
}

/**
 * imagescript's crop: offsets and size truncated, size clamped to the
 * source's, each row a run of whole pixels from the flat buffer, so a crop
 * that starts inside a row and runs past its end reads on into the next row.
 */
export function crop(src: Raster, x: number, y: number, width: number, height: number): Raster {
  if (width > src.width) width = src.width;
  if (height > src.height) height = src.height;
  x = ~~x;
  y = ~~y;
  width = ~~width;
  height = ~~height;
  const out = raster(width, height);
  const from = pixels(src);
  const to = pixels(out);
  for (let ty = 0; ty < height; ty++) {
    const start = (ty + y) * src.width + x;
    to.set(from.subarray(start, start + width), ty * width);
  }
  return out;
}

/** imagescript's composite (straight-alpha blend of fg onto bg at x, y), in place on bg; returns bg. */
export function overlay(bg: Raster, fg: Raster, x: number, y: number): Raster {
  x = x | 0;
  y = y | 0;
  const fw = fg.width | 0;
  const bw = bg.width | 0;
  const ox = (x > 0 ? 0 : -x) | 0;
  const oy = (y > 0 ? 0 : -y) | 0;
  const top = (y > 0 ? y : 0) | 0;
  const left = (x > 0 ? x : 0) | 0;
  const width = (Math.min(bw, x + fw) - left) | 0;
  const height = (Math.min(bg.height | 0, y + (fg.height | 0)) - top) | 0;
  if (width <= 0 || height <= 0) return bg;

  const b = bg.data;
  const f = fg.data;
  for (let yy = 0; yy < height; yy++) {
    const fgRow = ox + fw * (yy + oy);
    const bgRow = left + bw * (yy + top);
    for (let xx = 0; xx < width; xx++) {
      const fi = (xx + fgRow) * 4;
      const bi = (xx + bgRow) * 4;
      const fa = f[fi + 3];
      if (fa === 0) continue;
      if (fa === 255) {
        b[bi] = f[fi];
        b[bi + 1] = f[fi + 1];
        b[bi + 2] = f[fi + 2];
        b[bi + 3] = 255;
        continue;
      }
      const alpha = 1 + fa;
      const inv = 256 - fa;
      b[bi] = (alpha * f[fi] + inv * b[bi]) >> 8;
      b[bi + 1] = (alpha * f[fi + 1] + inv * b[bi + 1]) >> 8;
      b[bi + 2] = (alpha * f[fi + 2] + inv * b[bi + 2]) >> 8;
      b[bi + 3] = Math.max(fa, b[bi + 3]);
    }
  }
  return bg;
}

/**
 * imagescript's nearest-neighbor resize, with its floating-point order kept
 * exactly. Like imagescript, a resize to the same size (after flooring)
 * returns the pixels unchanged: the loop would shift some columns and rows,
 * since (1 / w) * w can come out just below 1. The result is always a copy.
 */
export function resizeNearest(src: Raster, width: number, height: number): Raster {
  width = Math.floor(width);
  height = Math.floor(height);
  if (width === src.width && height === src.height) return { width, height, data: new Uint8ClampedArray(src.data) };
  const out = raster(width, height);
  const from = pixels(src);
  const to = pixels(out);
  const xw = (1 / width) * src.width;
  const yw = (1 / height) * src.height;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const srcRow = src.width * ((y * yw) | 0);
    for (let x = 0; x < width; x++) to[row + x] = from[srcRow + ((x * xw) | 0)];
  }
  return out;
}

/** The box of pixels whose alpha is above min, or null when there is none. */
export function alphaBox(r: Raster, min: number): Rect | null {
  let x0 = r.width, y0 = r.height, x1 = -1, y1 = -1;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
