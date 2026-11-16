// server/test/fixtures.ts
//
// Shared helpers for the picture tests (12 Nov 2026): a seeded generator so
// every random raster is the same on every run, rasters made from it, and
// the bridge to imagescript 1.3.0, the library the workers used, which the
// tests keep as the oracle the raster core must match byte for byte.

import { Image } from "imagescript";
import type { Raster } from "../src/picture/raster.ts";

/** A linear congruential generator; each call gives the next byte, 0 to 255. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
}

/**
 * A raster of seeded random colors. Alpha is 255 everywhere ("opaque"),
 * random ("random"), or a mix of fully clear, fully solid and in-between
 * pixels ("edges") so every branch of the blend runs.
 */
export function randomRaster(width: number, height: number, seed: number, alphaMode: "opaque" | "random" | "edges"): Raster {
  const next = seeded(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = next();
    data[i + 1] = next();
    data[i + 2] = next();
    const a = next();
    if (alphaMode === "opaque") data[i + 3] = 255;
    else if (alphaMode === "random") data[i + 3] = a;
    else data[i + 3] = a < 85 ? 0 : a < 170 ? 255 : next();
  }
  return { width, height, data };
}

/** The same pixels as an imagescript Image. */
export function toImage(r: Raster): Image {
  const image = new Image(r.width, r.height);
  image.bitmap.set(r.data);
  return image;
}

/** The pixels of an imagescript Image as a raster. */
export function fromImage(image: Image): Raster {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.bitmap) };
}

/** A copy that shares no memory with the original. */
export function clone(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

/** Alpha for a pixel whose center is d pixels inside a shape's edge (negative outside): one pixel of anti-aliasing. */
function edgeAlpha(d: number): number {
  return d >= 0.5 ? 255 : d <= -0.5 ? 0 : Math.round((d + 0.5) * 255);
}

/**
 * A square logo like Pay The Pyper's 2160x2160 file: a ring with a bar
 * through it, one color, anti-aliased edges, alpha 0 everywhere else.
 */
export function ringAndBarLogo(size = 2160): Raster {
  const out = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  const c = size / 2;
  const outer = size * 0.42, inner = size * 0.3;
  const barHalfW = size * 0.36, barHalfH = size * 0.06;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const ring = Math.min(outer - r, r - inner);
      const bar = Math.min(barHalfW - Math.abs(dx), barHalfH - Math.abs(dy));
      const a = edgeAlpha(Math.max(ring, bar));
      if (a === 0) continue;
      out.data.set([226, 38, 64, a], (y * size + x) * 4);
    }
  }
  return out;
}

/** A wide logo like the other clients' 700x239 files: a row of letter-like blocks with anti-aliased edges. */
export function wideLogo(width = 700, height = 239): Raster {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const letters = 6, pitch = width / letters, top = height * 0.15, bottom = height * 0.85;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = Math.floor(x / pitch), lx = x + 0.5 - i * pitch, py = y + 0.5;
      const barTop = i % 2 === 0 ? top : bottom - height * 0.2;
      const stem = Math.min(lx - pitch * 0.15, pitch * 0.35 - lx, py - top, bottom - py);
      const bar = Math.min(lx - pitch * 0.15, pitch * 0.85 - lx, py - barTop, barTop + height * 0.2 - py);
      const d = Math.max(stem, bar);
      const a = edgeAlpha(d);
      if (a === 0) continue;
      out.data.set([250, 250, 245, a], (y * width + x) * 4);
    }
  }
  return out;
}

/**
 * A title layer like the hook step's 1088x1936 PNG: three blobs of
 * lettering-like strokes, white with soft edges, on a transparent ground.
 */
export function titleLayer(width = 1088, height = 1936): Raster {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const blobs = [{ x: 140, y: 620, w: 800, h: 150 }, { x: 200, y: 800, w: 690, h: 150 }, { x: 320, y: 980, w: 450, h: 120 }];
  for (const b of blobs) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const lx = x - b.x + 0.5, ly = y - b.y + 0.5;
        const stroke = 9 - Math.abs(((lx * 0.9 + ly * 0.3) % 36) - 18);
        const d = Math.min(stroke, lx, b.w - lx, ly, b.h - ly);
        const a = edgeAlpha(d);
        if (a === 0) continue;
        out.data.set([255, 255, 255, a], (y * width + x) * 4);
      }
    }
  }
  return out;
}

/** An opaque picture like the model's: smooth seeded gradients with seeded grain, the same on every run. */
export function pagePicture(width: number, height: number, seed: number): Raster {
  const next = seeded(seed);
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out.data[i] = ((x * 255) / width + (next() >> 3)) | 0;
      out.data[i + 1] = ((y * 255) / height + (next() >> 3)) | 0;
      out.data[i + 2] = (((x + y) * 128) / (width + height) + (next() >> 2)) | 0;
      out.data[i + 3] = 255;
    }
  }
  return out;
}
