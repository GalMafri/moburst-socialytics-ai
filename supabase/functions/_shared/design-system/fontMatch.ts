// Which typeface a post's text is set in, found by rendering candidate
// families at the crop's height and comparing ink shapes, never by asking a
// model to name a font from a picture.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';
import { ensureResvg } from '../render/resvg.ts';
import { fontBytes } from '../render/fonts.ts';

export const CANDIDATE_FAMILIES = ['Inter', 'DM Sans', 'Poppins', 'Montserrat', 'Geist', 'Manrope', 'Plus Jakarta Sans', 'Outfit', 'Sora', 'Urbanist', 'Figtree', 'Nunito Sans', 'Open Sans', 'Roboto', 'Lato', 'Work Sans', 'Rubik', 'Karla', 'Mulish', 'Albert Sans', 'Lexend', 'Red Hat Display', 'Space Grotesk', 'IBM Plex Sans', 'Source Sans 3', 'Barlow', 'Heebo', 'Archivo', 'Public Sans', 'Instrument Sans', 'Onest', 'Hanken Grotesk', 'Be Vietnam Pro', 'Jost', 'Questrial', 'Quicksand', 'Gantari', 'Wix Madefor Display', 'Golos Text', 'Schibsted Grotesk'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Binary ink mask of light (or saturated) text on a dark ground, trimmed to its bounding box. */
export function inkMask(img: Image, threshold = 0.6): { mask: Uint8Array; w: number; h: number } | null {
  const W = img.width, H = img.height; const raw = new Uint8Array(W * H);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let i = 0; i < W * H; i++) { const p = img.bitmap; const l = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) / 255; if (l > threshold) { raw[i] = 1; const x = i % W, y = Math.floor(i / W); if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; } }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1; const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = raw[(y + minY) * W + x + minX];
  return { mask, w, h };
}

/** Row runs that carry text ink, as [y0, y1) pairs; runs closer than `gap` rows are one line. */
export function lineRuns(img: Image, gap: number, threshold = 0.55): Array<[number, number]> {
  const W = img.width, H = img.height; const rows = new Float32Array(H);
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const p = img.bitmap; if ((0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255 > threshold) n++; } rows[y] = n / W; }
  const on = Array.from(rows, (v) => v > 0.012);
  const runs: Array<[number, number]> = []; let start = -1, lastOn = -1;
  for (let y = 0; y <= H; y++) {
    const v = y < H && on[y];
    if (v) { if (start < 0) start = y; lastOn = y; }
    else if (start >= 0 && (y - lastOn > gap || y === H)) { runs.push([start, lastOn + 1]); start = -1; }
  }
  return runs.filter(([a, b]) => b - a >= 6);
}

function iou(a: { mask: Uint8Array; w: number; h: number }, b: { mask: Uint8Array; w: number; h: number }): number {
  // resize b onto a's grid by nearest sampling
  let inter = 0, union = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const bx = Math.min(b.w - 1, Math.floor(x * b.w / a.w)), by = Math.min(b.h - 1, Math.floor(y * b.h / a.h));
    const va = a.mask[y * a.w + x], vb = b.mask[by * b.w + bx]; if (va && vb) inter++; if (va || vb) union++;
  }
  return union ? inter / union : 0;
}

async function renderText(db: any, family: string, weight: number, text: string, bytes: Uint8Array, heightPx: number): Promise<Image> {
  await ensureResvg(db);
  const size = Math.round(heightPx * 1.35); const w = Math.round(size * text.length * 0.7) + 40, h = Math.round(size * 1.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><text x="10" y="${Math.round(size * 1.05)}" font-family="${esc(family)}" font-weight="${weight}" font-size="${size}" fill="#fff">${esc(text)}</text></svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: [bytes], defaultFontFamily: family, loadSystemFonts: false } }).render().asPng();
  return await Image.decode(png);
}

/**
 * Score every candidate family against one text crop (the crop's own words,
 * known from the read). Returns families best first with their IoU.
 */
export async function matchFont(db: any, crop: Image, text: string, weight: 400 | 700, families = CANDIDATE_FAMILIES): Promise<Array<{ family: string; score: number }>> {
  const target = inkMask(crop); if (!target) return [];
  const out: Array<{ family: string; score: number }> = [];
  for (const family of families) {
    try {
      const bytes = await fontBytes(db, family, weight);
      const rendered = await renderText(db, family, weight, text, bytes, target.h);
      const cand = inkMask(rendered); if (!cand) continue;
      out.push({ family, score: iou(target, cand) });
    } catch { /* family or weight missing on Google Fonts */ }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Score candidate families against a text block, line by line: each line's
 * band of the crop is trimmed to its ink and compared with the same line set
 * in the candidate face at the read's size, so position and the block's
 * other pixels do not decide the score. The mean over the lines is returned.
 */
export async function matchFontBlock(db: any, crop: Image, block: { lines: any[][]; size: number; lineHeight: number; align?: string; weight?: number }, families = CANDIDATE_FAMILIES): Promise<Array<{ family: string; score: number }>> {
  await ensureResvg(db);
  const size = Math.max(8, block.size || 40); const pitch = block.lineHeight > 3 ? block.lineHeight : (block.lineHeight || 1.2) * size;
  const lines = (block.lines || []).map((ln) => (Array.isArray(ln) ? ln : [ln])).filter((ln) => ln.length).slice(0, 4);
  if (!lines.length) return [];
  // Lines are found from the ink itself (rows with text), not from the box the read gave, which may sit a line off.
  // Runs shorter than half the type size are rules, glows or card edges, not lines of text; a run taller than
  // one and a half sizes is two lines joined by descenders and is split at the line pitch.
  const runs = lineRuns(crop, Math.max(3, Math.round(size * 0.06))).filter(([a, b]) => b - a >= size * 0.5)
    .flatMap(([a, b]): Array<[number, number]> => { const n = Math.max(1, Math.round((b - a) / pitch)); if (n === 1 || b - a < size * 1.5) return [[a, b]]; const step = (b - a) / n; return Array.from({ length: n }, (_, i) => [Math.round(a + i * step), Math.round(a + (i + 1) * step)] as [number, number]); });
  const bands: Array<{ mask: ReturnType<typeof inkMask>; text: string; weight: number }> = [];
  const take = runs.length >= lines.length ? runs.slice(0, lines.length) : runs;
  for (let i = 0; i < take.length; i++) {
    const [y0, y1] = take[i]; if (y1 - y0 < 6) continue;
    const band = crop.clone().crop(0, y0, crop.width, y1 - y0);
    const text = lines[i].map((sp: any) => String(sp?.text || '')).join('');
    const weight = Number(lines[i][0]?.weight || block.weight || 400) >= 600 ? 700 : 400;
    const mask = inkMask(band, 0.55); if (mask && mask.w > 20 && text.trim()) bands.push({ mask, text, weight });
  }
  if (!bands.length) return [];
  const out: Array<{ family: string; score: number }> = [];
  for (const family of families) {
    try {
      let total = 0, count = 0;
      for (const b of bands) {
        const bytes = await fontBytes(db, family, b.weight);
        const rendered = await renderText(db, family, b.weight, b.text, bytes, b.mask!.h);
        const cand = inkMask(rendered); if (!cand) continue;
        total += iou(b.mask!, cand); count++;
      }
      if (count) out.push({ family, score: total / count });
    } catch { /* family or weight missing on Google Fonts */ }
  }
  return out.sort((a, b) => b.score - a.score);
}
