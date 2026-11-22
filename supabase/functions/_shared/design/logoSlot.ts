// supabase/functions/_shared/design/logoSlot.ts
//
// The model marks the slot, the app places the file (17 Nov 2026, spec
// 2026-11-16-logo-tone-design.md, section 13). The image model never gets
// the final word on the logo: it redraws the canvas logo in the tone and
// weight that suit its picture, so what it drew only says where the logo
// goes. This file holds what decides from there on:
//
//   the slot       where the logo goes on a design: the rectangle the model
//                  drew the logo at when the search finds it by the existing
//                  test, else the rectangle the canvas carried;
//   the ground     the picture's own color under the slot once the model's
//                  drawing is cleaned out, as one real pixel;
//   the file       the first file of the client's set, in order, whose
//                  whole parts all show on that ground;
//   the drawing    whether the template that found the drawing still finds
//                  it on the cleaned picture.
//
// No design is made again because the drawing is no close match of the
// file. Every measure here is exact: a known rectangle, real pixels, the
// files' own colors and the two contrasts the product already has
// (logoTone.ts, showsWhole and hidesPart).
//
// Free of Deno and network imports: the picture service, the design worker,
// the replay and the tests all import it.

import { weakestContrast } from "../lifecycle/designSettings.ts";
import type { LogoFileName, Rect, Rgb } from "../picture/contract.ts";
import { findLogoSteps, LOGO_MIN_SCORE, logoFound, toEnd, type SearchAt } from "./logoMatch.ts";
import { hidesPart, PART_STEP, showsWhole, stampRect, type Raster } from "./logoTone.ts";

/** Where the logo goes: the rectangle, why, and the file whose shape the rectangle has. */
export type Slot = { rect: Rect; from: "drawn" | "canvas"; of: LogoFileName };

/**
 * The slot. `found` is the search's best match: the matched template's
 * file, where, its score and that file's usual rectangle. `canvas` is the
 * canvas file and the rectangle the canvas carried it at.
 *
 * When the match is the logo by the existing test (logoFound: 0.75 or more,
 * at a size the client uses), the slot is where the model drew it. In every
 * other case it is the canvas rectangle. A weaker match is never the slot,
 * wherever it sits, so a stray match on a headline cannot move the logo.
 */
export function slotOf(found: { matched: LogoFileName; rect: Rect; score: number; usual: Rect }, canvas: { file: LogoFileName; rect: Rect }): Slot {
  if (logoFound({ width: found.rect.width, score: found.score }, found.usual.width)) return { rect: found.rect, from: "drawn", of: found.matched };
  return { rect: canvas.rect, from: "canvas", of: canvas.file };
}

/**
 * The ground under the slot, read on the picture with the model's drawing
 * cleaned out: of every second pixel on every second row inside the
 * rectangle, the one in the middle by brightness (equal ones by position).
 * A real pixel of the picture. `flat` is the share of the sampled pixels
 * within 16 per channel of it. Null when the rectangle has no pixel on the
 * picture.
 */
export function groundUnder(picture: Raster, rect: Rect): { ground: Rgb; flat: number } | null {
  const d = picture.data;
  const sampled: Array<[number, number]> = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 2) {
    if (y < 0 || y >= picture.height) continue;
    for (let x = rect.x; x < rect.x + rect.width; x += 2) {
      if (x < 0 || x >= picture.width) continue;
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

/** One file that may be stamped: its name, the colors of its whole exposed parts, and whether it is a made copy the client's own posts do not show. */
export type StampInks = { file: LogoFileName; inks: Rgb[]; last?: boolean };

/**
 * The file that is stamped on a ground. `files` are in stamp order: the
 * stored file, the second file, the white copy. The first file whose whole
 * parts all show on the ground (3:1 or more for each) is stamped. When none
 * does, the first with no whole part under 1.5:1: weaker, and still the
 * logo. A made copy marked `last` is tried after every other file, at both
 * lines. When no file is left, none is named and the design is made again.
 *
 * `shows` is each file's weakest whole part against the ground, to two
 * places, for review. A file with no whole part has nothing to test and
 * shows anywhere.
 */
export function pickStamp(files: StampInks[], ground: Rgb): { file: LogoFileName | null; shows: Partial<Record<LogoFileName, number>> } {
  return pickStampOn(files, [ground]);
}

/**
 * The file stamped on several grounds at once (a carousel's slides, 17 Nov
 * 2026): pickStamp's order and its two lines, each held on every ground, so
 * the weakest ground decides. `shows` is each file's weakest whole part on
 * its weakest ground, to two places. With one ground it is pickStamp, field
 * for field.
 */
export function pickStampOn(files: StampInks[], grounds: Rgb[]): { file: LogoFileName | null; shows: Partial<Record<LogoFileName, number>> } {
  const shows: Partial<Record<LogoFileName, number>> = {};
  for (const f of files) {
    let weakest = Infinity;
    for (const g of grounds) weakest = Math.min(weakest, weakestContrast(f.inks, g));
    if (Number.isFinite(weakest)) shows[f.file] = Math.round(weakest * 100) / 100;
  }
  const first = files.filter((f) => !f.last), after = files.filter((f) => f.last);
  for (const group of [first, after]) {
    const whole = group.find((f) => grounds.every((g) => showsWhole(f.inks, g)));
    if (whole) return { file: whole.file, shows };
    const weak = group.find((f) => grounds.every((g) => !hidesPart(f.inks, g)));
    if (weak) return { file: weak.file, shows };
  }
  return { file: null, shows };
}

/**
 * A carousel's file: the pick on every slide's ground (`by` "every"). When
 * no file shows on every ground the grounds really differ (light slides
 * and dark slides), and there is no one file: each slide keeps the file its
 * own ground took (`by` "own", no file named).
 */
export function carouselStamp(files: StampInks[], grounds: Rgb[]): { file: LogoFileName; by: "every"; shows: Partial<Record<LogoFileName, number>> } | { file: null; by: "own"; shows: Partial<Record<LogoFileName, number>> } {
  const picked = pickStampOn(files, grounds);
  return picked.file ? { file: picked.file, by: "every", shows: picked.shows } : { file: null, by: "own", shows: picked.shows };
}

/** How far around the slot, as a share of the picture, the drawing is looked for again after cleaning. */
const STILL_REACH = 0.03;
/** The sizes it is looked for at, as shares of the slot's width. */
const STILL_SCALES: [number, number] = [0.9, 1.1];

/**
 * Whether the drawing that was found on the design is still on the cleaned
 * picture: the template that found it is searched for again at the slot,
 * in either tone, with the same bar (0.75). A picture cleaned to a flat or
 * softly shaded ground has no such match.
 *
 * It is the product's one search (findLogoSteps), so it is stepwise work
 * like every other: after each step it says how far it got, and `from`
 * carries it on from such a point with the same answer.
 */
export function* stillDrawnSteps(picture: Raster, template: { raster: Raster; ground: Rgb }, rect: Rect, from?: SearchAt): Generator<SearchAt, { score: number; found: boolean }, void> {
  const f = yield* findLogoSteps(picture.data, picture.width, picture.height, template.raster.data, template.raster.width, template.raster.height, rect, template.ground, { reach: STILL_REACH, scales: STILL_SCALES, either: true, from });
  // QA 22 Nov 2026: the score reads shape only, whatever its strength, so a soft shade of the logo's size left by
  // cleaning (3 or 4 grey levels, invisible) matched a compact logo. A drawing is still there only where the
  // picture itself shows one: its own contrast at the match reaches STILL_MIN_SPREAD.
  return { score: f.score, found: f.score >= LOGO_MIN_SCORE && spreadAt(picture, f) >= STILL_MIN_SPREAD };
}

/** The least spread of the picture's luminance (its standard deviation, in grey levels) at a match for a drawing to be one a person sees. */
export const STILL_MIN_SPREAD = 3;

/** The standard deviation of the picture's luminance over a rectangle (clipped to the picture). */
function spreadAt(picture: Raster, at: Rect): number {
  const x0 = Math.max(0, Math.floor(at.x)), y0 = Math.max(0, Math.floor(at.y));
  const x1 = Math.min(picture.width, Math.ceil(at.x + at.width)), y1 = Math.min(picture.height, Math.ceil(at.y + at.height));
  let n = 0, sum = 0, sq = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * picture.width + x) * 4, a = picture.data[i + 3] / 255;
      const v = (0.299 * picture.data[i] + 0.587 * picture.data[i + 1] + 0.114 * picture.data[i + 2]) * a;
      n += 1; sum += v; sq += v * v;
    }
  }
  return n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
}

/** The same look run to its end in one go (stillDrawnSteps). */
export function stillDrawn(picture: Raster, template: { raster: Raster; ground: Rgb }, rect: Rect): { score: number; found: boolean } {
  return toEnd(stillDrawnSteps(picture, template, rect));
}

/**
 * Where a file is stamped in a slot: the slot itself for a file of the
 * slot's own shape (every made copy has the stored file's), else the same
 * width and center with the file's own proportions. `of` is the file the
 * slot's shape came from; with none, the slot is used as it is.
 */
export function fitRect(rect: Rect, of: Raster | null, file: Raster): Rect {
  return (of ? stampRect(rect, of, file) : null) ?? rect;
}
