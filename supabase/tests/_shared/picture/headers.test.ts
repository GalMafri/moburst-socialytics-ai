import { describe, expect, it } from "vitest";
import { jpegSize, pngSize } from "../../../functions/_shared/picture/headers";

const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
const jpeg540x960 = new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0xc0, 0x02, 0x1c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const jpeg1088x1936 = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe1, 0x01, 0x2c, ...new Array(300 - 2).fill(0),
  0xff, 0xc2, 0x00, 0x11, 0x08, 0x07, 0x90, 0x04, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const png2160 = new Uint8Array(24);
png2160.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
new DataView(png2160.buffer).setUint32(16, 2160);
new DataView(png2160.buffer).setUint32(20, 2160);

describe("jpegSize", () => {
  it("reads the frame size from a baseline JPEG's start-of-frame segment", () => {
    expect(jpegSize(jpeg540x960)).toEqual([540, 960]);
  });
  it("skips application segments of any length before the frame", () => {
    expect(jpegSize(jpeg1088x1936)).toEqual([1088, 1936]);
  });
  it("refuses bytes that are not a JPEG, naming the file", () => {
    expect(() => jpegSize(new Uint8Array([1, 2, 3]), "The frame")).toThrow("The frame must be a JPEG file.");
  });
  it("refuses a JPEG that ends before any frame segment", () => {
    expect(() => jpegSize(new Uint8Array([0xff, 0xd8, ...app0]))).toThrow("The still must be a JPEG file.");
  });
});

describe("pngSize", () => {
  it("still reads a PNG's size after moving, and jobs.ts still exports it", async () => {
    const jobs = await import("../../../functions/_shared/canva/jobs");
    expect(jobs.pngSize).toBe(pngSize);
    expect(pngSize(png2160)).toEqual([2160, 2160]);
  });
});
