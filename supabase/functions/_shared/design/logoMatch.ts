// supabase/functions/_shared/design/logoMatch.ts
//
// Where the image model drew the client's logo. The model designs the whole
// post on a canvas that already carries the logo file, but it does not keep
// the logo exactly where the canvas had it (it drifted by up to 20 px in two
// of four Moburst designs on 13 Oct). The file is placed over the model's own
// logo, so this finds that logo: the position and size where the file's
// picture best matches the design (normalized cross-correlation of
// luminance), searched coarse to fine near the canvas spot.
//
// Free of Deno and network imports so it can be tested.

export interface Rect { x: number; y: number; width: number; height: number }

/** Luminance (0..255) of RGBA pixels laid over a flat background colour. */
export function luminance(rgba: ArrayLike<number>, w: number, h: number, bg: [number, number, number] = [0, 0, 0]): Float32Array {
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const a = rgba[i + 3] / 255;
    const r = rgba[i] * a + bg[0] * (1 - a), g = rgba[i + 1] * a + bg[1] * (1 - a), b = rgba[i + 2] * a + bg[2] * (1 - a);
    out[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

/** Area-average a single-channel image down to dw x dh. */
export function shrink(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let s = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < sh; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < sw; sx++) {
          const w = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * wy;
          s += src[sy * sw + sx] * w; area += w;
        }
      }
      out[y * dw + x] = area > 0 ? s / area : 0;
    }
  }
  return out;
}

/** Normalized cross-correlation of template t (tw x th) with image img (iw wide) at (x, y). */
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

interface Candidate { x: number; y: number; width: number; height: number; score: number }

function bestAt(img: Float32Array, iw: number, ih: number, logo: Float32Array, lw: number, lh: number,
  widths: number[], cx: [number, number], cy: [number, number]): Candidate {
  let best: Candidate = { x: 0, y: 0, width: 0, height: 0, score: -2 };
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
    // sum((I - mI)(T - mT)) = sum(I * (T - mT)), so the zero-mean template is enough.
    for (let y = Math.max(0, cy[0]); y <= Math.min(ih - th, cy[1]); y++) {
      for (let x = Math.max(0, cx[0]); x <= Math.min(iw - tw, cx[1]); x++) {
        const s = ncc(img, iw, t0, tw, th, 0, norm, x, y);
        if (s > best.score) best = { x, y, width: tw, height: th, score: s };
      }
    }
  }
  return best;
}

/**
 * The rectangle where the logo file best matches the design, near `expected`
 * (the spot the canvas gave it). `image` and `logo` are RGBA; the logo is
 * judged over `background` (the canvas colour the model was given). Returns
 * the rectangle in the design's pixels and the match score (1 is identical).
 */
export function findLogo(image: ArrayLike<number>, iw: number, ih: number, logo: ArrayLike<number>, lw: number, lh: number,
  expected: Rect, background: [number, number, number], opts: { reach?: number; scales?: [number, number] } = {}): Candidate {
  const reach = opts.reach ?? 0.15;
  const [sMin, sMax] = opts.scales ?? [0.75, 1.3];
  const img = luminance(image, iw, ih);
  const tpl = luminance(logo, lw, lh, background);

  // Coarse: the logo about 80 px wide.
  const f = Math.max(1, Math.floor(expected.width / 80));
  const cw = Math.floor(iw / f), ch = Math.floor(ih / f);
  const coarse = shrink(img, iw, ih, cw, ch);
  const ew = expected.width / f;
  const widths: number[] = [];
  for (let s = sMin; s <= sMax + 1e-9; s += 0.04) widths.push(Math.round(ew * s));
  const rx = Math.round((reach * iw) / f), ry = Math.round((reach * ih) / f);
  const ex = Math.round(expected.x / f), ey = Math.round(expected.y / f);
  let c = bestAt(coarse, cw, ch, tpl, lw, lh, widths, [ex - rx, ex + rx], [ey - ry, ey + ry]);

  // Finer levels, halving each time, each searching a few pixels around the last.
  let level = f;
  let rect = { x: c.x * level, y: c.y * level, width: c.width * level, height: c.height * level };
  while (level > 1) {
    level = Math.max(1, Math.floor(level / 2));
    const lw2 = Math.floor(iw / level), lh2 = Math.floor(ih / level);
    const im = level === 1 ? img : shrink(img, iw, ih, lw2, lh2);
    const w0 = rect.width / level;
    const ws = [-0.03, -0.015, 0, 0.015, 0.03].map((d) => Math.round(w0 * (1 + d)));
    const x0 = Math.round(rect.x / level), y0 = Math.round(rect.y / level), r = 3;
    c = bestAt(im, lw2, lh2, tpl, lw, lh, [...new Set(ws)], [x0 - r, x0 + r], [y0 - r, y0 + r]);
    rect = { x: c.x * level, y: c.y * level, width: c.width * level, height: c.height * level };
  }
  return { ...rect, score: c.score };
}
