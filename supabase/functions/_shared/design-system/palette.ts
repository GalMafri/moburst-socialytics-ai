// The brand palette as measured from the posts' pixels: k-means in RGB on a
// downscaled sample of every post, with each colour's share of the surface.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

export async function palette(images: Uint8Array[], k = 8): Promise<Array<{ hex: string; share: number }>> {
  const px: number[][] = [];
  for (const bytes of images) { const im = (await Image.decode(bytes)).resize(120, 120); for (let i = 0; i < 120 * 120; i++) px.push([im.bitmap[i * 4], im.bitmap[i * 4 + 1], im.bitmap[i * 4 + 2]]); }
  if (!px.length) return [];
  let centres = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice());
  const assign = new Int32Array(px.length);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < px.length; i++) { let best = 0, bd = Infinity; for (let c = 0; c < k; c++) { const d = (px[i][0] - centres[c][0]) ** 2 + (px[i][1] - centres[c][1]) ** 2 + (px[i][2] - centres[c][2]) ** 2; if (d < bd) { bd = d; best = c; } } assign[i] = best; }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) { const s = sums[assign[i]]; s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++; }
    centres = sums.map((s, c) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[c]);
  }
  const counts = new Array(k).fill(0); for (let i = 0; i < px.length; i++) counts[assign[i]]++;
  return centres.map((c, i) => ({ hex: '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), share: counts[i] / px.length })).sort((a, b) => b.share - a.share);
}
