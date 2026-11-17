// server/src/picture/locate.ts
//
// Where the model drew the logo (12 Nov 2026): the design worker's locate
// step (design-worker/index.ts:284-287). The logo file is searched for
// around its usual rectangle on the design, at the sizes the caller allows.
// Whether the match is good enough stays the worker's decision; this only
// reports what was found, the usual rectangle and the design's size. Since
// 17 Nov 2026 it also reports the picture's own ground around the found
// logo, and `lost` when a whole part of the logo file has that color: the
// part would not show once the file is stamped there. The search is
// stepwise work (17 Nov 2026): after each step it says how far it got, and
// `from` carries on from such a point with the same answer.

import { canvasLogoRect } from "../../../supabase/functions/_shared/canva/brief.ts";
import { findLogoSteps, toEnd } from "../../../supabase/functions/_shared/design/logoMatch.ts";
import { lostOn, type Searched } from "../../../supabase/functions/_shared/design/logoTone.ts";
import type { LocateResult, Placement, Rgb } from "../../../supabase/functions/_shared/picture/contract.ts";
import type { Raster } from "./raster.ts";

export function* locateLogoSteps(design: Raster, logo: Raster, placement: Placement, background: Rgb, scales: [number, number], from?: Searched): Generator<Searched, LocateResult, void> {
  const usual = canvasLogoRect(placement, logo.width, logo.height, design.width, design.height);
  const search = findLogoSteps(design.data, design.width, design.height, logo.data, logo.width, logo.height, usual, background, { scales, from: from?.at });
  for (;;) {
    const step = search.next();
    if (step.done) {
      const found = step.value;
      const { ground, lost } = lostOn(design, logo, { x: found.x, y: found.y, width: found.width, height: found.height });
      return { ...found, usual, frame: [design.width, design.height], ...(ground ? { ground } : {}), ...(lost ? { lost: true } : {}) };
    }
    yield { done: [], at: step.value };
  }
}

/** Locate for a job with one file, run to its end in one go. */
export function locateLogo(design: Raster, logo: Raster, placement: Placement, background: Rgb, scales: [number, number]): LocateResult {
  return toEnd(locateLogoSteps(design, logo, placement, background, scales));
}
