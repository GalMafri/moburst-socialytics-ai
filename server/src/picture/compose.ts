// server/src/picture/compose.ts
//
// The first picture as the base, on decoded pictures (17 Nov 2026). The
// rule and its numbers are in the shared modules the tests and the proof
// read too (supabase/functions/_shared/design/firstPicture.ts, and
// firstPictureStrokes.ts for the step tried when no rectangle can be laid,
// 18 Nov 2026); this file runs them for the cleaned-slot route, on the
// rasters a call was given.

import type { FirstPictureFacts, Rect } from "../../../supabase/functions/_shared/picture/contract.ts";
import { composeFirstOrStrokes } from "../../../supabase/functions/_shared/design/firstPictureStrokes.ts";
import type { Raster } from "./raster.ts";

/**
 * The picture the cleaned-slot route goes on with. `first` is the design as
 * the model first drew it, null when it could not be read; `cleaned` is the
 * design with the model's logo drawing taken out; `rect` is the slot in
 * `frame` pixels, scaled to the pictures as the route's own reading scales
 * it; `found` says the request looks for the found drawing there (it
 * carries `drawn`). For a slot that was not found the rule itself measures
 * whether the logo was removed inside it. Where the rule can lay no
 * rectangle ("removal", "join"), the strokes the cleaning took out are
 * patched by themselves when the pair shows them plainly
 * (`composeFirstOrStrokes`, the one place that decides). When a picture is
 * composed it is `first`, changed in place inside the patch; in every other
 * case it is `cleaned`, untouched, and the facts say why.
 */
export function composeForSlot(first: Raster | null, cleaned: Raster, rect: Rect, frame: [number, number], found: boolean): { picture: Raster; facts: FirstPictureFacts } {
  if (!first) return { picture: cleaned, facts: { made: false, why: "first", share: 0, join: 0 } };
  const k = cleaned.width / frame[0];
  const at: Rect = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  const made = composeFirstOrStrokes(first, cleaned, at, found);
  return { picture: made.picture ?? cleaned, facts: made.facts };
}
