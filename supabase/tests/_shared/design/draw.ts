// Small drawing helpers for the logo tone tests: rasters are drawn in the
// tests themselves, in made-up neutral colors.
import type { Rgb } from "../../../functions/_shared/picture/contract";
import type { Raster } from "../../../functions/_shared/design/logoTone";

/** A clear raster. */
export function blank(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** A filled rectangle drawn into `r`: x0 and y0 included, x1 and y1 not. Pixels off the raster are skipped. */
export function box(r: Raster, x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha = 255): Raster {
  for (let y = Math.max(0, y0); y < Math.min(r.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(r.width, x1); x++) r.data.set([color[0], color[1], color[2], alpha], (y * r.width + x) * 4);
  return r;
}

/** A raster filled with one opaque color. */
export function flat(width: number, height: number, color: Rgb): Raster {
  return box(blank(width, height), 0, 0, width, height, color);
}

/** A copy that shares no memory with the original. */
export function copyOf(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

/**
 * A wordmark-like logo with nothing symmetric about it: three bars of
 * different widths and heights and a low stroke under the first two, on a
 * clear ground, in one color.
 */
export function mark(width: number, height: number, color: Rgb, alpha = 255): Raster {
  const r = blank(width, height);
  const u = width / 40, v = height / 16;
  const bars: Array<[number, number, number, number]> = [[0, 0, 9, 16], [13, 5, 19, 16], [24, 0, 40, 7], [0, 13, 22, 16], [30, 10, 36, 16]];
  for (const [x0, y0, x1, y1] of bars) box(r, Math.round(x0 * u), Math.round(y0 * v), Math.round(x1 * u), Math.round(y1 * v), color, alpha);
  return r;
}

/** Draws a logo file's ink into a picture at a rectangle, by nearest pixel, in the file's own colors or in `color`. */
export function drawLogo(picture: Raster, logo: Raster, rect: { x: number; y: number; width: number; height: number }, color?: Rgb): Raster {
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    const lx = Math.floor((x * logo.width) / rect.width), ly = Math.floor((y * logo.height) / rect.height);
    const i = (ly * logo.width + lx) * 4;
    if (logo.data[i + 3] < 128) continue;
    const tx = rect.x + x, ty = rect.y + y;
    if (tx < 0 || ty < 0 || tx >= picture.width || ty >= picture.height) continue;
    picture.data.set(color ? [color[0], color[1], color[2], 255] : [logo.data[i], logo.data[i + 1], logo.data[i + 2], 255], (ty * picture.width + tx) * 4);
  }
  return picture;
}

/** A logo file with every ink pixel in one color and its alpha as it was. */
export function inked(logo: Raster, color: Rgb): Raster {
  const out = copyOf(logo);
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3] > 0) out.data.set(color, i);
  return out;
}
