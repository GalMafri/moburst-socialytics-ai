import { describe, expect, it } from "vitest";
import { clipSize, sourceFrameBounds, sourceClipSize } from "@/lib/motion";

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

it('keeps every edge of portrait and landscape artwork inside video frames throughout motion', () => {
  for (const [iw,ih] of [[1080,1350],[1920,1080],[1080,1920]]) {
    for (const aspect of ['9:16','16:9','1:1']) {
      const {width,height} = clipSize(aspect);
      for (const t of [-1,0,0.3,0.7,1,2]) {
        const box = sourceFrameBounds(iw,ih,width,height,t);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x+box.width).toBeLessThanOrEqual(width+0.0001);
        expect(box.y+box.height).toBeLessThanOrEqual(height+0.0001);
        expect(box.width/box.height).toBeCloseTo(iw/ih);
      }
    }
  }
});

it('uses source proportions for feed video and vertical dimensions only for vertical formats', () => {
  expect(sourceClipSize(1080,1350,false)).toEqual({width:1080,height:1350});
  expect(sourceClipSize(1080,1350,true)).toEqual({width:1080,height:1920});
  expect(sourceClipSize(1920,1080,false)).toEqual({width:1080,height:608});
});
