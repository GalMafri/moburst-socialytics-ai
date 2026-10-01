// Hero handling for renders. A generated hero arrives at the model's size
// (often 1856x2304 and 5-6 MB); the edge runtime allows about two seconds of
// CPU per request, so the hero is prepared once at canvas size together with
// a small blurred copy for the glass card, and every later render only draws
// same-size images. The blur runs on the quarter-scale copy in JS (a few ms)
// where an SVG gaussian filter at full size costs most of a second.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

export function bytesToDataUrl(bytes: Uint8Array, type = 'image/png'): string {
  let out = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  return `data:${type};base64,${btoa(out)}`;
}

/** Bytes of a public or signed image as a data URL, so an SVG is self-contained for the rasteriser. */
export async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`An image for the render could not be fetched [${res.status}]`);
  return bytesToDataUrl(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || 'image/png');
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

/** The glass backdrop: a quarter-scale copy of the hero, blurred and slightly darkened, as PNG bytes. */
export async function softCopy(smallPng: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(smallPng);
  boxBlur(img, 4, 3);
  for (let i = 0; i < img.bitmap.length; i += 4) { img.bitmap[i] = Math.round(img.bitmap[i] * 0.82); img.bitmap[i + 1] = Math.round(img.bitmap[i + 1] * 0.82); img.bitmap[i + 2] = Math.round(img.bitmap[i + 2] * 0.82); }
  return await img.encode();
}
