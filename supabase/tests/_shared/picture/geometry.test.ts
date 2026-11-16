import { describe, expect, it } from "vitest";
import { logoAreaRect, scaledRect } from "../../../functions/_shared/picture/geometry";

describe("scaledRect", () => {
  it("scales a rectangle found on the 2x picture down to a 1440-wide delivery with rounding", () => {
    expect(scaledRect({ x: 980, y: 2240, width: 370, height: 370 }, 1440 / 2176)).toEqual({ x: 649, y: 1482, width: 245, height: 245 });
  });
});

describe("logoAreaRect", () => {
  it("reads 0.6 of the logo's height around it, clipped to the delivered picture", () => {
    expect(logoAreaRect({ x: 980, y: 2240, width: 370, height: 370 }, [2176, 2720], { width: 1440, height: 1800 })).toEqual({ x: 502, y: 1335, width: 538, height: 465 });
  });
});
