// @vitest-environment node
// P33-1 (QA 22 Nov 2026): the look for "the logo still drawn after cleaning" (logoSlot.ts, stillDrawn) finds a compact logo
// on a cleaned slot that holds only an invisible soft shade (3 to 4 grey levels), because its score is
// normalized cross-correlation in either tone with no floor on the picture's own contrast.
import { describe, expect, it } from "vitest";
import { stillDrawn } from "../../../functions/_shared/design/logoSlot";
import type { Raster } from "../../../functions/_shared/design/logoTone";

const raster = (w: number, h: number, px: (x: number, y: number) => number[] | null): Raster => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = px(x, y); if (c) data.set(c, (y * w + x) * 4); }
  return { width: w, height: h, data };
};
// A round badge logo on a transparent square file.
const badge = raster(540, 540, (x, y) => (Math.hypot(x - 270, y - 270) < 225 ? [20, 30, 120, 255] : null));
const slot = { x: 432, y: 68, width: 216, height: 216 };
const cx = slot.x + 108, cy = slot.y + 108;
// The cleaned picture: a flat ground of 200 with a soft shade at the slot, at most 3 levels deep (invisible).
const cleaned = raster(1080, 1350, (x, y) => { const v = Math.round(200 - 3 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 60 ** 2))); return [v, v, v, 255]; });

describe("P33 still drawn after cleaning", () => {
  it("does not take a 3-level soft shade for the logo", () => {
    const got = stillDrawn(cleaned, { raster: badge, ground: [240, 240, 240] }, slot);
    expect(got.found).toBe(false);
  });

  it("still finds the badge drawn faintly, light on a light ground", () => {
    const drawn = raster(1080, 1350, (x, y) => { const v = Math.hypot(x - cx, y - cy) < 90 ? 215 : 200; return [v, v, v, 255]; });
    expect(stillDrawn(drawn, { raster: badge, ground: [240, 240, 240] }, slot).found).toBe(true);
  });
});
