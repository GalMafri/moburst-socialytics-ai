// How close a render is to the post it was read from: a structural score on
// downscaled greyscale (local means and variances, SSIM-style) plus a
// difference heatmap the reader can look at to see where it is off.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

function grey(img: Image, size: number): { data: Float32Array; w: number; h: number } {
  const scale = size / Math.max(img.width, img.height);
  const w = Math.max(8, Math.round(img.width * scale)), h = Math.max(8, Math.round(img.height * scale));
  const small = img.clone().resize(w, h); const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const p = small.bitmap; data[i] = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) / 255; }
  return { data, w, h };
}

/** Mean SSIM over 8x8 windows, 0..1, between two images of the same aspect. */
export async function similarity(aBytes: Uint8Array, bBytes: Uint8Array, size = 256): Promise<{ ssim: number; meanAbsDiff: number; heatmap: Uint8Array }> {
  const A = grey(await Image.decode(aBytes), size); const B0 = await Image.decode(bBytes);
  const Bimg = B0.width === A.w && B0.height === A.h ? B0 : B0.clone().resize(A.w, A.h);
  const B = { data: new Float32Array(A.w * A.h), w: A.w, h: A.h };
  for (let i = 0; i < A.w * A.h; i++) { const p = Bimg.bitmap; B.data[i] = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) / 255; }
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2, win = 8; let total = 0, count = 0, absSum = 0;
  const heat = new Image(A.w, A.h);
  for (let y = 0; y + win <= A.h; y += win / 2) for (let x = 0; x + win <= A.w; x += win / 2) {
    let ma = 0, mb = 0; for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { ma += A.data[(y + j) * A.w + x + i]; mb += B.data[(y + j) * A.w + x + i]; }
    ma /= win * win; mb /= win * win; let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const da = A.data[(y + j) * A.w + x + i] - ma, db = B.data[(y + j) * A.w + x + i] - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= win * win - 1; vb /= win * win - 1; cov /= win * win - 1;
    const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    total += s; count++;
    const bad = Math.max(0, Math.min(1, 1 - s));
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const px = x + i, py = y + j; const prev = heat.getPixelAt(px + 1, py + 1) & 255; const v = Math.max(prev, Math.round(bad * 255)); heat.setPixelAt(px + 1, py + 1, Image.rgbaToColor(v, 40, 255 - v, 255)); }
  }
  for (let i = 0; i < A.w * A.h; i++) absSum += Math.abs(A.data[i] - B.data[i]);
  return { ssim: count ? total / count : 0, meanAbsDiff: absSum / (A.w * A.h), heatmap: await heat.encode() };
}
