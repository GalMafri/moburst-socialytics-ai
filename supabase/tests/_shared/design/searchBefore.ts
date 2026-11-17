// The logo search as it was before it had steps: logoMatch.ts and
// logoTone.ts at main 782597b0 (17 Nov 2026, the commit the stepwise search
// was merged with; the two files were the same there as at b0d498dd and
// eba43c11), copied here as they were. It
// ran in one go, a spot at a time, and made its own luminance and shrunk
// pictures for every template. The tests keep it as the oracle the stepwise
// search must match bit for bit, the rectangle and the score, so any change
// to the arithmetic, to what is tried or to the order it is tried in fails
// against it. Nothing in the product imports this file.
import { canvasLogoRect } from "../../../functions/_shared/canva/brief";
import { coarseFactor, logoFound, luminance, shrink, templateSize, type Rect } from "../../../functions/_shared/design/logoMatch";
import type { Found, Raster, TemplateIn } from "../../../functions/_shared/design/logoTone";
import type { Placement } from "../../../functions/_shared/picture/contract";

export interface Match { x: number; y: number; width: number; height: number; score: number }

function ncc(img: Float32Array, iw: number, t: Float32Array, tw: number, th: number, tMean: number, tNorm: number, x: number, y: number): number {
  let sI = 0, sII = 0, sIT = 0;
  const n = tw * th;
  for (let j = 0; j < th; j++) {
    const row = (y + j) * iw + x, trow = j * tw;
    for (let i = 0; i < tw; i++) {
      const v = img[row + i];
      sI += v; sII += v * v; sIT += v * t[trow + i];
    }
  }
  const varI = sII - (sI * sI) / n;
  if (varI <= 1e-6 || tNorm <= 1e-6) return -1;
  return (sIT - tMean * sI) / Math.sqrt(varI * tNorm);
}

function nccEither(img: Float32Array, iw: number, t: Float32Array, tw: number, th: number, tNorm: number, x: number, y: number): number {
  let sI = 0, sII = 0, sIT = 0;
  const n = tw * th;
  for (let j = 0; j < th; j++) {
    const row = (y + j) * iw + x, trow = j * tw;
    for (let i = 0; i < tw; i++) {
      const v = img[row + i];
      sI += v; sII += v * v; sIT += v * t[trow + i];
    }
  }
  const varI = sII - (sI * sI) / n;
  if (varI <= 1e-6 || tNorm <= 1e-6) return -1;
  return Math.abs(sIT) / Math.sqrt(varI * tNorm);
}

function bestAt(img: Float32Array, iw: number, ih: number, logo: Float32Array, lw: number, lh: number,
  widths: number[], cx: [number, number], cy: [number, number], either = false): Match {
  let best: Match = { x: 0, y: 0, width: 0, height: 0, score: -2 };
  for (const tw of widths) {
    const th = Math.max(2, Math.round((tw * lh) / lw));
    if (tw < 4 || tw >= iw || th >= ih) continue;
    const t = shrink(logo, lw, lh, tw, th);
    let mean = 0;
    for (const v of t) mean += v;
    mean /= t.length;
    let norm = 0;
    for (const v of t) norm += (v - mean) * (v - mean);
    const t0 = new Float32Array(t.length);
    for (let k = 0; k < t.length; k++) t0[k] = t[k] - mean;
    for (let y = Math.max(0, cy[0]); y <= Math.min(ih - th, cy[1]); y++) {
      for (let x = Math.max(0, cx[0]); x <= Math.min(iw - tw, cx[1]); x++) {
        const s = either ? nccEither(img, iw, t0, tw, th, norm, x, y) : ncc(img, iw, t0, tw, th, 0, norm, x, y);
        if (s > best.score) best = { x, y, width: tw, height: th, score: s };
      }
    }
  }
  return best;
}

/** findLogo as it was. */
export function findLogoBefore(image: ArrayLike<number>, iw: number, ih: number, logo: ArrayLike<number>, lw: number, lh: number,
  expected: Rect, background: [number, number, number], opts: { reach?: number; scales?: [number, number]; either?: boolean } = {}): Match {
  const reach = opts.reach ?? 0.15;
  const either = opts.either === true;
  const [sMin, sMax] = opts.scales ?? [0.75, 1.3];
  const img = luminance(image, iw, ih);
  let tpl = luminance(logo, lw, lh, background);
  const small = templateSize(lw, lh, expected.width * sMax * 1.05);
  if (small) {
    tpl = shrink(tpl, lw, lh, small[0], small[1]);
    [lw, lh] = small;
  }
  const f = coarseFactor(expected.width, expected.height);
  const cw = Math.floor(iw / f), ch = Math.floor(ih / f);
  const coarse = shrink(img, iw, ih, cw, ch);
  const ew = expected.width / f;
  const widths: number[] = [];
  for (let s = sMin; s <= sMax + 1e-9; s += 0.04) widths.push(Math.round(ew * s));
  const rx = Math.round((reach * iw) / f), ry = Math.round((reach * ih) / f);
  const ex = Math.round(expected.x / f), ey = Math.round(expected.y / f);
  let c = bestAt(coarse, cw, ch, tpl, lw, lh, widths, [ex - rx, ex + rx], [ey - ry, ey + ry], either);
  let level = f;
  let rect = { x: c.x * level, y: c.y * level, width: c.width * level, height: c.height * level };
  while (level > 1) {
    level = Math.max(1, Math.floor(level / 2));
    const lw2 = Math.floor(iw / level), lh2 = Math.floor(ih / level);
    const im = level === 1 ? img : shrink(img, iw, ih, lw2, lh2);
    const w0 = rect.width / level;
    const ws = [-0.03, -0.015, 0, 0.015, 0.03].map((d) => Math.round(w0 * (1 + d)));
    const x0 = Math.round(rect.x / level), y0 = Math.round(rect.y / level), r = 3;
    c = bestAt(im, lw2, lh2, tpl, lw, lh, [...new Set(ws)], [x0 - r, x0 + r], [y0 - r, y0 + r], either);
    rect = { x: c.x * level, y: c.y * level, width: c.width * level, height: c.height * level };
  }
  return { ...rect, score: c.score };
}

/** searchTemplates as it was. */
export function searchTemplatesBefore(picture: Raster, templates: TemplateIn[], placement: Placement, scales: [number, number], opts: { either?: boolean } = {}): Found {
  let best: Found | null = null;
  let bestPasses = false;
  const scores: number[] = [];
  templates.forEach((t, index) => {
    const usual = canvasLogoRect(placement, t.raster.width, t.raster.height, picture.width, picture.height);
    const f = findLogoBefore(picture.data, picture.width, picture.height, t.raster.data, t.raster.width, t.raster.height, usual, t.ground, { scales, either: opts.either });
    scores.push(f.score);
    const passes = logoFound({ width: f.width, score: f.score }, usual.width);
    if (!best || (passes && !bestPasses) || (passes === bestPasses && f.score > best.score)) {
      best = { index, matched: t.file, rect: { x: f.x, y: f.y, width: f.width, height: f.height }, score: f.score, usual, scores };
      bestPasses = passes;
    }
  });
  if (!best) throw new Error("A search needs at least one template.");
  return best;
}
