// supabase/functions/_shared/design/logoTone.ts
//
// The logo in the tone its picture needs (16 Nov 2026). A client's logo is a
// set of up to three files: the stored file, a second file for the ground the
// stored file was not made for, and the logo in white. This file holds
// everything that decides about that set: how a logo file is read (its parts,
// the figure it has on a light and on a dark ground), whether two files are
// the same logo, how far a picture's pixels are from a file's, the ground
// around a found logo, the search over one or two templates, which files a
// client's set holds from what its own posts show, which file the canvas
// carries and on what color, and what a design job reads from the set.
//
// Nothing here passes or fails a design: the one test stays logoFound
// (logoMatch.ts). The numbers below make and compare files. The making rule
// itself (the recolored copies) is in logoCopies.ts.
//
// Since 17 Nov 2026 (rule 2, spec section 11) a file is always laid on a
// ground it was made for. A ground is held to the file's weakest whole part
// and never to the average of its ink: the settings background, the canvas
// ground and so the first template. A found post counts for a file's ground
// when that file's own search found the logo there, whatever a contrast bar
// says. Every ground a file of the set serves has a template, and a file is
// stamped only on a ground it serves.
//
// Free of Deno and network imports: the picture service, the lifecycle step,
// the design worker and the tests all import it.

import { canvasLogoRect, resampleRGBA } from "../canva/brief.ts";
import { contrast, LOGO_TONE_RULE, NEUTRAL_DARK, NEUTRAL_LIGHT, weakestContrast } from "../lifecycle/designSettings.ts";
import type { Ground, Ink, LogoFileName, LogoSetResult, Placement, PostLogo, Rect, Rgb } from "../picture/contract.ts";
import { findLogo, logoFound } from "./logoMatch.ts";

/** RGBA, straight alpha, row by row, 4 bytes a pixel. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

/** The version of the rule a stored set was made with; a set of another version is not read. */
export const TONE_RULE = LOGO_TONE_RULE;

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The light and the dark ground, and the two flat inks a made copy may take: the product's own neutrals. */
export const LIGHT: Rgb = hexRgb(NEUTRAL_LIGHT);
export const DARK: Rgb = hexRgb(NEUTRAL_DARK);

/** A pixel with this alpha or more is ink. */
export const INK_ALPHA = 16;
/** A pixel with this alpha or more is solid ink: the pixels two files, or a file and a picture, are compared over. */
export const SOLID_ALPHA = 128;
/** Two pixels that share an edge are one part when no channel differs by more than this. */
export const PART_STEP = 16;
/** A part with less than this share of the file's ink is a small part. */
export const SMALL_PART = 0.01;
/** The share of a file's exposed ink that reaches its figure on a ground. */
export const FIGURE_SHARE = 0.9;
/** A color shows on another at this contrast or more. */
export const SHOWS = 3;

export const groundRgb = (g: Ground): Rgb => (g === "light" ? LIGHT : DARK);
export const otherGround = (g: Ground): Ground => (g === "light" ? "dark" : "light");
/** The ground a color sits on: the neutral it has the lower contrast with, light when equal. */
export const sideOf = (color: Rgb): Ground => (contrast(color, LIGHT) <= contrast(color, DARK) ? "light" : "dark");

/**
 * One part of a logo file: ink pixels joined edge to edge, each within
 * PART_STEP per channel of the pixel it was reached from. `ink` is the sum of
 * its pixels' alpha over 255, `color` their average weighted by alpha,
 * `exposed` whether one of its pixels is beside a pixel without ink or on the
 * file's edge, and `touches` the pixel edges it shares with each other part.
 */
export interface Part { id: number; ink: number; color: Rgb; exposed: boolean; touches: Map<number, number> }
/** A file's parts, numbered in the order their first pixel is met row by row; `label` gives each pixel's part, or -1. */
export interface Parts { label: Int32Array; parts: Part[]; ink: number }

export function partsOf(file: Raster): Parts {
  const { width: w, height: h, data: d } = file;
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const parts: Part[] = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || d[start * 4 + 3] < INK_ALPHA) continue;
    const id = parts.length;
    let top = 0, r = 0, g = 0, b = 0, ink = 0;
    stack[top++] = start;
    label[start] = id;
    while (top) {
      const p = stack[--top], i = p * 4, a = d[i + 3] / 255;
      r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; ink += a;
      const x = p % w, y = (p - x) / w;
      for (let side = 0; side < 4; side++) {
        const q = side === 0 ? (x > 0 ? p - 1 : -1) : side === 1 ? (x < w - 1 ? p + 1 : -1) : side === 2 ? (y > 0 ? p - w : -1) : (y < h - 1 ? p + w : -1);
        if (q < 0 || label[q] !== -1) continue;
        const j = q * 4;
        if (d[j + 3] < INK_ALPHA) continue;
        if (Math.abs(d[j] - d[i]) > PART_STEP || Math.abs(d[j + 1] - d[i + 1]) > PART_STEP || Math.abs(d[j + 2] - d[i + 2]) > PART_STEP) continue;
        label[q] = id;
        stack[top++] = q;
      }
    }
    parts.push({ id, ink, color: [Math.round(r / ink), Math.round(g / ink), Math.round(b / ink)], exposed: false, touches: new Map() });
  }
  for (let p = 0; p < n; p++) {
    const id = label[p];
    if (id < 0) continue;
    const x = p % w, y = (p - x) / w;
    for (let side = 0; side < 4; side++) {
      const q = side === 0 ? (x > 0 ? p - 1 : -1) : side === 1 ? (x < w - 1 ? p + 1 : -1) : side === 2 ? (y > 0 ? p - w : -1) : (y < h - 1 ? p + w : -1);
      if (q < 0 || label[q] < 0) { parts[id].exposed = true; continue; }
      const other = label[q];
      if (other !== id) parts[id].touches.set(other, (parts[id].touches.get(other) ?? 0) + 1);
    }
  }
  let ink = 0;
  for (const p of parts) ink += p.ink;
  return { label, parts, ink };
}

/** A part with under 1% of the file's ink: the blended pixels where two colors meet, or a letter of a small tagline. */
export const isSmall = (parts: Parts, p: Part): boolean => p.ink < SMALL_PART * parts.ink;

/**
 * A file's figure on a ground: its exposed parts sorted by their contrast
 * with the ground, lowest first, and the contrast of the part at which more
 * than 10% of the exposed ink has been passed. So 90% of the exposed ink
 * reaches the figure. 0 for a file with no exposed part.
 */
export function figure(parts: Parts, ground: Rgb): number {
  const exposed = parts.parts.filter((p) => p.exposed).map((p) => ({ c: contrast(p.color, ground), ink: p.ink, id: p.id })).sort((a, b) => a.c - b.c || a.id - b.id);
  let total = 0;
  for (const p of exposed) total += p.ink;
  let passed = 0;
  for (const p of exposed) {
    passed += p.ink;
    if (passed > total * (1 - FIGURE_SHARE)) return p.c;
  }
  return exposed.length ? exposed[exposed.length - 1].c : 0;
}

/**
 * The ground a file was made for. When every whole exposed part of it has
 * 3:1 or more on one of the two neutrals and not on the other, that one:
 * the figure lets a tenth of the ink fall short, so by the figure alone a
 * mid-tone logo with a small near-black part would count as made for dark
 * pictures, where that part does not show (17 Nov 2026). When the file shows
 * whole on both or on neither, the one with the higher figure, light when
 * they are equal.
 */
export function ownGround(parts: Parts): Ground {
  const inks = wholeExposedInks(parts).map((ink) => ink.color);
  if (inks.length) {
    const light = showsWhole(inks, LIGHT), dark = showsWhole(inks, DARK);
    if (light !== dark) return light ? "light" : "dark";
  }
  return figure(parts, LIGHT) >= figure(parts, DARK) ? "light" : "dark";
}

/**
 * Whether a file shows on a ground: its figure there is 3 or more, and every
 * whole exposed part of it has 3:1 there. A file that shows on the ground it
 * was not made for serves both grounds, so a template lays it on that
 * neutral too; no whole part of it may fall short there.
 */
export function showsOn(parts: Parts, ground: Ground): boolean {
  const g = groundRgb(ground);
  return figure(parts, g) >= SHOWS && showsWhole(wholeExposedInks(parts).map((ink) => ink.color), g);
}

/** The whole exposed parts of a file, in part order, each with its color and its share of the file's ink. `colors` stands in for the parts' own colors (a recolored copy of the file). */
export function wholeExposedInks(parts: Parts, colors?: Rgb[]): Ink[] {
  const inks: Ink[] = [];
  for (const p of parts.parts) {
    if (!p.exposed || isSmall(parts, p)) continue;
    const c = colors?.[p.id] ?? p.color;
    inks.push({ color: [c[0], c[1], c[2]], share: parts.ink ? p.ink / parts.ink : 0 });
  }
  return inks;
}

/**
 * Whether a file shows whole on a color: every one of its whole exposed
 * parts (`inks`, their colors) has 3:1 or more there. The figure above lets
 * a tenth of the ink fall short, so a letter of three with under a tenth of
 * the ink would be allowed to vanish: a ground a file is laid on is held to
 * every whole part instead. A file with no whole part has nothing to test.
 */
export function showsWhole(inks: Rgb[], ground: Rgb): boolean {
  return weakestContrast(inks, ground) >= SHOWS;
}

/**
 * Whether a whole part of a file has the ground's own color: within PART_STEP
 * per channel of it, the product's own step between two pixels of one part.
 * Such a part is not a part of its own on that ground, whatever the brand's
 * posts show there. Weaker than 3:1 is not this: a part at 2.4:1 shows.
 */
export function vanishesOn(inks: Rgb[], ground: Rgb): boolean {
  return inks.some((c) => Math.abs(c[0] - ground[0]) <= PART_STEP && Math.abs(c[1] - ground[1]) <= PART_STEP && Math.abs(c[2] - ground[2]) <= PART_STEP);
}

/**
 * What a ground is chosen against for a logo file: the colors of its whole
 * exposed parts, each once, in part order, and the ground it was made for.
 * The lifecycle reads this from the file it stores, to choose the settings
 * background (designSettings.ts, pickBackground).
 */
export function wholeInks(file: Raster): { inks: Rgb[]; own: Ground } {
  const parts = partsOf(file);
  return { inks: distinctInks(wholeExposedInks(parts)), own: ownGround(parts) };
}

function distinctInks(inks: Ink[]): Rgb[] {
  const seen = new Set<string>();
  const out: Rgb[] = [];
  for (const { color } of inks) {
    const key = color.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([color[0], color[1], color[2]]);
  }
  return out;
}

/**
 * Where the stored file rests when no post of the client's says: on the
 * settings background when the file shows whole on it, otherwise on the
 * neutral of its own ground ("pole"). Read when the set is settled and again
 * when a design starts, so a design never starts from a file on a ground
 * where one of its whole parts does not show.
 */
export function restGround(inks: Rgb[], background: string, own: Ground): { ground: string; from: "settings" | "pole" } {
  const hex = String(background ?? "").trim();
  if (HEX.test(hex) && showsWhole(inks, hexRgb(hex))) return { ground: hex.toUpperCase(), from: "settings" };
  return { ground: own === "light" ? NEUTRAL_LIGHT : NEUTRAL_DARK, from: "pole" };
}

// ── Two files of one logo ───────────────────────────────────────────────────

/** Two files are compared at this width. */
const SAME_WIDTH = 256;
/** The shared ink over the ink in either, at or above which two files are the same logo. */
export const SAME_OVERLAP = 0.9;
/** The smaller width-to-height ratio over the larger, at or above which two files have the same shape. */
export const SAME_SHAPE = 0.95;

/**
 * Whether `file` is the stored logo for the ground the stored file was not
 * made for (a brand's own second file, from its website). Both files are
 * already trimmed to their ink. All four must hold:
 *   1. the shapes agree: the smaller width-to-height ratio is at least 0.95
 *      of the larger;
 *   2. brought to the same box (256 wide, the stored file's height at that
 *      width), the shared solid ink over the solid ink in either is at
 *      least 0.9;
 *   3. the file's own ground is the other ground of the stored file's;
 *   4. the file is at least as wide as the stored file, so it is never
 *      stamped more enlarged than the stored file would be.
 * `overlap` is the number of test 2. This compares two known files and
 * gates no design.
 */
export function sameLogo(stored: Raster, storedParts: Parts, file: Raster): { same: boolean; overlap: number } {
  const a = stored.width / stored.height, b = file.width / file.height;
  const shape = Math.min(a, b) / Math.max(a, b) >= SAME_SHAPE;
  const w = SAME_WIDTH, h = Math.max(1, Math.round((stored.height * SAME_WIDTH) / stored.width));
  const x = resampleRGBA(stored.data, stored.width, stored.height, w, h), y = resampleRGBA(file.data, file.width, file.height, w, h);
  let shared = 0, either = 0;
  for (let i = 3; i < x.length; i += 4) {
    const p = x[i] >= SOLID_ALPHA, q = y[i] >= SOLID_ALPHA;
    if (p || q) either++;
    if (p && q) shared++;
  }
  const overlap = either ? shared / either : 0;
  const ground = ownGround(partsOf(file)) === otherGround(ownGround(storedParts));
  return { same: shape && overlap >= SAME_OVERLAP && ground && file.width >= stored.width, overlap };
}

// ── A file against a picture ────────────────────────────────────────────────

/**
 * How far a picture's pixels are from a file's at a rectangle: the file is
 * brought to the rectangle's size, and over its solid ink (alpha of 128 or
 * more) that falls inside the picture, the average distance between the two
 * pixels, each distance the square root of the summed squares of the red,
 * green and blue differences. Infinity when no such pixel exists.
 */
export function colorGap(picture: Raster, file: Raster, rect: Rect): number {
  if (rect.width < 1 || rect.height < 1) return Infinity;
  const f = resampleRGBA(file.data, file.width, file.height, rect.width, rect.height);
  let sum = 0, n = 0;
  for (let y = 0; y < rect.height; y++) {
    const ty = rect.y + y;
    if (ty < 0 || ty >= picture.height) continue;
    for (let x = 0; x < rect.width; x++) {
      const tx = rect.x + x;
      if (tx < 0 || tx >= picture.width) continue;
      const j = (y * rect.width + x) * 4;
      if (f[j + 3] < SOLID_ALPHA) continue;
      const i = (ty * picture.width + tx) * 4;
      sum += Math.hypot(picture.data[i] - f[j], picture.data[i + 1] - f[j + 1], picture.data[i + 2] - f[j + 2]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

/**
 * The ground around a found logo. The rectangle is widened by a quarter of
 * its width on each side and half its height above and below; from the
 * widened rectangle's top left corner every second pixel on every second row
 * is taken, inside the picture and outside the rectangle itself. Sorted by
 * brightness (equal ones by position), the one in the middle is the ground:
 * a real pixel of the picture. `flat` is the share of the sampled pixels
 * within 16 per channel of it. Null when nothing was sampled.
 */
export function groundAround(picture: Raster, rect: Rect): { ground: Rgb; flat: number } | null {
  const mx = Math.round(rect.width * 0.25), my = Math.round(rect.height * 0.5);
  const x0 = rect.x - mx, y0 = rect.y - my, x1 = rect.x + rect.width + mx, y1 = rect.y + rect.height + my;
  const d = picture.data;
  const sampled: Array<[number, number]> = [];
  for (let y = y0; y < y1; y += 2) {
    if (y < 0 || y >= picture.height) continue;
    for (let x = x0; x < x1; x += 2) {
      if (x < 0 || x >= picture.width) continue;
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) continue;
      const p = (y * picture.width + x) * 4;
      sampled.push([0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2], p]);
    }
  }
  if (!sampled.length) return null;
  sampled.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const m = sampled[sampled.length >> 1][1];
  const ground: Rgb = [d[m], d[m + 1], d[m + 2]];
  let near = 0;
  for (const [, p] of sampled) {
    if (Math.abs(d[p] - ground[0]) <= PART_STEP && Math.abs(d[p + 1] - ground[1]) <= PART_STEP && Math.abs(d[p + 2] - ground[2]) <= PART_STEP) near++;
  }
  return { ground, flat: near / sampled.length };
}

// ── The search ──────────────────────────────────────────────────────────────

/**
 * One file to look for, decoded: its name in the set, its pixels, the color
 * it is laid over, whether it is a person's file, and the other files that
 * may be named when this template is the match (the files that serve the
 * ground it covers). With no list every file may be named, as a job from
 * before the list existed expects.
 */
export interface TemplateIn { file: LogoFileName; raster: Raster; ground: Rgb; fixed?: boolean; names?: LogoFileName[] }
/** One more file to compare by color, decoded. */
export interface CompareIn { file: LogoFileName; raster: Raster }
/** The better match: which template, its file, where, its score, that file's usual rectangle, and each template's score in the order sent. */
export interface Found { index: number; matched: LogoFileName; rect: Rect; score: number; usual: Rect; scores: number[] }

/**
 * Each template is searched for near its file's usual rectangle with the
 * product's own search (findLogo, logoMatch.ts), laid over its ground. Of
 * the matches that are the logo by the one test (logoFound: the score and a
 * size the client uses), the better score wins, the first template's when
 * equal. When none is, the better score of all is answered, so the caller's
 * test fails it as before. A second template can therefore never turn a
 * design that passes with the first into one that is made again. Whether
 * the answered match is the logo stays the one test, made by the caller.
 */
export function searchTemplates(picture: Raster, templates: TemplateIn[], placement: Placement, scales: [number, number]): Found {
  let best: Found | null = null;
  let bestPasses = false;
  const scores: number[] = [];
  templates.forEach((t, index) => {
    const usual = canvasLogoRect(placement, t.raster.width, t.raster.height, picture.width, picture.height);
    const f = findLogo(picture.data, picture.width, picture.height, t.raster.data, t.raster.width, t.raster.height, usual, t.ground, { scales });
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

/**
 * The file closest in color to what the picture shows at the found
 * rectangle. When the matched template is a person's file, that file is
 * named and nothing is measured. Otherwise the candidates are the matched
 * template's file, the other template's file unless it is a person's, and
 * the compare files, each name once. The smallest distance wins; equal ones
 * go to the file named earliest in `order`. A file with no solid ink on the
 * picture is left out of `gaps` and cannot win.
 *
 * When the matched template lists the files that may be named with it
 * (`names`), only the matched file and those can win: a file is stamped
 * only on a ground it serves, whatever a color distance says. Every
 * candidate's distance is still measured and answered, for review.
 */
export function nameFile(picture: Raster, found: Found, templates: TemplateIn[], compare: CompareIn[], order: LogoFileName[]): { file: LogoFileName; gaps: Partial<Record<LogoFileName, number>> } {
  const matched = templates[found.index];
  if (matched.fixed) return { file: matched.file, gaps: {} };
  const candidates = new Map<LogoFileName, Raster>([[matched.file, matched.raster]]);
  for (const t of templates) if (!t.fixed && !candidates.has(t.file)) candidates.set(t.file, t.raster);
  for (const c of compare) if (!candidates.has(c.file)) candidates.set(c.file, c.raster);
  const gaps: Partial<Record<LogoFileName, number>> = {};
  for (const [file, raster] of candidates) {
    const gap = colorGap(picture, raster, found.rect);
    if (Number.isFinite(gap)) gaps[file] = gap;
  }
  const rank = (f: LogoFileName) => { const at = order.indexOf(f); return at < 0 ? order.length : at; };
  const may = (f: LogoFileName) => f === matched.file || !matched.names || matched.names.includes(f);
  let file = matched.file, least = Infinity;
  for (const f of [...candidates.keys()].filter(may).sort((a, b) => rank(a) - rank(b))) {
    const gap = gaps[f];
    if (gap !== undefined && gap < least) { file = f; least = gap; }
  }
  return { file, gaps };
}

/**
 * Where a named file of another shape than the matched file is stamped: the
 * same width and center, its height from its own proportions. Null when the
 * two files have the same width and height (every made copy has the stored
 * file's), so the found rectangle is used as it is.
 */
export function stampRect(rect: Rect, matched: Raster, named: Raster): Rect | null {
  if (matched.width === named.width && matched.height === named.height) return null;
  const height = Math.round((rect.width * named.height) / named.width);
  return { x: rect.x, y: Math.round(rect.y + rect.height / 2 - height / 2), width: rect.width, height };
}

// ── The choice ──────────────────────────────────────────────────────────────

const FILE_ORDER: LogoFileName[] = ["stored", "other", "white"];

function hexOf(c: Rgb): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * Where a set's other files are stored: `other` and `white` are the made
 * copies (null when the rule dropped them), `site` the website file that
 * passed the same-logo test, `person` a person's second file in use.
 */
export interface SetPaths { other: string | null; white: string | null; site: string | null; person: string | null }

/** The searches one of the client's posts gets, and the files compared by color with a found logo, by storage path. */
export interface SearchPlan {
  searches: Array<{ file: LogoFileName; path: string; ground: Rgb; fixed?: true }>;
  compare: Array<{ file: LogoFileName; path: string }>;
}

/**
 * How a client's posts are searched. The stored file is searched over its
 * own ground. Over the other ground, the first of: a person's file (never
 * compared by color), the website file that passed, the made copy for that
 * ground, the stored file when it shows there too. With none of those there
 * is one search. The made white copy is compared by color.
 */
export function postSearchPlan(of: string, facts: LogoSetResult, paths: SetPaths): SearchPlan {
  const other = groundRgb(otherGround(facts.own));
  const searches: SearchPlan["searches"] = [{ file: "stored", path: of, ground: groundRgb(facts.own) }];
  if (paths.person) searches.push({ file: "other", path: paths.person, ground: other, fixed: true });
  else if (paths.site) searches.push({ file: "other", path: paths.site, ground: other });
  else if (paths.other) searches.push({ file: "other", path: paths.other, ground: other });
  else if (facts.both) searches.push({ file: "stored", path: of, ground: other });
  return { searches, compare: paths.white ? [{ file: "white", path: paths.white }] : [] };
}

/**
 * A client's logo set, as design_brand_settings.logo_set holds it. `of` is
 * the logo_path it belongs to; `other` serves the ground the stored file was
 * not made for; `made` and `site` record what exists, used or not; `inks`
 * are the colors of the stored file's whole exposed parts, which a design's
 * start tests the row's background against; `posts` says what the client's
 * own posts showed; `canvas` is what a design starts from. The `person` key
 * is kept by the database (set_design_logo_other) and is never written from
 * here.
 */
export interface LogoSet {
  of: string; rule: number; own: Ground; both: boolean;
  inks: Rgb[];
  other: { path: string; from: "made" | "site" | "person"; size: [number, number] } | null;
  white: { path: string } | null;
  made: { other: string | null; white: string | null };
  site: string | null;
  person?: { path: string; of: string; at: string };
  posts: { read: number; found: number; shown: { stored: number; other: number; white: number } };
  canvas: { file: LogoFileName; ground: string; from: "client_posts" | "settings" | "pole" };
  at: string;
}

/**
 * The set, from what the service answered about the files (`facts`), where
 * the files are (`paths`) and what each of the client's posts gave, in the
 * order of the row's reference posts (null for a post that could not be
 * read).
 *
 * The files. The second file is a person's file, else the website file that
 * passed, else the made copy for the other ground when at least one post
 * shows it. The white file is the made white copy when at least one post
 * shows it. A brand's own file needs no post to show it; a made copy is
 * never used without one.
 *
 * The canvas of a row the lifecycle wrote. The file of the set that the most
 * found posts show; equal counts go to the stored file, then the second,
 * then the white; with no found post, the stored file.
 *
 * Its ground. A found post counts for the canvas file's ground when that
 * file's own search is the one that found the logo there (the white file
 * has no search of its own and counts when it is the closest in color). A
 * post where another file's search found the logo, and this file was only
 * the closest in color, shows the brand's logo in a color the app has no
 * file for and says nothing about where this file sits. Of the grounds that
 * count, those on which the file shows whole come first; when the client's
 * posts show the file only on grounds under 3:1, those are used, because a
 * contrast bar does not overrule the brand's own posts, unless a whole part
 * has the ground's own color there (vanishesOn): that ground never counts.
 * Among them the
 * ground closest to the others (the smallest sum of distances), then the
 * flatter one, then the earlier post. A ground on which a whole part has
 * the ground's own color (vanishesOn) never counts, whatever a post shows.
 * With no ground that counts: where the
 * stored file rests (restGround: the row's background when the file shows
 * whole on it, else the neutral of its own ground), and for another file
 * the neutral of the ground it serves. This sets a starting color for the
 * image model and passes or fails nothing.
 *
 * The canvas of a row a person set: their file, where it rests (their
 * background whenever their file shows whole on it). Nothing of theirs is
 * written.
 */
export function chooseSet(input: {
  of: string; source: "lifecycle" | "person"; background: string;
  facts: LogoSetResult; paths: SetPaths; posts: Array<PostLogo | null>; at: string;
}): LogoSet {
  const { of, facts, paths } = input;
  const found = input.posts.filter((p): p is Extract<PostLogo, { found: true }> => !!p && p.found);
  const shown = { stored: 0, other: 0, white: 0 };
  for (const p of found) shown[p.shows]++;

  let other: LogoSet["other"] = null;
  if (paths.person && facts.person) other = { path: paths.person, from: "person", size: [facts.person.size.width, facts.person.size.height] };
  else if (paths.site && facts.site) other = { path: paths.site, from: "site", size: [facts.site.size.width, facts.site.size.height] };
  else if (paths.other && facts.made.other && shown.other > 0) other = { path: paths.other, from: "made", size: [facts.size.width, facts.size.height] };
  const white: LogoSet["white"] = paths.white && facts.made.white && shown.white > 0 ? { path: paths.white } : null;

  const storedInks = distinctInks(facts.inks.stored ?? []);
  const rest = restGround(storedInks, input.background, facts.own);
  let canvas: LogoSet["canvas"] = { file: "stored", ...rest };
  if (input.source !== "person") {
    const has: Record<LogoFileName, boolean> = { stored: true, other: !!other, white: !!white };
    let file: LogoFileName = "stored";
    for (const f of FILE_ORDER) if (has[f] && shown[f] > shown[file]) file = f;
    const inks = (facts.inks[file] ?? []).map((ink) => ink.color);
    const counts = found.map((p, at) => ({ p, at })).filter(({ p }) => p.shows === file && (file === "white" || p.matched === file));
    // Three tiers, the first with a post wins: grounds the file shows whole on, grounds where no whole part has the ground's own color, none.
    const whole = counts.filter(({ p }) => showsWhole(inks, p.ground));
    const grounds = whole.length ? whole : counts.filter(({ p }) => !vanishesOn(inks, p.ground));
    const ranked = grounds
      .map((g) => ({ ...g, sum: grounds.reduce((s, o) => s + Math.hypot(g.p.ground[0] - o.p.ground[0], g.p.ground[1] - o.p.ground[1], g.p.ground[2] - o.p.ground[2]), 0) }))
      .sort((a, b) => a.sum - b.sum || b.p.flat - a.p.flat || a.at - b.at);
    if (ranked.length) canvas = { file, ground: hexOf(ranked[0].p.ground), from: "client_posts" };
    else if (file === "stored") canvas = { file, ...rest };
    else canvas = { file, ground: hexOf(file === "white" || facts.own === "light" ? DARK : LIGHT), from: "pole" };
  }

  return {
    of, rule: TONE_RULE, own: facts.own, both: facts.both, inks: storedInks, other, white,
    made: { other: facts.made.other ? paths.other : null, white: facts.made.white ? paths.white : null },
    site: facts.site ? paths.site : null,
    posts: { read: input.posts.filter((p) => p !== null).length, found: found.length, shown },
    canvas, at: input.at,
  };
}

/**
 * What a still design job carries from its client's set (input.logos): the
 * files by storage path, which one is on the canvas, the template for the
 * ground the canvas file does not cover, which file is a person's, and for
 * each template the other files that may be stamped when it is the match
 * (the files that serve the ground it covers). A job from before 17 Nov
 * 2026 has no `names` and is answered as it was.
 */
export interface JobLogos {
  files: { stored: string; other?: string; white?: string };
  canvas: LogoFileName;
  second: { file: LogoFileName; ground: typeof NEUTRAL_LIGHT | typeof NEUTRAL_DARK } | null;
  fixed: LogoFileName[];
  names?: { canvas: LogoFileName[]; second: LogoFileName[] };
}

/**
 * What a design job reads from a settings row's set: the canvas file's path,
 * the canvas ground, and the job's logos. Null when the row has no current
 * set, and the job then runs with logo_path and background exactly as
 * before: the set must belong to the row's logo_path and to this version of
 * the rule, name a canvas file it holds and a six digit ground, and, when
 * its second file is a person's, the row's person key must still name that
 * file for that logo (a removed file stays in the set until it is settled
 * again).
 *
 * A row a person set always starts from their own file, whatever their
 * posts show; its set only adds the files a design may be recognized and
 * stamped with.
 *
 * The ground. A ground the client's posts gave is the set's own. Wherever
 * the stored file is the canvas file with no such ground (a person's row, a
 * ground from the settings, or the file resting on its neutral), the ground
 * is read here, from the row's background as it is now and the file's inks
 * in the set (restGround): the background when the file shows whole on it,
 * else the neutral of its own ground. So the canvas, and with it the first
 * template, never carries the stored file on a ground where one of its
 * whole parts does not show, whatever the row's background is at this
 * moment.
 *
 * `second` is the template for the ground the canvas file does not cover.
 * The canvas file covers the dark ground when it is the white file and the
 * other ground when it is the second file. The stored file covers its own
 * ground, with one exception: a stored file that shows on both grounds has
 * no one ground it covers, so it covers the ground its canvas color sits on
 * (sideOf). Its second template is then never the first one again: the
 * neutral it is laid over is the one its canvas color does not sit on. The
 * file for the ground still needed is the stored file when that is its own
 * ground, else the second file, else the stored file when it shows on both
 * grounds, else the white file when that ground is the dark one, else none.
 * So every ground a file of the set serves has a template.
 *
 * `names` lists, for each template, the other files that serve the ground
 * it covers and are no person's: the stored file its own ground (both when
 * it shows on both), the second file the other ground, the white file the
 * dark ground. Locate names only the matched file or one of these.
 */
export function jobLogos(row: { logo_path: string; background: string; source?: string | null; logo_set?: unknown }): { logo_path: string; background: string; logos: JobLogos } | null {
  const set = row.logo_set as Partial<LogoSet> | null | undefined;
  if (!set || typeof set !== "object" || set.of !== row.logo_path || set.rule !== TONE_RULE) return null;
  if (set.own !== "light" && set.own !== "dark") return null;
  if (!Array.isArray(set.inks)) return null;
  const own: Ground = set.own;
  const other = set.other && typeof set.other.path === "string" && set.other.path ? set.other : null;
  const white = set.white && typeof set.white.path === "string" && set.white.path ? set.white : null;
  if (other?.from === "person" && !(set.person && set.person.path === other.path && set.person.of === row.logo_path)) return null;
  const files: JobLogos["files"] = { stored: row.logo_path, ...(other ? { other: other.path } : {}), ...(white ? { white: white.path } : {}) };
  const stored = set.canvas;
  if (!stored || !FILE_ORDER.includes(stored.file) || !files[stored.file] || typeof stored.ground !== "string" || !HEX.test(stored.ground)) return null;
  // Where the stored file rests is read from the row, never from the copy of it in the set, so a background changed
  // since the set was settled is used at once: always for a row a person set (their own file), and for the stored
  // file whenever the client's posts gave it no ground.
  const rests = row.source === "person" || (stored.file === "stored" && stored.from !== "client_posts");
  const canvas = rests ? { file: "stored" as LogoFileName, ground: restGround(set.inks as Rgb[], row.background, own).ground } : stored;

  const both = set.both === true;
  const fixed: LogoFileName[] = other?.from === "person" ? ["other"] : [];
  const covered: Ground = canvas.file === "white" ? "dark" : canvas.file === "other" ? otherGround(own) : both ? sideOf(hexRgb(canvas.ground)) : own;
  const needed = otherGround(covered);
  const file: LogoFileName | null = needed === own ? "stored" : other ? "other" : both ? "stored" : needed === "dark" && white ? "white" : null;
  // The files that may be stamped with a template: the ones that serve the ground it covers.
  const serves = (f: LogoFileName, ground: Ground) => (f === "stored" ? ground === own || both : f === "other" ? ground === otherGround(own) : ground === "dark");
  const namesFor = (template: LogoFileName, ground: Ground) => FILE_ORDER.filter((f) => f !== template && !!files[f] && !fixed.includes(f) && serves(f, ground));
  return {
    logo_path: files[canvas.file]!,
    background: canvas.ground.toUpperCase(),
    logos: {
      files,
      canvas: canvas.file,
      second: file ? { file, ground: needed === "light" ? NEUTRAL_LIGHT : NEUTRAL_DARK } : null,
      fixed,
      names: { canvas: namesFor(canvas.file, covered), second: file ? namesFor(file, needed) : [] },
    },
  };
}
