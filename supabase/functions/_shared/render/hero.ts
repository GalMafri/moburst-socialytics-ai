// The hero for a render, as two self-contained data URLs: the artwork itself
// and a small blurred copy the composer places under a glass card. Blurring a
// quarter-scale copy in JS and letting the rasteriser upscale it costs a few
// milliseconds where an SVG gaussian filter at full size costs most of a
// second of CPU, which the edge runtime does not have.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

export function bytesToDataUrl(bytes: Uint8Array, type = 'image/png'): string {
  let out = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  return `data:${type};base64,${btoa(out)}`;
}

function boxBlur(img: Image, radius: number, passes: number) {
  const W = img.width, H = img.height;
  let src = new Uint8ClampedArray(img.bitmap);
  let dst = new Uint8ClampedArray(src.length);
  const span = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[(y * W + Math.min(W - 1, Math.max(0, x))) * 4 + c];
      for (let x = 0; x < W; x++) {
        dst[(y * W + x) * 4 + c] = sum / span;
        sum += src[(y * W + Math.min(W - 1, x + radius + 1)) * 4 + c] - src[(y * W + Math.max(0, x - radius)) * 4 + c];
      }
    }
    for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
    [src, dst] = [dst, src];
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += src[(Math.min(H - 1, Math.max(0, y)) * W + x) * 4 + c];
      for (let y = 0; y < H; y++) {
        dst[(y * W + x) * 4 + c] = sum / span;
        sum += src[(Math.min(H - 1, y + radius + 1) * W + x) * 4 + c] - src[(Math.max(0, y - radius) * W + x) * 4 + c];
      }
    }
    for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
    [src, dst] = [dst, src];
  }
  img.bitmap.set(src);
}

/** Data URLs for the hero and its soft copy, plus the decoded size. */
export async function heroHrefs(bytes: Uint8Array, type = 'image/png'): Promise<{ heroHref: string; softHeroHref: string; width: number; height: number }> {
  const img = await Image.decode(bytes);
  const scale = 4;
  const small = img.clone().resize(Math.max(8, Math.round(img.width / scale)), Math.max(8, Math.round(img.height / scale)));
  boxBlur(small, 4, 3);
  for (let i = 0; i < small.bitmap.length; i += 4) { small.bitmap[i] = Math.round(small.bitmap[i] * 0.82); small.bitmap[i + 1] = Math.round(small.bitmap[i + 1] * 0.82); small.bitmap[i + 2] = Math.round(small.bitmap[i + 2] * 0.82); }
  return { heroHref: bytesToDataUrl(bytes, type), softHeroHref: bytesToDataUrl(await small.encode()), width: img.width, height: img.height };
}
