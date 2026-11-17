// supabase/functions/_shared/design/logoCopies.ts
//
// The making rule (16 Nov 2026, owner decision 1): from a client's stored
// logo file, a recolored copy for the ground the file was not made for, and
// a copy in white. A copy is the stored file with some ink in another color.
// Alpha is never written, so every edge and shape is the stored file's. A
// copy is a file made by code, never the brand's own, and the set uses one
// only when one of the client's own posts shows the logo closer to it than
// to any other file (logoTone.ts, chooseSet).
//
// The only inks a copy takes are the two neutrals the product already has
// (white and #0B0E1A). No color is read from a brand's data or from a post.
//
// Words (logoTone.ts has the numbers): ink is a pixel with alpha of 16 or
// more; a part is ink joined edge to edge within 16 per channel; a small
// part has under 1% of the file's ink, every other part is whole; an exposed
// part touches a pixel without ink or the file's edge; a color shows on
// another at a contrast of 3 or more.
//
// Kept in a file of its own so that a no to decision 1 is the removal of
// this file and its test. Free of Deno and network imports.

import { contrast } from "../lifecycle/designSettings.ts";
import type { Ground, Rgb } from "../picture/contract.ts";
import { DARK, LIGHT, PART_STEP, SHOWS, SMALL_PART, groundRgb, isSmall, otherGround, ownGround, showsOn, type Part, type Parts, type Raster } from "./logoTone.ts";

/**
 * What each part came to: its color, whether it was turned, and the turned
 * ink's share of the file's ink. `mix` names, for a small part that lies
 * between two whole parts with different outcomes, those two parts: its own
 * side first, the other side second. Its pixels are painted one by one
 * (paint), and `colors` holds the mix at the part's own color.
 */
export interface Coloring { colors: Rgb[]; turned: boolean[]; share: number; mix: Array<[number, number] | null> }

/**
 * A pixel as a mix of two colors: the share of `a` at the point of the line
 * from `b` to `a` closest to it, from 0 to 1. Null when the pixel is more
 * than 16 in any channel from that point, or the two colors are one: it is
 * then no blend of the two.
 */
export function mixShare(pixel: Rgb, a: Rgb, b: Rgb): number | null {
  const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const length = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (!length) return null;
  const t = Math.min(1, Math.max(0, ((pixel[0] - b[0]) * d[0] + (pixel[1] - b[1]) * d[1] + (pixel[2] - b[2]) * d[2]) / length));
  for (let k = 0; k < 3; k++) if (Math.abs(pixel[k] - (b[k] + t * d[k])) > PART_STEP) return null;
  return t;
}

const mixed = (share: number, a: Rgb, b: Rgb): Rgb => [Math.round(b[0] + share * (a[0] - b[0])), Math.round(b[1] + share * (a[1] - b[1])), Math.round(b[2] + share * (a[2] - b[2]))];
const sameColor = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The settled part, among those `ok` allows, that `p` shares the most pixel edges with; the lower part number when equal; -1 for none. */
function around(p: Part, ok: (id: number) => boolean): number {
  let best = -1, edges = 0;
  for (const [id, n] of [...p.touches].sort((a, b) => a[0] - b[0])) {
    if (ok(id) && n > edges) { best = id; edges = n; }
  }
  return best;
}

/**
 * The colors of a copy for the ground `to`. I is the flat ink for that
 * ground (white for dark, #0B0E1A for light) and J the other of the two.
 * Mode "shows" turns a part only when its color does not show on the ground
 * (the copy for the other ground); mode "all" turns every part steps 1, 3
 * and 5 reach (the white copy).
 *
 *   1. Each whole exposed part: when its color does not show on the ground
 *      it takes I. It is settled either way.
 *   2. Whole inside parts, from the outside in, until nothing changes: in
 *      part order, one that is not settled and touches a settled whole part.
 *      The part around it is the settled whole part it shares the most edges
 *      with. If that part was turned and the inside part does not show on
 *      its new color, the inside part takes I when I shows on that new
 *      color, else J.
 *   3. A whole part still unsettled is treated as in step 1.
 *   4. Small parts, largest first, until nothing changes: one that touches a
 *      settled part is on the side of the settled part it shares the most
 *      edges with (through other small parts: the whole part at the end),
 *      and takes what that whole part came to: its new color when it was
 *      turned, its own color when it was kept. One exception keeps the
 *      edge between two colors smooth. A small part that also touches the
 *      side of another whole part, where the two came to different outcomes
 *      (one kept and one turned, or two turned to different inks), lies
 *      between them: each of its pixels that is a blend of the two parts'
 *      colors (mixShare) keeps its mix, the share it had of each part's old
 *      color it has of each part's new one. A pixel there that is no blend
 *      of the two takes its side's outcome as above.
 *   5. Small parts still unsettled form groups joined to each other. A
 *      group is judged as one part, by the color of its largest member (the
 *      body of a small letter; the rest is its blended edge): when that
 *      color does not show on the ground, every member takes I.
 */
export function recolor(parts: Parts, to: Ground, mode: "shows" | "all"): Coloring {
  const P = parts.parts;
  const ground = groundRgb(to);
  const I: Rgb = to === "dark" ? LIGHT : DARK, J: Rgb = to === "dark" ? DARK : LIGHT;
  const colors: Rgb[] = P.map((p) => p.color);
  const turned = P.map(() => false), settled = P.map(() => false);
  const small = P.map((p) => isSmall(parts, p));
  const turns = (c: Rgb) => mode === "all" || contrast(c, ground) < SHOWS;
  const turn = (id: number, c: Rgb) => { colors[id] = c; turned[id] = true; };
  // The whole part each part's outcome comes from: itself for a whole part, its side for a small part of step 4.
  const side = P.map((p) => (small[p.id] ? -1 : p.id));
  const mix: Coloring["mix"] = P.map(() => null);

  // 1. Whole exposed parts.
  for (const p of P) {
    if (small[p.id] || !p.exposed) continue;
    settled[p.id] = true;
    if (turns(p.color)) turn(p.id, I);
  }
  // 2. Whole inside parts, from the outside in.
  for (let moved = true; moved;) {
    moved = false;
    for (const p of P) {
      if (settled[p.id] || small[p.id]) continue;
      const a = around(p, (id) => settled[id] && !small[id]);
      if (a < 0) continue;
      settled[p.id] = true;
      moved = true;
      if (turned[a] && contrast(p.color, colors[a]) < SHOWS) turn(p.id, contrast(I, colors[a]) >= SHOWS ? I : J);
    }
  }
  // 3. A whole inside part no whole part reaches.
  for (const p of P) {
    if (small[p.id] || settled[p.id]) continue;
    settled[p.id] = true;
    if (turns(p.color)) turn(p.id, I);
  }
  // 4. Small parts, largest first.
  const smalls = P.filter((p) => small[p.id]).sort((a, b) => b.ink - a.ink || a.id - b.id);
  for (let moved = true; moved;) {
    moved = false;
    for (const p of smalls) {
      if (settled[p.id]) continue;
      const a = around(p, (id) => settled[id]);
      if (a < 0) continue;
      settled[p.id] = true;
      moved = true;
      side[p.id] = side[a];
      if (turned[side[a]]) turn(p.id, colors[side[a]]);
    }
  }
  // A small part between two whole parts with different outcomes: its pixels keep their mix of the two.
  for (const p of smalls) {
    const own = side[p.id];
    if (own < 0) continue;
    const other = around(p, (id) => side[id] >= 0 && side[id] !== own);
    if (other < 0) continue;
    const far = side[other];
    if (turned[own] === turned[far] && (!turned[own] || sameColor(colors[own], colors[far]))) continue;
    mix[p.id] = [own, far];
    const share = mixShare(p.color, P[own].color, P[far].color);
    if (share !== null) { colors[p.id] = mixed(share, colors[own], colors[far]); turned[p.id] = true; }
  }
  // 5. Groups of small parts that touch no settled part.
  for (const p of smalls) {
    if (settled[p.id]) continue;
    const group: number[] = [];
    const open = [p.id];
    settled[p.id] = true;
    while (open.length) {
      const k = open.pop()!;
      group.push(k);
      for (const q of P[k].touches.keys()) if (!settled[q]) { settled[q] = true; open.push(q); }
    }
    let largest = group[0];
    for (const k of group) if (P[k].ink > P[largest].ink || (P[k].ink === P[largest].ink && k < largest)) largest = k;
    if (turns(P[largest].color)) for (const k of group) turn(k, I);
  }

  // The turned ink: a whole part's ink, and of a small part between two outcomes the share that belongs to a turned side.
  let ink = 0;
  for (const p of P) {
    const between = mix[p.id];
    const share = between ? mixShare(p.color, P[between[0]].color, P[between[1]].color) : null;
    if (between && share !== null) ink += p.ink * ((turned[between[0]] ? share : 0) + (turned[between[1]] ? 1 - share : 0));
    else if (turned[p.id]) ink += p.ink;
  }
  return { colors, turned, share: parts.ink ? ink / parts.ink : 0, mix };
}

/**
 * The file with every pixel of a turned part in that part's new color: a
 * new raster. A small part between two outcomes is painted pixel by pixel:
 * a pixel that is a blend of the two parts' old colors gets the same blend
 * of their new ones, and any other pixel its side's outcome. Alpha is never
 * written.
 */
export function paint(file: Raster, parts: Parts, c: Coloring): Raster {
  const data = new Uint8ClampedArray(file.data);
  const P = parts.parts;
  for (let p = 0; p < parts.label.length; p++) {
    const id = parts.label[p];
    if (id < 0) continue;
    const i = p * 4;
    const between = c.mix[id];
    let color: Rgb | null = null;
    if (between) {
      const [own, far] = between;
      const share = mixShare([data[i], data[i + 1], data[i + 2]], P[own].color, P[far].color);
      if (share !== null) color = mixed(share, c.colors[own], c.colors[far]);
      else if (c.turned[own]) color = c.colors[own];
    } else if (c.turned[id]) color = c.colors[id];
    if (!color) continue;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
  return { width: file.width, height: file.height, data };
}

/** The share of the file's ink in whole parts whose color differs by more than 16 in any channel between two colorings. Blended edge pixels (small parts) never decide it. */
export function changedShare(parts: Parts, a: Rgb[], b: Rgb[]): number {
  let ink = 0;
  for (const p of parts.parts) {
    if (isSmall(parts, p)) continue;
    const x = a[p.id], y = b[p.id];
    if (Math.abs(x[0] - y[0]) > PART_STEP || Math.abs(x[1] - y[1]) > PART_STEP || Math.abs(x[2] - y[2]) > PART_STEP) ink += p.ink;
  }
  return parts.ink ? ink / parts.ink : 0;
}

export interface Copy { raster: Raster; turned: number; colors: Rgb[] }
/** A stored file's own ground, whether it also shows on the other one, and its two copies; a copy is null when the rule dropped it. */
export interface Copies { own: Ground; both: boolean; other: Copy | null; white: Copy | null }

/**
 * The two copies of a stored file. The copy for the other ground is dropped
 * when the whole parts that changed color hold under 1% of the ink (it is
 * the stored file again). The white copy is always made from the stored
 * file, and is dropped when that is true against the stored file, or
 * against a kept copy for the other ground.
 */
export function makeCopies(file: Raster, parts: Parts): Copies {
  const own = ownGround(parts);
  const other = recolor(parts, otherGround(own), "shows");
  const white = recolor(parts, "dark", "all");
  const stored = parts.parts.map((p) => p.color);
  const keepOther = changedShare(parts, stored, other.colors) >= SMALL_PART;
  const keepWhite = changedShare(parts, stored, white.colors) >= SMALL_PART && (!keepOther || changedShare(parts, other.colors, white.colors) >= SMALL_PART);
  return {
    own,
    both: showsOn(parts, otherGround(own)),
    other: keepOther ? { raster: paint(file, parts, other), turned: other.share, colors: other.colors } : null,
    white: keepWhite ? { raster: paint(file, parts, white), turned: white.share, colors: white.colors } : null,
  };
}
