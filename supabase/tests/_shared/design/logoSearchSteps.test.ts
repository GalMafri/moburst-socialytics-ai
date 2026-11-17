// @vitest-environment node
// The logo search as stepwise work (17 Nov 2026). The search can be stopped
// after any row of its first pass and carried on later from what it had,
// also through JSON, and it ends in the answer the search gave before it had
// steps, bit for bit, in the tone of the file and in either tone. The oracle
// is that search, copied as it was (searchBefore.ts), so any change to the
// arithmetic fails here.
import { describe, expect, it } from "vitest";
import { canvasLogoRect } from "../../../functions/_shared/canva/brief";
import { coarseFactor, findLogo, findLogoSteps, shrunkOf, toEnd, type SearchAt } from "../../../functions/_shared/design/logoMatch";
import { stillDrawn, stillDrawnSteps } from "../../../functions/_shared/design/logoSlot";
import { DARK, further, LIGHT, searchTemplates, searchTemplatesSteps, type Searched, type TemplateIn } from "../../../functions/_shared/design/logoTone";
import type { Placement, Rgb } from "../../../functions/_shared/picture/contract";
import { drawLogo, flat, inked, mark } from "./draw";
import { findLogoBefore, searchTemplatesBefore, type Match as Candidate } from "./searchBefore";

// ── Pictures drawn here ─────────────────────────────────────────────────────

/** A seeded generator, so every picture is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
}

/** A picture with gradients and grain, so no two spots score alike by chance. */
function grainy(width: number, height: number, seed: number) {
  const next = seeded(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = ((x * 200) / width + (next() >> 2)) | 0;
    data[i + 1] = ((y * 200) / height + (next() >> 2)) | 0;
    data[i + 2] = (60 + (next() >> 1)) | 0;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

const SCALES: [number, number] = [0.45, 1.35];

/** Three searches of different shapes: a wide logo found small, a square one on a large picture (several finer levels), a logo that is not there. */
const CASES = (() => {
  const wide = mark(90, 36, [24, 28, 40]);
  const square = mark(72, 72, [250, 250, 245]);
  const a = { W: 240, H: 180, logo: wide, ground: [255, 255, 255] as Rgb, placement: { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 } as Placement };
  const b = { W: 480, H: 600, logo: square, ground: [11, 14, 26] as Rgb, placement: { anchor: "center", width: 0.4, top: 0.05 } as Placement };
  const ua = canvasLogoRect(a.placement, wide.width, wide.height, a.W, a.H);
  const ub = canvasLogoRect(b.placement, square.width, square.height, b.W, b.H);
  return [
    { name: "a wide logo drawn smaller than usual", ...a, usual: ua, picture: drawLogo(grainy(a.W, a.H, 3), wide, { x: ua.x + 6, y: ua.y + 4, width: Math.round(ua.width * 0.8), height: Math.round((ua.width * 0.8 * 36) / 90) }) },
    { name: "a square logo on a large picture", ...b, usual: ub, picture: drawLogo(grainy(b.W, b.H, 5), square, { x: ub.x - 9, y: ub.y + 11, width: Math.round(ub.width * 1.1), height: Math.round(ub.width * 1.1) }) },
    { name: "a picture with no logo on it", ...a, usual: ua, picture: grainy(a.W, a.H, 9) },
  ];
})();

type Case = (typeof CASES)[number];
const steps = (c: Case, from?: SearchAt, either = false) => findLogoSteps(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, { scales: SCALES, from, either });

/** Runs a search to its end, keeping every point it could be stopped at. */
function run(c: Case, from?: SearchAt, either = false): { points: SearchAt[]; found: Candidate } {
  const points: SearchAt[] = [];
  const search = steps(c, from, either);
  for (;;) {
    const r = search.next();
    if (r.done) return { points, found: r.value };
    points.push(r.value);
  }
}

describe("the logo search in steps", () => {
  it("ends in the answer the search gave before it had steps, bit for bit", () => {
    for (const c of CASES) for (const either of [false, true]) {
      const before = findLogoBefore(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, { scales: SCALES, either });
      expect(findLogo(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, { scales: SCALES, either }), `${c.name}, either ${either}`).toEqual(before);
      expect(run(c, undefined, either).found, `${c.name}, either ${either}`).toEqual(before);
    }
    // The sizes a search asks for when none are given are the ones it always used.
    const c = CASES[0];
    expect(findLogo(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground)).toEqual(findLogoBefore(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground));
  });

  it("finds a logo drawn in the other tone only when it reads either tone, with the score the search before gave", () => {
    // The first case's logo, drawn in white on a dark picture: the file's own tone does not match it, either tone does.
    const c = CASES[0];
    const drawnAt = { x: c.usual.x + 6, y: c.usual.y + 4, width: Math.round(c.usual.width * 0.8), height: Math.round((c.usual.width * 0.8 * 36) / 90) };
    const other = { ...c, picture: drawLogo(flat(c.W, c.H, [16, 40, 76]), c.logo, drawnAt, [255, 255, 255]) };
    const own = run(other).found, either = run(other, undefined, true).found;
    expect(own.score).toBeLessThan(0.5);
    expect(either.score).toBeGreaterThan(0.9);
    expect(either).toEqual(findLogoBefore(other.picture.data, other.W, other.H, other.logo.data, other.logo.width, other.logo.height, other.usual, other.ground, { scales: SCALES, either: true }));
    // Cut at a point in its first pass and carried on through JSON: the same answer.
    const whole = run(other, undefined, true);
    const middle = JSON.parse(JSON.stringify(whole.points[Math.floor(whole.points.length / 3)])) as SearchAt;
    expect(run(other, middle, true).found).toEqual(whole.found);
  });

  it("reads the picture's luminance and shrunk copies from the ones it is handed, with the same answer", () => {
    const c = CASES[1];
    const of = shrunkOf(c.picture.data, c.W, c.H);
    const before = findLogoBefore(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, { scales: SCALES });
    // Twice from the same handed copies, as the second template of a call does.
    for (let i = 0; i < 2; i++) expect(toEnd(findLogoSteps(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, { scales: SCALES, of }))).toEqual(before);
    expect(of.at(120, 150)).toBe(of.at(120, 150));
  });

  it("looks for a drawing again at its slot in steps, with the answer of the search before", () => {
    const c = CASES[0];
    const drawnAt = { x: c.usual.x + 6, y: c.usual.y + 4, width: Math.round(c.usual.width * 0.8), height: Math.round((c.usual.width * 0.8 * 36) / 90) };
    for (const picture of [c.picture, CASES[2].picture]) {
      const before = findLogoBefore(picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, drawnAt, c.ground, { reach: 0.03, scales: [0.9, 1.1], either: true });
      const now = stillDrawn(picture, { raster: c.logo, ground: c.ground }, drawnAt);
      expect(now).toEqual({ score: before.score, found: before.score >= 0.75 });
      // Stopped at its first point and carried on from there.
      const first = stillDrawnSteps(picture, { raster: c.logo, ground: c.ground }, drawnAt).next();
      if (first.done) throw new Error("expected a step");
      expect(toEnd(stillDrawnSteps(picture, { raster: c.logo, ground: c.ground }, drawnAt, JSON.parse(JSON.stringify(first.value)) as SearchAt))).toEqual(now);
    }
  });

  it("gives the same answer for rows of every length: four spots are summed together, and what is left of a row one at a time", () => {
    // The reach sets how many spots a row of the first pass has: 1, 3, 5, 7 and 9 here (and 7 in every finer level), so rows
    // with no group of four, with a group and a rest of one to three, and with two groups are all compared with the search before.
    const lengths = new Set<number>();
    for (const c of [CASES[0], CASES[1]]) for (const reach of [0, 0.005, 0.009, 0.013, 0.017]) for (const either of [false, true]) {
      const f = coarseFactor(c.usual.width, c.usual.height);
      lengths.add(2 * Math.round((reach * c.W) / f) + 1);
      const opts = { scales: SCALES, reach, either };
      expect(findLogo(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, opts), `${c.name}, reach ${reach}, either ${either}`)
        .toEqual(findLogoBefore(c.picture.data, c.W, c.H, c.logo.data, c.logo.width, c.logo.height, c.usual, c.ground, opts));
    }
    expect([...lengths].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9]);
  });

  it("can be stopped after every row of its first pass, and says how far it got", () => {
    const { points } = run(CASES[0]);
    // Many points, each further than the one before: the size in progress, then the rows of it that are done.
    expect(points.length).toBeGreaterThan(200);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      expect(b.size > a.size || (b.size === a.size && b.row >= a.row), `point ${i}`).toBe(true);
      expect(b.best.score).toBeGreaterThanOrEqual(a.best.score);
    }
  });

  it("takes a step after every row of the finer levels too, and says the end of its first pass at each", () => {
    // The square logo on the large picture: the first pass runs on a picture shrunk by 4, so two finer levels follow it.
    const c = CASES[1];
    expect(coarseFactor(c.usual.width, c.usual.height)).toBe(4);
    const { points } = run(c);
    const end = points[points.length - 1];
    const after = points.filter((p) => p.size === end.size && p.row === 0);
    // Two levels of up to five sizes and seven rows each: far more steps than one a level, so no level is one long piece of work.
    expect(after.length).toBeGreaterThan(20);
    expect(after.every((p) => JSON.stringify(p) === JSON.stringify(end))).toBe(true);
    // Every point before them is of the first pass.
    expect(points.slice(0, points.length - after.length).every((p) => p.size < end.size)).toBe(true);
  });

  it("carries on from any point it was stopped at, through JSON, and ends in the same answer", () => {
    for (const c of CASES) {
      const whole = run(c);
      // Eight points spread over the search (the first among them), and the last two, which are after the first pass when the search has finer levels.
      const every = Math.max(1, Math.floor(whole.points.length / 8));
      const picked = whole.points.filter((_, i) => i % every === 0).concat(whole.points.slice(-2));
      expect(picked.length).toBeGreaterThan(5);
      for (const at of picked) {
        const sent = JSON.parse(JSON.stringify(at)) as SearchAt;
        expect(run(c, sent).found, `${c.name} from size ${at.size} row ${at.row}`).toEqual(whole.found);
      }
    }
  }, 60_000);

  it("does no row twice when it carries on", () => {
    const c = CASES[0];
    const whole = run(c);
    const middle = whole.points[Math.floor(whole.points.length / 2)];
    const rest = run(c, middle);
    // What is left is what came after the point, and nothing before it.
    expect(rest.points).toEqual(whole.points.slice(whole.points.indexOf(middle) + 1));
  });
});

describe("the search over one or two templates, in steps", () => {
  const W = 240, H = 180;
  const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
  const shape = mark(40, 16, [24, 28, 40]);
  const usual = canvasLogoRect(placement, 40, 16, W, H);
  const drawn = { x: usual.x + 6, y: usual.y + 4, width: Math.round(usual.width * 0.8), height: Math.round((usual.width * 0.8 * 16) / 40) };
  const design = drawLogo(flat(W, H, [10, 12, 30]), shape, drawn, [255, 255, 255]);
  const templates: TemplateIn[] = [{ file: "stored", raster: shape, ground: LIGHT }, { file: "other", raster: inked(shape, [255, 255, 255]), ground: DARK }];

  function run(from?: Searched, either = false) {
    const points: Searched[] = [];
    const search = searchTemplatesSteps(design, templates, placement, SCALES, { from, either });
    for (;;) {
      const r = search.next();
      if (r.done) return { points, found: r.value };
      points.push(JSON.parse(JSON.stringify(r.value)) as Searched);
    }
  }

  it("ends in the answer the search over templates gave before it had steps, in the file's tone and in either", () => {
    for (const either of [false, true]) {
      const before = searchTemplatesBefore(design, templates, placement, SCALES, { either });
      expect(run(undefined, either).found, `either ${either}`).toEqual(before);
      expect(searchTemplates(design, templates, placement, SCALES, { either }), `either ${either}`).toEqual(before);
    }
    // In either tone the first template already finds the white drawing, which its own tone does not.
    expect(searchTemplatesBefore(design, templates, placement, SCALES, { either: true }).scores[0]).toBeGreaterThan(0.9);
    expect(searchTemplatesBefore(design, templates, placement, SCALES).scores[0]).toBeLessThan(0.75);
  });

  it("says each point no earlier than the one before, and the same point only after a first pass", () => {
    const { points } = run();
    for (let i = 1; i < points.length; i++) {
      // Every step of a first pass is further than the last; the short levels after a first pass repeat its end.
      const same = JSON.stringify(points[i]) === JSON.stringify(points[i - 1]);
      expect(further(points[i], points[i - 1]) || same, `point ${i}`).toBe(true);
      expect(further(points[i - 1], points[i]), `point ${i}`).toBe(false);
    }
    expect(further(points[0], undefined)).toBe(true);
    const best = { x: 0, y: 0, width: 4, height: 2, score: 0.5 };
    // More templates finished is further, whatever the rows; then more sizes, then more rows; a point is not further than itself.
    expect(further({ done: [best], at: { size: 0, row: 1, best } }, { done: [], at: { size: 22, row: 40, best } })).toBe(true);
    expect(further({ done: [], at: { size: 3, row: 1, best } }, { done: [], at: { size: 2, row: 40, best } })).toBe(true);
    expect(further({ done: [], at: { size: 3, row: 2, best } }, { done: [], at: { size: 3, row: 1, best } })).toBe(true);
    expect(further({ done: [], at: { size: 3, row: 2, best } }, { done: [], at: { size: 3, row: 2, best } })).toBe(false);
    expect(further({ done: [best], at: { size: 0, row: 1, best } }, { done: [best] })).toBe(true);
    expect(further({ done: [best] }, { done: [best], at: { size: 0, row: 1, best } })).toBe(false);
  });

  it("carries on in the first template, between the two and in the second, and ends in the same answer", () => {
    const whole = run();
    const first = whole.points.filter((p) => p.done.length === 0);
    const second = whole.points.filter((p) => p.done.length === 1);
    expect(first.length).toBeGreaterThan(10);
    expect(second.length).toBeGreaterThan(10);
    const picked = [first[0], first[Math.floor(first.length / 2)], first[first.length - 1], second[0], second[Math.floor(second.length / 2)], second[second.length - 1]];
    for (const from of picked) expect(run(from).found, JSON.stringify(from).slice(0, 80)).toEqual(whole.found);
    // A finished first search is not run again: what is left starts in the second template.
    expect(run(second[0]).points.every((p) => p.done.length === 1)).toBe(true);
    // The same in either tone, the way the slot is searched.
    const either = run(undefined, true);
    const cut = either.points.filter((_, i) => i % Math.max(1, Math.floor(either.points.length / 6)) === 0);
    for (const from of cut) expect(run(from, true).found).toEqual(either.found);
  });
});
