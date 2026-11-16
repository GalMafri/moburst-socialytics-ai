// server/src/picture/title.ts
//
// The title read-back (12 Nov 2026): the video worker's title_check
// (_shared/video/steps.ts:201-216). The box of the lettering's visible
// pixels places the title exactly; the read-back lays the layer over a
// mid-grey ground, so light and dark lettering both show, at half size.
// An empty layer gives neither; the worker decides what that means.

import { TITLE_ALPHA_MIN, TITLE_GROUND, type Rect } from "../../../supabase/functions/_shared/picture/contract.ts";
import { alphaBox, fill, overlay, raster, resizeNearest, type Raster } from "./raster.ts";

export function titleRead(layer: Raster): { box: Rect | null; read: Raster | null } {
  const box = alphaBox(layer, TITLE_ALPHA_MIN);
  if (!box) return { box: null, read: null };
  const ground = overlay(fill(raster(layer.width, layer.height), [...TITLE_GROUND, 255]), layer, 0, 0);
  return { box, read: resizeNearest(ground, Math.round(layer.width / 2), Math.round(layer.height / 2)) };
}
