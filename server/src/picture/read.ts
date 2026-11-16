// server/src/picture/read.ts
//
// The pictures a model reads (12 Nov 2026): the design worker's marks read
// (design-worker/index.ts:322-323) and verify reads (:386-388, :400-402,
// :411-417). The picture is brought to the page size; a Story's text band
// is cut from that page-size picture, and the area around the logo from the
// full-size picture. The crops arrive as rectangles, computed by the worker.

import { resampleRGBA } from "../../../supabase/functions/_shared/canva/brief.ts";
import type { Rect, Size } from "../../../supabase/functions/_shared/picture/contract.ts";
import { crop, type Raster } from "./raster.ts";

export function readPictures(picture: Raster, page: Size, crops: { band?: Rect; area?: Rect }): { page: Raster; band?: Raster; area?: Raster } {
  const small: Raster = { width: page.width, height: page.height, data: resampleRGBA(picture.data, picture.width, picture.height, page.width, page.height) };
  const out: { page: Raster; band?: Raster; area?: Raster } = { page: small };
  if (crops.band) out.band = crop(small, crops.band.x, crops.band.y, crops.band.width, crops.band.height);
  if (crops.area) out.area = crop(picture, crops.area.x, crops.area.y, crops.area.width, crops.area.height);
  return out;
}
