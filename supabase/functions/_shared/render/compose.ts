// Compose one finished social still as SVG from a template, the brand tokens,
// the headline and the hero. Everything that makes the post the brand's is
// decided here in code; the hero is the only generated layer.
import type { DesignSystem, Template, LogoPosition } from '../design-system/types.ts';
import type { PlatformDesignSpec } from '../design-prompts/aspect.ts';
import { advance, wordsOf, wrap, type Face, type Word } from './measure.ts';

export interface ComposeInput {
  width: number; height: number;
  system: DesignSystem; template: Template; spec: PlatformDesignSpec;
  headline: string; emphasis?: string | null; sub?: string | null;
  heroHref: string;              // data URL or https URL of the hero (or photo)
  softHeroHref?: string;         // a small blurred copy of the hero, for the glass card backdrop
  logoHref: string;              // data URL or https URL of the transparent logo asset
  logoAspect: number;            // width / height of the logo asset
}

export interface ComposeResult { svg: string; fontSize: number; lines: number; card: { x: number; y: number; width: number; height: number } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cased = (s: string, casing: string) => casing === 'upper' ? s.toUpperCase() : s;

function logoX(position: LogoPosition, W: number, safeL: number, safeR: number, lw: number): number {
  return position === 'top-left' ? safeL : position === 'top-right' ? W - safeR - lw : (W - lw) / 2;
}

export function compose(face: Face, input: ComposeInput): ComposeResult {
  const { width: W, height: H, system, template, spec } = input;
  const t = system.tokens;
  const orientation = H > W * 1.05 ? 'portrait' : W > H * 1.2 ? 'landscape' : 'square';
  const safeL = W * spec.safe.left, safeR = W * spec.safe.right, safeT = H * spec.safe.top, safeB = H * spec.safe.bottom;
  const innerW = W - safeL - safeR, innerH = H - safeT - safeB;
  const region = template.headline.region;
  const side = region === 'left' || region === 'right';
  const cardW = side ? innerW * (template.headline.width_pct / 100) : innerW;
  const x = region === 'right' ? W - safeR - cardW : safeL;

  // Logo: the brand's own asset, where the brand keeps it, inside the safe area.
  const lw = Math.min(W * (t.logo.width_pct[orientation] / 100), H * 0.29), lh = lw / input.logoAspect;
  const lx = logoX(t.logo.position, W, safeL, safeR, lw), ly = safeT + H * 0.03;
  const logoBand = ly + lh + H * 0.035;

  // Headline: the brand face, sized by the platform, shrunk until it fits the region.
  const bodyBold = t.font.body_weight === 700;
  const words: Word[] = wordsOf(cased(input.headline, t.font.casing), input.emphasis);
  let size = Math.round(W * (template.headline.scale ?? spec.headlineScale));
  let lines: Word[][] = [];
  const padFor = (s: number) => (template.card ? s * 0.75 : 0);
  for (; size >= Math.round(H * 0.02); size -= 2) {
    lines = wrap(face, words, size, cardW - padFor(size) * 2, bodyBold);
    const h = lines.length * size * 1.22 + padFor(size) * 2;
    if (lines.length <= template.headline.max_lines && h <= innerH * (side ? 0.62 : 0.44)) break;
  }
  const pad = padFor(size), lineH = size * 1.22, cardH = lines.length * lineH + pad * 2;
  const y = region === 'top' ? Math.max(logoBand, safeT + innerH * 0.12)
    : region === 'bottom' ? H - safeB - innerH * 0.06 - cardH
    : Math.max(logoBand, safeT + (innerH - cardH) / 2);
  const radius = size * t.card.radius_em;

  const textLines = lines.map((line, i) => {
    const baseline = y + pad + (i + 0.5) * lineH + size * 0.35;
    let cx = x + pad; const parts: string[] = [];
    line.forEach((word, j) => {
      const bold = word.em || bodyBold;
      parts.push(`<tspan x="${cx.toFixed(1)}" y="${baseline.toFixed(1)}" fill="${word.em ? t.colors.accent : t.colors.ink}" font-weight="${bold ? 700 : 400}">${esc(word.text)}</tspan>`);
      cx += advance(face, word.text, size, bold) + (j < line.length - 1 ? advance(face, ' ', size, bodyBold) : 0);
    });
    return parts.join('');
  }).join('');

  const frameColors = t.colors.frame && t.colors.frame.length >= 2 ? t.colors.frame : [t.colors.accent, t.colors.ink];
  const frameStops = frameColors.map((c, i) => `<stop offset="${(i / (frameColors.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  const frameW = Math.max(2, W * (t.frame.width_pct / 100));
  const outerRadius = W * 0.02;
  const hero = `<image href="${input.heroHref}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;
  const card = template.card && t.card.style !== 'none' ? `
  <g clip-path="url(#card)">
    ${t.card.style === 'glass' ? `<image href="${input.softHeroHref || input.heroHref}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" image-rendering="optimizeQuality"/>` : ''}
    <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" fill="${t.colors.surface}" fill-opacity="${t.card.style === 'glass' ? t.card.alpha : 1}"/>
    <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" fill="url(#sheen)"/>
  </g>
  <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="${radius}" fill="none" stroke="#ffffff" stroke-opacity="${t.card.border_alpha}" stroke-width="${Math.max(1, W / 1000)}"/>` : '';
  const frame = template.frame && t.frame.style !== 'none' ? `<rect x="${frameW / 2}" y="${frameW / 2}" width="${W - frameW}" height="${H - frameW}" rx="${outerRadius}" fill="none" stroke="${t.frame.style === 'gradient' ? 'url(#frame)' : t.colors.ink}" stroke-opacity="${t.frame.style === 'gradient' ? 1 : 0.18}" stroke-width="${frameW}"/>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="card"><rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="${radius}"/></clipPath>
    <clipPath id="outer"><rect x="0" y="0" width="${W}" height="${H}" rx="${template.frame ? outerRadius : 0}"/></clipPath>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">${frameStops}</linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${t.colors.background}"/>
  <g clip-path="url(#outer)">${hero}</g>
  ${card}
  <text font-family="${esc(t.font.family)}" font-size="${size}">${textLines}</text>
  <image href="${input.logoHref}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>
  ${frame}
</svg>`;
  return { svg, fontSize: size, lines: lines.length, card: { x, y, width: cardW, height: cardH } };
}
