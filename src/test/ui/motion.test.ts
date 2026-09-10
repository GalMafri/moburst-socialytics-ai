import { describe, expect, it } from "vitest";
import { clipSize } from "@/lib/motion";

describe("clipSize", () => {
  it("gives each aspect its platform size, all even numbers", () => {
    for (const a of ["9:16", "1:1", "16:9", "4:5"]) {
      const { width, height } = clipSize(a);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeGreaterThanOrEqual(1080);
    }
    expect(clipSize("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(clipSize("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(clipSize("anything else")).toEqual({ width: 1080, height: 1920 });
  });
});
