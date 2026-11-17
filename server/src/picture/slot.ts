// server/src/picture/slot.ts
//
// The slot, on decoded pictures (17 Nov 2026). The image model only marks
// where the logo goes; the worker has its drawing cleaned out and the
// client's file placed there. Everything that decides is in the shared
// module the worker, the replay and the tests read too
// (supabase/functions/_shared/design/logoSlot.ts); this file runs it on the
// rasters a call was given.

import { canvasLogoRect } from "../../../supabase/functions/_shared/canva/brief.ts";
import type { LogoFileName, Placement, Rect, Rgb, SlotFileResult, SlotResult } from "../../../supabase/functions/_shared/picture/contract.ts";
import { fitRect, groundUnder, pickStamp, slotOf, stillDrawn } from "../../../supabase/functions/_shared/design/logoSlot.ts";
import { searchTemplates, wholeInksOf, type TemplateIn } from "../../../supabase/functions/_shared/design/logoTone.ts";
import type { Raster } from "./raster.ts";

/** One file that may be stamped, decoded. */
export type StampIn = { file: LogoFileName; raster: Raster; last?: boolean };

/**
 * Where the logo goes on a design. Each template is searched for near its
 * file's usual rectangle, in either tone. The slot is the found rectangle
 * when the best match is the logo by the existing test, else the rectangle
 * the canvas carried the first template's file at. Nothing here passes or
 * fails the design.
 */
export function findSlot(design: Raster, templates: TemplateIn[], placement: Placement, scales: [number, number]): SlotResult {
  const found = searchTemplates(design, templates, placement, scales, { either: true });
  const first = templates[0];
  const canvas = canvasLogoRect(placement, first.raster.width, first.raster.height, design.width, design.height);
  const slot = slotOf(found, { file: first.file, rect: canvas });
  return {
    slot: slot.rect, from: slot.from, of: slot.of, index: found.index,
    frame: [design.width, design.height], canvas,
    drawn: found.rect, score: found.score, matched: found.matched, scores: found.scores,
  };
}

/**
 * The cleaned slot. `rect` is in `frame` pixels and is scaled to the
 * picture as the finish route scales it. The ground is read under the
 * slot, the first file whose whole parts all show there is named, and the
 * rectangle it is stamped at is answered in `frame` pixels: the slot for a
 * file of the slot's own shape, else the same width and center with the
 * file's own proportions. With `drawn`, that file is looked for again at
 * the slot over that color. A slot with no pixel on the picture has no
 * ground to test: the first file is named.
 */
export function slotFile(picture: Raster, rect: Rect, frame: [number, number], of: LogoFileName, files: StampIn[], drawn?: { file: LogoFileName; ground: Rgb }): SlotFileResult {
  const k = picture.width / frame[0];
  const at: Rect = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  const rasterOf = (name: LogoFileName) => files.find((f) => f.file === name)?.raster ?? null;
  const under = groundUnder(picture, at);
  const picked = under ? pickStamp(files.map((f) => ({ file: f.file, inks: wholeInksOf(f.raster), last: f.last })), under.ground) : { file: files[0]?.file ?? null, shows: {} };
  const named = picked.file ? rasterOf(picked.file) : null;
  const template = drawn ? rasterOf(drawn.file) : null;
  return {
    ground: under?.ground ?? null, flat: under?.flat ?? 0,
    file: picked.file, rect: named ? fitRect(rect, rasterOf(of), named) : rect,
    shows: picked.shows,
    ...(drawn && template ? { drawn: stillDrawn(picture, { raster: template, ground: drawn.ground }, at) } : {}),
  };
}
