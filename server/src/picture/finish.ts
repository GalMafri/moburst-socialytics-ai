// server/src/picture/finish.ts
//
// The finished picture (12 Nov 2026): the design worker's finish step
// (design-worker/index.ts:348-375). The logo file is blended in exactly
// where and at the size the model drew it, inside its own rectangle only
// (a full-size layer per design ran the worker out of memory on 13 Oct),
// and the picture is then resampled to the delivered size.

import { resampleRGBA } from "../../../supabase/functions/_shared/canva/brief.ts";
import type { Rect, Size } from "../../../supabase/functions/_shared/picture/contract.ts";
import type { Raster } from "./raster.ts";

/**
 * Blends the logo into picture.data in place, as the worker did, and returns
 * a new raster at the output size. rect is in frame pixels and is scaled by
 * the picture's width over the frame's; logo pixels off the picture are skipped.
 */
export function finishPicture(picture: Raster, logo: Raster, rect: Rect, frame: [number, number], output: Size): Raster {
  const W = picture.width, H = picture.height;
  const k = W / frame[0];
  const r = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  const lp = resampleRGBA(logo.data, logo.width, logo.height, r.width, r.height);
  const px = picture.data;
  for (let y = 0; y < r.height; y++) {
    const ty = r.y + y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < r.width; x++) {
      const tx = r.x + x;
      if (tx < 0 || tx >= W) continue;
      const j = (y * r.width + x) * 4, a = lp[j + 3];
      if (a === 0) continue;
      const i = (ty * W + tx) * 4, f = a / 255;
      px[i] = Math.round(lp[j] * f + px[i] * (1 - f));
      px[i + 1] = Math.round(lp[j + 1] * f + px[i + 1] * (1 - f));
      px[i + 2] = Math.round(lp[j + 2] * f + px[i + 2] * (1 - f));
      px[i + 3] = 255;
    }
  }
  return { width: output.width, height: output.height, data: resampleRGBA(px, W, H, output.width, output.height) };
}
