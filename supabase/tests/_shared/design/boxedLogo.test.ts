// @vitest-environment node
// P33-2 (QA 22 Nov 2026): a logo whose file is an opaque square (its own white box, e.g. a 2160x2160 avatar-style file that the
// trim cannot shrink) is refused on every light ground: the white box counts as a whole part that must show.
import { describe, expect, it } from "vitest";
import { pickStamp } from "../../../functions/_shared/design/logoSlot";
import { wholeInks, type Raster } from "../../../functions/_shared/design/logoTone";

const W = 400;
const data = new Uint8ClampedArray(W * W * 4);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  // White opaque box; a dark navy mark inside it, away from the edges.
  const mark = Math.hypot(x - 200, y - 200) < 120;
  data.set(mark ? [16, 24, 64, 255] : [255, 255, 255, 255], (y * W + x) * 4);
}
const boxed: Raster = { width: W, height: W, data };

describe("P33 boxed logo on a light ground", () => {
  it("stamps the stored boxed logo on a light cream ground, where its mark shows at about 15:1", () => {
    const inks = wholeInks(boxed).inks;
    const picked = pickStamp([{ file: "stored", inks }], [242, 236, 226]);
    expect(picked.file).toBe("stored");
  });

  it("stamps it on a dark ground too, where its box carries the mark", () => {
    expect(pickStamp([{ file: "stored", inks: wholeInks(boxed).inks }], [11, 14, 26]).file).toBe("stored");
  });

  it("still tests a plain square with nothing inside it, which is the logo itself", () => {
    const plain = new Uint8ClampedArray(W * W * 4);
    for (let p = 0; p < W * W; p++) plain.set([255, 255, 255, 255], p * 4);
    expect(wholeInks({ width: W, height: W, data: plain }).inks).toEqual([[255, 255, 255]]);
  });
});
