// Which typeface a post's text is set in, found by rendering candidate
// families at the crop's height and comparing ink shapes, never by asking a
// model to name a font from a picture.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';
import { ensureResvg } from '../render/resvg.ts';
import { fontBytes } from '../render/fonts.ts';
import { Faces, composeLayers, type Layer } from '../render/layers.ts';

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
 * Score candidate families against a whole text block: the block is laid out
 * exactly as the read says (lines, size, pitch, alignment, weights) in each
 * candidate face and its ink is compared with the post's ink in that box.
 * Extra pixels in the crop (a glyph, a border) cost every candidate equally.
 */
export async function matchFontBlock(db: any, crop: Image, block: { lines: any[][]; size: number; lineHeight: number; align?: string; weight?: number }, families = CANDIDATE_FAMILIES): Promise<Array<{ family: string; score: number }>> {
  const target = inkMask(crop, 0.55); if (!target) return [];
  await ensureResvg(db);
  const W = crop.width, H = crop.height; const out: Array<{ family: string; score: number }> = [];
  const lh = block.lineHeight > 3 ? block.lineHeight / block.size : block.lineHeight || 1.2;
  for (const family of families) {
    try {
      const files: Record<number, Uint8Array> = {};
      for (const w of [400, 700]) { try { files[w] = await fontBytes(db, family, w); } catch { /* weight missing */ } }
      if (!files[400] && !files[700]) continue;
      const faces = new Faces(family, { [family]: files });
      const text: Layer = { type: 'text', x: 0, y: 0, w: W, size: block.size, lineHeight: lh, align: (block.align as any) || 'left', weight: (block.weight as any) || 400, color: '#ffffff', lines: block.lines.map((ln) => (Array.isArray(ln) ? ln : [ln]).map((sp: any) => ({ text: String(sp?.text || ''), weight: sp?.weight }))) };
      const svg = composeLayers({ width: W, height: H, layers: [{ type: 'background', color: '#000000' }, text] }, faces);
      const png = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: faces.files, defaultFontFamily: family, loadSystemFonts: false } }).render().asPng();
      const cand = inkMask(await Image.decode(png), 0.55); if (!cand) continue;
      out.push({ family, score: iou(target, cand) });
    } catch { /* family unusable */ }
  }
  return out.sort((a, b) => b.score - a.score);
}
