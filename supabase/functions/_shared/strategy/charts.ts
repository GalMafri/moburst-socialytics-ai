// supabase/functions/_shared/strategy/charts.ts
//
// The deck's charts, as SVG from the same numbers the page draws (spec:
// docs/superpowers/specs/2026-11-03-strategy-v2-design.md, section 4), in the
// deck's tokens: the brand in the Strategy section's gold (#E5C53D), the
// competitors and the "before" white at 25%, labels in white on transparent,
// Geist. Rendered to PNG at 2x by render/resvg.ts in the deck job.

export const GOLD = "#E5C53D";
export const MUTED = "rgba(255,255,255,0.25)";
const INK = "#FFFFFF";
const SOFT = "rgba(255,255,255,0.62)";
const FONT = "Geist";

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** "1.2K", "34", "5.4": the deck's figures, short. */
export function short(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 100 ? 1 : 0 });
}

export interface RankedRow { name: string; value: number; brand: boolean }

/** Bars for one measure, high to low, the brand in gold. y is where the group starts; returns its markup and height. */
function ranked(title: string, rows: RankedRow[], x: number, y: number, w: number, s: number): { svg: string; h: number } {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((r) => r.value), 0);
  const nameW = 150 * s, valueW = 64 * s, barH = 14 * s, rowH = 26 * s;
  const parts = [`<text x="${x}" y="${y + 14 * s}" font-family="${FONT}" font-weight="500" font-size="${12 * s}" fill="${INK}">${esc(title)}</text>`];
  sorted.forEach((r, i) => {
    const top = y + 28 * s + i * rowH;
    const span = w - nameW - valueW;
    const bw = max > 0 ? Math.max((r.value / max) * span, r.value > 0 ? 2 * s : 0) : 0;
    parts.push(`<text x="${x}" y="${top + barH - 2 * s}" font-family="${FONT}" font-weight="${r.brand ? 500 : 300}" font-size="${11 * s}" fill="${r.brand ? INK : SOFT}">${esc(r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name)}</text>`);
    parts.push(`<rect x="${x + nameW}" y="${top}" width="${bw.toFixed(1)}" height="${barH}" rx="${3 * s}" fill="${r.brand ? GOLD : MUTED}"/>`);
    parts.push(`<text x="${x + nameW + bw + 8 * s}" y="${top + barH - 2 * s}" font-family="${FONT}" font-weight="300" font-size="${11 * s}" fill="${INK}">${esc(short(r.value))}</text>`);
  });
  return { svg: parts.join(""), h: 28 * s + sorted.length * rowH };
}

/** "Where we start": posts a week and engagement per post, the brand against its competitors on one platform. */
export function startChart(a: { platform: string; posts: RankedRow[]; engagement: RankedRow[] }, scale = 2): { svg: string; width: number } {
  const w = 343 * scale, pad = 4 * scale;
  const first = ranked(`${a.platform}: posts a week`, a.posts, pad, pad, w - 2 * pad, scale);
  const second = a.engagement.length ? ranked(`${a.platform}: engagement per post`, a.engagement, pad, pad + first.h + 18 * scale, w - 2 * pad, scale) : { svg: "", h: 0 };
  const h = Math.ceil(pad + first.h + (second.h ? 18 * scale + second.h : 0) + pad);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${first.svg}${second.svg}</svg>`, width: w };
}

/** The pillar mix: each pillar's share of posts over the last 8 weeks (white 25%) against its planned share (gold). */
export function mixChart(pillars: Array<{ name: string; current: number | null; planned: number }>, scale = 2): { svg: string; width: number } {
  const w = 646 * scale, h = 78 * scale, n = Math.max(pillars.length, 1);
  const col = w / n, barW = 18 * scale, base = h - 18 * scale, top = 16 * scale;
  const max = Math.max(100, ...pillars.map((p) => Math.max(p.planned, p.current ?? 0)));
  const parts: string[] = [];
  pillars.forEach((p, i) => {
    const cx = i * col + col / 2;
    const bar = (v: number, x: number, fill: string) => {
      const bh = ((base - top) * v) / max;
      parts.push(`<rect x="${x}" y="${(base - bh).toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="${2 * scale}" fill="${fill}"/>`);
      parts.push(`<text x="${x + barW / 2}" y="${(base - bh - 4 * scale).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-weight="300" font-size="${10 * scale}" fill="${INK}">${v}%</text>`);
    };
    if (p.current !== null) bar(p.current, cx - barW - 2 * scale, MUTED);
    bar(p.planned, p.current !== null ? cx + 2 * scale : cx - barW / 2, GOLD);
    parts.push(`<text x="${cx}" y="${h - 3 * scale}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="${10 * scale}" fill="${INK}">${esc(p.name.length > 26 ? `${p.name.slice(0, 25)}…` : p.name)}</text>`);
  });
  const legend = pillars.some((p) => p.current !== null)
    ? `<rect x="0" y="0" width="${9 * scale}" height="${9 * scale}" fill="${MUTED}"/><text x="${13 * scale}" y="${8 * scale}" font-family="${FONT}" font-weight="300" font-size="${9 * scale}" fill="${SOFT}">Last 8 weeks</text><rect x="${92 * scale}" y="0" width="${9 * scale}" height="${9 * scale}" fill="${GOLD}"/><text x="${105 * scale}" y="${8 * scale}" font-family="${FONT}" font-weight="300" font-size="${9 * scale}" fill="${SOFT}">Planned</text>`
    : "";
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${legend}${parts.join("")}</svg>`, width: w };
}
