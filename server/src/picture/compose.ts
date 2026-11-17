// server/src/picture/compose.ts
//
// The first picture as the base, on decoded pictures (17 Nov 2026). The
// rule and its numbers are in the shared module the tests and the proof
// read too (supabase/functions/_shared/design/firstPicture.ts); this file
// runs it for the cleaned-slot route, on the rasters a call was given.

import type { FirstPictureFacts, Rect } from "../../../supabase/functions/_shared/picture/contract.ts";
import { composeFirst } from "../../../supabase/functions/_shared/design/firstPicture.ts";
import type { Raster } from "./raster.ts";

/**
 * The picture the cleaned-slot route goes on with. `first` is the design as
 * the model first drew it, null when it could not be read; `cleaned` is the
 * design with the model's logo drawing taken out; `rect` is the slot in
 * `frame` pixels, scaled to the pictures as the route's own reading scales
 * it. When a picture is composed it is `first`, changed in place inside the
 * patch; in every other case it is `cleaned`, untouched, and the facts
 * say why.
 */
export function composeForSlot(first: Raster | null, cleaned: Raster, rect: Rect, frame: [number, number]): { picture: Raster; facts: FirstPictureFacts } {
  if (!first) return { picture: cleaned, facts: { made: false, why: "first", share: 0, join: 0 } };
  const k = cleaned.width / frame[0];
  const at: Rect = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  const made = composeFirst(first, cleaned, at);
  return { picture: made.picture ?? cleaned, facts: made.facts };
}
