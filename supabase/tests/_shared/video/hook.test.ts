import { describe, expect, it } from "vitest";
import { hookBoxOf } from "../../../functions/_shared/video/hook";

describe("hookBoxOf", () => {
  it("returns the lettering's box and the layer's size from the service's answer", () => {
    expect(hookBoxOf({ layer: { width: 1088, height: 1936 }, box: { x: 100, y: 800, width: 888, height: 300 }, read: { width: 544, height: 968 } }))
      .toEqual({ box: { x: 100, y: 800, width: 888, height: 300 }, layer: { width: 1088, height: 1936 } });
  });

  it("throws the empty-title error when the layer had no visible pixels", () => {
    expect(() => hookBoxOf({ layer: { width: 1088, height: 1936 }, box: null, read: null })).toThrow("The title came back empty.");
  });
});
