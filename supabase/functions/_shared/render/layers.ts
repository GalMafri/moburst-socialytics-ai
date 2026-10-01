// A layered design spec rendered exactly as written: background, images,
// rounded panels (solid, gradient or glass), text blocks with per-span weight
// and colour, logo and glyph assets, hairlines, gradient frames. The spec is
// what the template reader produces from a client's real post and what the
// per-post composer fills with new copy; nothing here decides a layout.
import opentype from 'https://esm.sh/opentype.js@1.3.4';
import { ensureResvg } from './resvg.ts';
import { Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';

export type Weight = 300 | 400 | 500 | 600 | 700;
export type Span = { text: string; weight?: Weight; color?: string; face?: string };
export type Gradient = { from: string; to: string; angle?: number };
export type Layer =
  | { type: 'background'; color: string; gradient?: Gradient }
  | { type: 'image'; href: string; x: number; y: number; w: number; h: number; fit?: 'cover' | 'contain'; opacity?: number; radius?: number }
  | { type: 'panel'; x: number; y: number; w: number; h: number; radius: number; fill: string; fillOpacity?: number; gradient?: Gradient; stroke?: string; strokeOpacity?: number; strokeWidth?: number; backdrop?: string }
  | { type: 'text'; x: number; y: number; w: number; size: number; lineHeight?: number; align?: 'left' | 'center' | 'right'; weight?: Weight; face?: string; color: string; lines: Span[][]; letterSpacing?: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; opacity?: number; width: number }
  | { type: 'frame'; inset: number; width: number; radius: number; colors: string[] };
export interface Spec { width: number; height: number; layers: Layer[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The faces a render may use: one or more families, each at the weights that exist. */
export class Faces {
  private parsed = new Map<string, Map<number, any>>();
  readonly files: Uint8Array[] = [];
  constructor(public readonly defaultFamily: string, families: Record<string, Record<number, Uint8Array>>) {
    for (const [family, weights] of Object.entries(families)) {
      const m = new Map<number, any>();
      for (const [w, bytes] of Object.entries(weights)) { m.set(Number(w), opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))); this.files.push(bytes); }
      this.parsed.set(family, m);
    }
  }
  private face(family: string | undefined, weight: number) {
    const m = this.parsed.get(family || this.defaultFamily) || this.parsed.get(this.defaultFamily)!;
    const ws = [...m.keys()].sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight));
    return m.get(ws[0]);
  }
  advance(text: string, size: number, weight: number, family?: string, letterSpacing = 0): number {
    return this.face(family, weight).getAdvanceWidth(text, size) + letterSpacing * Math.max(0, text.length - 1);
  }
}

function gradientDef(id: string, g: Gradient): string {
  const a = ((g.angle ?? 90) % 360) * Math.PI / 180;
  const x1 = 0.5 - Math.cos(a) / 2, y1 = 0.5 - Math.sin(a) / 2, x2 = 0.5 + Math.cos(a) / 2, y2 = 0.5 + Math.sin(a) / 2;
  return `<linearGradient id="${id}" x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}"><stop offset="0" stop-color="${g.from}"/><stop offset="1" stop-color="${g.to}"/></linearGradient>`;
}

/** Wrap spans into lines that fit a width, keeping span styling; returns the lines. */
export function wrapSpans(faces: Faces, spans: Span[], size: number, maxWidth: number, base: Weight, family?: string): Span[][] {
  const words: Span[] = [];
  for (const s of spans) for (const w of s.text.split(/\s+/).filter(Boolean)) words.push({ ...s, text: w });
  const lines: Span[][] = []; let line: Span[] = []; let width = 0;
  const space = faces.advance(' ', size, base, family);
  for (const w of words) {
    const adv = faces.advance(w.text, size, w.weight ?? base, w.face || family);
    if (line.length && width + space + adv > maxWidth) { lines.push(line); line = []; width = 0; }
    line.push(w); width += (line.length > 1 ? space : 0) + adv;
  }
  if (line.length) lines.push(line);
  // join adjacent words of one style into single spans with spaces between
  return lines.map((ws) => ws.reduce<Span[]>((acc, w) => { const last = acc[acc.length - 1]; if (last && last.weight === w.weight && last.color === w.color && last.face === w.face) last.text += ' ' + w.text; else acc.push({ ...w }); return acc; }, []));
}

export function composeLayers(spec: Spec, faces: Faces): string {
  const defs: string[] = []; const body: string[] = []; let n = 0;
  for (const L of spec.layers) {
    const id = `l${n++}`;
    if (L.type === 'background') {
      if (L.gradient) { defs.push(gradientDef(id, L.gradient)); body.push(`<rect width="${spec.width}" height="${spec.height}" fill="url(#${id})"/>`); }
      else body.push(`<rect width="${spec.width}" height="${spec.height}" fill="${L.color}"/>`);
    } else if (L.type === 'image') {
      if (L.radius) defs.push(`<clipPath id="${id}c"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="${L.radius}"/></clipPath>`);
      body.push(`<image href="${L.href}" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" preserveAspectRatio="xMidYMid ${L.fit === 'contain' ? 'meet' : 'slice'}" opacity="${L.opacity ?? 1}"${L.radius ? ` clip-path="url(#${id}c)"` : ''}/>`);
    } else if (L.type === 'panel') {
      let fill = L.fill;
      if (L.gradient) { defs.push(gradientDef(id, L.gradient)); fill = `url(#${id})`; }
      if (L.backdrop) { defs.push(`<clipPath id="${id}c"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="${L.radius}"/></clipPath>`); body.push(`<image href="${L.backdrop}" x="0" y="0" width="${spec.width}" height="${spec.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)" image-rendering="optimizeQuality"/>`); }
      body.push(`<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="${L.radius}" fill="${fill}" fill-opacity="${L.fillOpacity ?? 1}"${L.stroke ? ` stroke="${L.stroke}" stroke-opacity="${L.strokeOpacity ?? 1}" stroke-width="${L.strokeWidth ?? 1}"` : ''}/>`);
    } else if (L.type === 'text') {
      const lh = L.lineHeight ?? 1.2; const base = L.weight ?? 400;
      L.lines.forEach((spans, i) => {
        const widths = spans.map((s) => faces.advance(s.text, L.size, s.weight ?? base, s.face || L.face, L.letterSpacing ?? 0));
        const total = widths.reduce((a, b) => a + b, 0);
        let x = L.align === 'center' ? L.x + (L.w - total) / 2 : L.align === 'right' ? L.x + L.w - total : L.x;
        const y = L.y + L.size * 0.78 + i * L.size * lh;
        const parts = spans.map((s, j) => { const t = `<tspan x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${esc(s.face || L.face || faces.defaultFamily)}" font-weight="${s.weight ?? base}" fill="${s.color ?? L.color}">${esc(s.text)}</tspan>`; x += widths[j]; return t; });
        body.push(`<text font-size="${L.size}"${L.letterSpacing ? ` letter-spacing="${L.letterSpacing}"` : ''}>${parts.join('')}</text>`);
      });
    } else if (L.type === 'line') {
      body.push(`<line x1="${L.x1}" y1="${L.y1}" x2="${L.x2}" y2="${L.y2}" stroke="${L.color}" stroke-opacity="${L.opacity ?? 1}" stroke-width="${L.width}"/>`);
    } else if (L.type === 'frame') {
      defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${L.colors.map((c, i) => `<stop offset="${(i / Math.max(1, L.colors.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('')}</linearGradient>`);
      body.push(`<rect x="${L.inset + L.width / 2}" y="${L.inset + L.width / 2}" width="${spec.width - 2 * L.inset - L.width}" height="${spec.height - 2 * L.inset - L.width}" rx="${L.radius}" fill="none" stroke="url(#${id})" stroke-width="${L.width}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}"><defs>${defs.join('')}</defs>${body.join('\n')}</svg>`;
}

/** Rasterise a layered spec to PNG bytes. */
export async function renderLayers(db: any, spec: Spec, faces: Faces): Promise<Uint8Array> {
  await ensureResvg(db);
  const r = new Resvg(composeLayers(spec, faces), { fitTo: { mode: 'width', value: spec.width }, font: { fontBuffers: faces.files, defaultFontFamily: faces.defaultFamily, loadSystemFonts: false } });
  return r.render().asPng();
}
