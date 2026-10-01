// From a read that reproduced a post to a reusable template: the fixed layers
// stay as they are, text layers become slots by role (box, size, weight,
// colour, alignment, line pitch, max lines), lifted images become assets, and
// the hero or photo layer becomes the hero slot. New posts are composed by
// filling the slots; the layout itself is never re-decided.
import type { Layer, Span, Spec, Weight } from '../render/layers.ts';
import { wrapSpans, type Faces } from '../render/layers.ts';

export type SlotRole = 'eyebrow' | 'headline' | 'sub' | 'attribution' | 'counter';
export interface TextSlot { role: SlotRole; x: number; y: number; w: number; h: number; size: number; lineHeight: number; align: 'left' | 'center' | 'right'; weight: Weight; color: string; accent?: string; maxLines: number; face?: string; sample: string }
export interface HeroSlot { role: 'hero' | 'photo'; x: number; y: number; w: number; h: number; radius?: number }
export interface Template {
  id: string; name: string; source_path: string; score: number; width: number; height: number; format: string;
  fixed: Layer[];                 // background, panels, lines, frame, lifted assets (with stored hrefs)
  slots: TextSlot[]; hero: HeroSlot | null; logo: { x: number; y: number; w: number; h: number } | null;
  faces: { primary: string; secondary?: string };
}

export function formatOf(width: number, height: number): string {
  const r = width / height;
  return Math.abs(r - 0.8) < 0.04 ? '4:5' : Math.abs(r - 1) < 0.04 ? '1:1' : r < 0.6 ? '9:16' : r > 1.6 ? '16:9' : Math.abs(r - 0.667) < 0.05 ? '2:3' : r > 1.2 ? '16:9' : '1:1';
}

/** Build the template from the model's layer list (as kept) and the asset URLs stored for lifted images. */
export function templateFromRead(args: { id: string; name: string; source_path: string; score: number; width: number; height: number; layers: any[]; assetUrls: Record<number, string>; logoUrl: string | null; faces: { primary: string; secondary?: string } }): Template {
  const fixed: Layer[] = []; const slots: TextSlot[] = []; let hero: HeroSlot | null = null; let logo: Template['logo'] = null;
  const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  args.layers.forEach((L, i) => {
    if (L.type === 'background') fixed.push({ type: 'background', color: L.color || '#000000', gradient: L.gradient });
    else if (L.type === 'panel') fixed.push({ type: 'panel', x: n(L.x), y: n(L.y), w: n(L.w, 10), h: n(L.h, 10), radius: n(L.radius), fill: L.color || '#222222', fillOpacity: n(L.fillOpacity, 1), gradient: L.gradient, stroke: L.stroke, strokeOpacity: n(L.strokeOpacity, 1), strokeWidth: n(L.strokeWidth, 1) });
    else if (L.type === 'line') fixed.push({ type: 'line', x1: n(L.x1), y1: n(L.y1), x2: n(L.x2, args.width), y2: n(L.y2), color: L.color || '#ffffff', opacity: n(L.opacity, 1), width: n(L.width, 1) });
    else if (L.type === 'frame') fixed.push({ type: 'frame', inset: n(L.inset), width: n(L.width, 3), radius: n(L.radius), colors: Array.isArray(L.colors) && L.colors.length ? L.colors : ['#ffffff'] });
    else if (L.type === 'image') {
      const box = { x: n(L.x), y: n(L.y), w: n(L.w, 10), h: n(L.h, 10) };
      if (L.role === 'logo') { logo = box; if (args.logoUrl) fixed.push({ type: 'image', href: args.logoUrl, ...box, fit: 'contain' }); }
      else if (L.role === 'hero' || L.role === 'photo' || L.role === 'backdrop') { if (!hero || box.w * box.h > hero.w * hero.h) hero = { role: L.role === 'photo' ? 'photo' : 'hero', ...box, radius: n(L.radius, 0) || undefined }; }
      else if (args.assetUrls[i]) fixed.push({ type: 'image', href: args.assetUrls[i], ...box, fit: 'contain', opacity: n(L.opacity, 1) });
    } else if (L.type === 'text') {
      const role: SlotRole = (['eyebrow', 'headline', 'sub', 'attribution', 'counter'] as SlotRole[]).includes(L.role) ? L.role : 'sub';
      const size = Math.max(8, n(L.size, 40)); const lhRaw = n(L.lineHeight, 0); const lineHeight = lhRaw > 3 ? Math.max(0.9, Math.min(2.2, lhRaw / size)) : lhRaw > 0 ? lhRaw : 1.2;
      const lines: any[] = Array.isArray(L.lines) ? L.lines : [];
      const spans = lines.flat().filter((s) => s && typeof s === 'object');
      const accent = spans.map((s) => s.color).find((c) => c && c.toLowerCase() !== (L.color || '#ffffff').toLowerCase());
      slots.push({ role, x: n(L.x), y: n(L.y), w: n(L.w, args.width), h: n(L.h, size * lines.length * lineHeight), size, lineHeight, align: L.align || 'left', weight: (L.weight || 400) as Weight, color: L.color || '#ffffff', accent, maxLines: Math.max(1, lines.length), sample: lines.map((ln: any[]) => (Array.isArray(ln) ? ln : [ln]).map((s: any) => s?.text || '').join('')).join(' / ') });
    }
  });
  return { id: args.id, name: args.name, source_path: args.source_path, score: args.score, width: args.width, height: args.height, format: formatOf(args.width, args.height), fixed, slots, hero, logo, faces: args.faces };
}

/** Fill a template's slots with new copy and a hero image; the copy is wrapped and, only when it cannot fit, shrunk step by step. */
export function fillTemplate(t: Template, faces: Faces, copy: Partial<Record<SlotRole, Span[]>>, heroHref: string | null): Spec {
  const layers: Layer[] = [];
  const bg = t.fixed.find((l) => l.type === 'background'); if (bg) layers.push(bg);
  if (t.hero && heroHref) layers.push({ type: 'image', href: heroHref, x: t.hero.x, y: t.hero.y, w: t.hero.w, h: t.hero.h, fit: 'cover', radius: t.hero.radius });
  for (const l of t.fixed) if (l.type !== 'background') layers.push(l);
  for (const s of t.slots) {
    const spans = copy[s.role]; if (!spans || !spans.length) continue;
    const face = s.face || t.faces.primary;
    let size = s.size; let lines: Span[][] = [];
    for (; size >= s.size * 0.6; size -= 2) { lines = wrapSpans(faces, spans, size, s.w, s.weight, face); if (lines.length <= s.maxLines) break; }
    layers.push({ type: 'text', x: s.x, y: s.y, w: s.w, size, lineHeight: s.lineHeight, align: s.align, weight: s.weight, face, color: s.color, lines: lines.map((ln) => ln.map((sp) => ({ ...sp, color: sp.color || (sp.weight && sp.weight !== s.weight && s.accent ? s.accent : undefined) }))) });
  }
  return { width: t.width, height: t.height, layers };
}
