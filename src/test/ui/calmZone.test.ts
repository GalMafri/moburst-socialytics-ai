import { describe, expect, it } from "vitest";
import { findCalmZone, inkFor, largestCalmRect, calmMask } from "@/lib/calmZone";

/** A cols×rows luminance grid painted by a function of (x%, y%). */
function grid(cols: number, rows: number, paint: (x: number, y: number) => number): Float32Array {
  const lum = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) lum[r * cols + c] = paint((c / cols) * 100, (r / rows) * 100);
  return lum;
}
/** Noise that looks like a photograph: nothing two neighbours share. */
const photo = (x: number, y: number) => 0.5 + 0.4 * Math.sin(x * 7.3 + y * 3.1) * Math.cos(y * 5.7);

describe("findCalmZone", () => {
  it("finds a full-width navy band under a photograph (Bader feed layout)", () => {
    const lum = grid(48, 64, (x, y) => (y >= 55 ? 0.12 : photo(x, y)));
    const z = findCalmZone(lum, 48, 64)!;
    expect(z).not.toBeNull();
    expect(z.top).toBeGreaterThanOrEqual(53);
    expect(z.left).toBe(0);
    expect(z.right).toBe(100);
    expect(z.luminance).toBeCloseTo(0.12, 1);
  });

  it("finds a colour block that only covers the left half (Bader reel layout)", () => {
    const lum = grid(48, 64, (x, y) => (x < 50 && y < 50 ? 0.1 : photo(x, y)));
    const z = findCalmZone(lum, 48, 64)!;
    expect(z).not.toBeNull();
    expect(z.right).toBeLessThanOrEqual(52);
    expect(z.bottom).toBeLessThanOrEqual(52);
    expect(z.left).toBe(0);
    expect(z.top).toBe(0);
  });

  it("accepts a lightly textured field, so a ribbed or paper ground still counts", () => {
    const lum = grid(48, 64, (x, y) => (y < 40 ? 0.2 + 0.015 * Math.sin(x * 2) : photo(x, y)));
    expect(findCalmZone(lum, 48, 64)).not.toBeNull();
  });

  it("returns null for a picture with no field to type into", () => {
    const lum = grid(48, 64, photo);
    expect(findCalmZone(lum, 48, 64)).toBeNull();
  });

  it("ignores a calm strip too thin to be a headline zone", () => {
    const lum = grid(48, 64, (x, y) => (y >= 92 ? 0.1 : photo(x, y)));
    expect(findCalmZone(lum, 48, 64)).toBeNull();
  });
});

describe("largestCalmRect", () => {
  it("picks the biggest rectangle, not the first one", () => {
    const cols = 10, rows = 10;
    const mask = new Uint8Array(cols * rows);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 10; c++) mask[r * cols + c] = 1; // 2×10 = 20
    for (let r = 4; r < 10; r++) for (let c = 2; c < 7; c++) mask[r * cols + c] = 1; // 6×5 = 30
    const best = largestCalmRect(mask, cols, rows)!;
    expect(best.area).toBe(30);
    expect(best.r0).toBe(4);
    expect(best.c0).toBe(2);
  });
});

describe("calmMask and inkFor", () => {
  it("marks a hard edge as not calm on both sides", () => {
    const lum = new Float32Array([0, 0, 1, 1]);
    const mask = calmMask(lum, 4, 1);
    expect(Array.from(mask)).toEqual([1, 0, 0, 1]);
  });
  it("sets white type on dark fields and dark type on light ones", () => {
    expect(inkFor(0.12)).toBe("#ffffff");
    expect(inkFor(0.9)).toBe("#111111");
  });
});
