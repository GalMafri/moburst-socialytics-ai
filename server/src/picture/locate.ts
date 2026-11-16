// server/src/picture/locate.ts
//
// Where the model drew the logo (12 Nov 2026): the design worker's locate
// step (design-worker/index.ts:284-287). The logo file is searched for
// around its usual rectangle on the design, at the sizes the caller allows.
// Whether the match is good enough stays the worker's decision; this only
// reports what was found, the usual rectangle and the design's size.

import { canvasLogoRect } from "../../../supabase/functions/_shared/canva/brief.ts";
import { findLogo } from "../../../supabase/functions/_shared/design/logoMatch.ts";
import type { LocateResult, Placement, Rgb } from "../../../supabase/functions/_shared/picture/contract.ts";
import type { Raster } from "./raster.ts";

export function locateLogo(design: Raster, logo: Raster, placement: Placement, background: Rgb, scales: [number, number]): LocateResult {
  const usual = canvasLogoRect(placement, logo.width, logo.height, design.width, design.height);
  const found = findLogo(design.data, design.width, design.height, logo.data, logo.width, logo.height, usual, background, { scales });
  return { ...found, usual, frame: [design.width, design.height] };
}
