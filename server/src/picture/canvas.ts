// server/src/picture/canvas.ts
//
// The canvas the image model designs on, and its mask (12 Nov 2026): what
// the design worker's generateDesign built (design-worker/index.ts:474-491).
// The page is filled with the client's background color and the logo file,
// resampled to its usual rectangle, is laid on it. The mask is clear except
// under the logo's own ink, which is opaque white, so the model keeps the
// logo and redraws everything else with no box behind it.

import { canvasLogoRect, resampleRGBA } from "../../../supabase/functions/_shared/canva/brief.ts";
import type { Placement, Rect, Rgb, Size } from "../../../supabase/functions/_shared/picture/contract.ts";
import { fill, overlay, raster, type Raster } from "./raster.ts";

/** The canvas, its mask and the logo's rectangle on the page; logo pixels off the page are left out of the mask. */
export function generationCanvas(logo: Raster, placement: Placement, page: Size, background: Rgb): { canvas: Raster; mask: Raster; rect: Rect } {
  const W = page.width, H = page.height;
  const rect = canvasLogoRect(placement, logo.width, logo.height, W, H);
  const placed: Raster = { width: rect.width, height: rect.height, data: resampleRGBA(logo.data, logo.width, logo.height, rect.width, rect.height) };
  const canvas = overlay(fill(raster(W, H), [background[0], background[1], background[2], 255]), placed, rect.x, rect.y);
  const mask = raster(W, H);
  for (let y = 0; y < placed.height; y++) {
    for (let x = 0; x < placed.width; x++) {
      if (placed.data[(y * placed.width + x) * 4 + 3] === 0) continue;
      const tx = x + rect.x, ty = y + rect.y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      mask.data.set([255, 255, 255, 255], (ty * W + tx) * 4);
    }
  }
  return { canvas, mask, rect };
}
