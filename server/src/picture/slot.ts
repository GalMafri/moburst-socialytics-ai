// server/src/picture/slot.ts
//
// The slot, on decoded pictures (17 Nov 2026). The image model only marks
// where the logo goes; the worker has its drawing cleaned out and the
// client's file placed there. Everything that decides is in the shared
// module the worker, the replay and the tests read too
// (supabase/functions/_shared/design/logoSlot.ts); this file runs it on the
// rasters a call was given. Both search (the slot for the drawing, the
// cleaned slot for what is left of it), and both are stepwise work like
// every search of the service: a route gives other calls a turn between
// steps and can stop at its budget, and each has a form that runs to its end
// in one go, with the same answer.

import { canvasLogoRect } from "../../../supabase/functions/_shared/canva/brief.ts";
import type { LogoFileName, Placement, Rect, Rgb, SlotFileResult, SlotResult } from "../../../supabase/functions/_shared/picture/contract.ts";
import { toEnd } from "../../../supabase/functions/_shared/design/logoMatch.ts";
import { fitRect, groundUnder, pickStamp, slotOf, stillDrawnSteps } from "../../../supabase/functions/_shared/design/logoSlot.ts";
import { searchTemplatesSteps, wholeInksOf, type Searched, type TemplateIn } from "../../../supabase/functions/_shared/design/logoTone.ts";
import type { Raster } from "./raster.ts";

/** One file that may be stamped, decoded. */
export type StampIn = { file: LogoFileName; raster: Raster; last?: boolean };

/**
 * Where the logo goes on a design. Each template is searched for near its
 * file's usual rectangle, in either tone. The slot is the found rectangle
 * when the best match is the logo by the existing test, else the rectangle
 * the canvas carried the first template's file at. Nothing here passes or
 * fails the design.
 *
 * After each step of its searches it says how far they got; `from` carries
 * on from such a point.
 */
export function* findSlotSteps(design: Raster, templates: TemplateIn[], placement: Placement, scales: [number, number], from?: Searched): Generator<Searched, SlotResult, void> {
  const found = yield* searchTemplatesSteps(design, templates, placement, scales, { either: true, from });
  const first = templates[0];
  const canvas = canvasLogoRect(placement, first.raster.width, first.raster.height, design.width, design.height);
  const slot = slotOf(found, { file: first.file, rect: canvas });
  return {
    slot: slot.rect, from: slot.from, of: slot.of, index: found.index,
    frame: [design.width, design.height], canvas,
    drawn: found.rect, score: found.score, matched: found.matched, scores: found.scores,
  };
}

/** The slot, run to its end in one go. */
export function findSlot(design: Raster, templates: TemplateIn[], placement: Placement, scales: [number, number]): SlotResult {
  return toEnd(findSlotSteps(design, templates, placement, scales));
}

/**
 * The cleaned slot. `rect` is in `frame` pixels and is scaled to the
 * picture as the finish route scales it. The ground is read under the
 * slot, the first file whose whole parts all show there is named, and the
 * rectangle it is stamped at is answered in `frame` pixels: the slot for a
 * file of the slot's own shape, else the same width and center with the
 * file's own proportions. With `drawn`, that file is looked for again at
 * the slot over that color. A slot with no pixel on the picture has no
 * ground to test: the first file is named. Beside the named file, every
 * listed file's whole ink colors and its own rectangle in the slot are
 * answered (`inks`, `fits`).
 *
 * The look for the drawing is the one search of this route: after each step
 * of it the route hears how far it got, and `from` carries on from such a
 * point. The ground and the file are read again by a call that carries on,
 * from the same pixels, so the answer is the same.
 */
export function* slotFileSteps(picture: Raster, rect: Rect, frame: [number, number], of: LogoFileName, files: StampIn[], drawn?: { file: LogoFileName; ground: Rgb }, from?: Searched): Generator<Searched, SlotFileResult, void> {
  const k = picture.width / frame[0];
  const at: Rect = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  const rasterOf = (name: LogoFileName) => files.find((f) => f.file === name)?.raster ?? null;
  const under = groundUnder(picture, at);
  const picked = under ? pickStamp(files.map((f) => ({ file: f.file, inks: wholeInksOf(f.raster), last: f.last })), under.ground) : { file: files[0]?.file ?? null, shows: {} };
  const named = picked.file ? rasterOf(picked.file) : null;
  const template = drawn ? rasterOf(drawn.file) : null;
  let still: { score: number; found: boolean } | null = null;
  if (drawn && template) {
    const search = stillDrawnSteps(picture, { raster: template, ground: drawn.ground }, at, from?.at);
    for (;;) {
      const step = search.next();
      if (step.done) { still = step.value; break; }
      yield { done: [], at: step.value };
    }
  }
  return {
    ground: under?.ground ?? null, flat: under?.flat ?? 0,
    file: picked.file, rect: named ? fitRect(rect, rasterOf(of), named) : rect,
    shows: picked.shows,
    // Every listed file's own colors and its own rectangle in this slot, whichever file was named: a carousel's file is chosen over all its slides (carouselLogo.ts).
    inks: Object.fromEntries(files.map((f) => [f.file, wholeInksOf(f.raster)])),
    fits: Object.fromEntries(files.map((f) => [f.file, fitRect(rect, rasterOf(of), f.raster)])),
    ...(still ? { drawn: still } : {}),
  };
}

/** The cleaned slot, run to its end in one go. */
export function slotFile(picture: Raster, rect: Rect, frame: [number, number], of: LogoFileName, files: StampIn[], drawn?: { file: LogoFileName; ground: Rgb }): SlotFileResult {
  return toEnd(slotFileSteps(picture, rect, frame, of, files, drawn));
}
