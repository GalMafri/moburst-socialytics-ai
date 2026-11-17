import { describe, expect, it } from "vitest";
import { chooseLogo, eitherRead, imageSize, measuredPlacement, PICK_MIN_POSTS, postsCarrying } from "../../../functions/_shared/design/logoPick";
import { logoFound } from "../../../functions/_shared/design/logoMatch";

describe("the logo the client's posts show", () => {
  /** What one post gave for one mark: found by the test a design gets, with its score. */
  const on = (score: number, found = score >= 0.75) => ({ found, score });

  it("counts every post the client's logo is found on, whatever a candidate scores there", () => {
    // A second file of the same logo that scores a hair higher on every post: the logo is still found on all three, so the posts carry it.
    const twin = postsCarrying([[on(0.906901), on(0.943629), on(0.899972)], [on(0.92), on(0.966), on(0.927)]]);
    expect(twin).toEqual({ by: [1, 1, 1], counts: [3, 3] });
    expect(chooseLogo(twin.counts[0], [{ id: "twin", found: twin.counts[1] }])).toBeNull();
    // A candidate far ahead on two posts where the logo is found at a low score: both still count for the logo.
    expect(postsCarrying([[on(0.78), on(0.3), on(0.76)], [on(0.95), on(0.96), on(0.5)]])).toEqual({ by: [1, 1, 0], counts: [2, 2] });
    // A high score that failed the size half of the test is not found, and a post that was not read counts for nothing.
    expect(postsCarrying([[null, on(0.3), on(0.99, false), on(0.8)]])).toEqual({ by: [null, null, null, 0], counts: [1] });
  });

  it("counts a post for a candidate only where it is found and scores higher than the client's logo", () => {
    // The client's stacked lockup on two posts, and a sister lockup "found" on the same two at a lower score:
    // its rectangle covers a part of the mark the posts carry. Those posts are not the candidate's.
    expect(postsCarrying([[on(0.973), on(0.969), on(0.3), on(0.2)], [on(0.766), on(0.792), on(0.31), on(0.25)]])).toEqual({ by: [0, 0, null, null], counts: [2, 0] });
    // Found, and ahead of the logo: the candidate's posts.
    expect(postsCarrying([[on(0.5), on(0.3), on(0.76)], [on(0.95), on(0.96), on(0.5)]])).toEqual({ by: [1, 1, 0], counts: [1, 2] });
    // Equal scores are the logo's.
    expect(postsCarrying([[on(0.9)], [on(0.9)]])).toEqual({ by: [0], counts: [1, 0] });
  });

  it("gives a candidate nothing for a post where the client's logo scores higher, found or not", () => {
    // The logo matches the first post at 0.887 with the match at an end of the sizes searched, so it is not found there.
    // The candidate is found on that post at 0.80: the post carries the logo at a size outside the test, and the candidate gets nothing for it.
    expect(postsCarrying([[on(0.887, false), on(0.4)], [on(0.8), on(0.81)]])).toEqual({ by: [null, 1], counts: [0, 1] });
    expect(postsCarrying([[null, on(0.3), on(0.99, false)], [undefined, on(0.5), on(0.8)]])).toEqual({ by: [null, null, null], counts: [0, 0] });
    // A logo that was not read on a post has no score to beat there.
    expect(postsCarrying([[null, undefined], [on(0.8), on(0.9)]])).toEqual({ by: [1, 1], counts: [0, 2] });
    expect(postsCarrying([[], [on(0.8), on(0.9)]])).toEqual({ by: [1, 1], counts: [0, 2] });
  });

  it("counts a post for one candidate only: the one with the highest score there, the earlier when equal, and only when that one is found", () => {
    expect(postsCarrying([[on(0.4), on(0.4)], [on(0.8), on(0.9)], [on(0.93), on(0.85)]])).toEqual({ by: [2, 1], counts: [0, 1, 1] });
    expect(postsCarrying([[on(0.2)], [on(0.9)], [on(0.9)]])).toEqual({ by: [1], counts: [0, 1, 0] });
    // A candidate that scores highest at a size the test does not accept keeps the post from the others, and is not counted itself.
    expect(postsCarrying([[on(0.2)], [on(0.8)], [on(0.95, false)]])).toEqual({ by: [null], counts: [0, 0, 0] });
  });

  it("counts nothing for a post that was not read or shows no mark", () => {
    expect(postsCarrying([[null, on(0.3)], [undefined, on(0.5)]])).toEqual({ by: [null, null], counts: [0, 0] });
    expect(postsCarrying([])).toEqual({ by: [], counts: [] });
  });

  it("never replaces a logo the posts carry, whatever a candidate is found on", () => {
    expect(chooseLogo(2, [{ id: "a", found: 9 }])).toBeNull();
    expect(chooseLogo(2, [{ id: "a", found: 3 }])).toBeNull();
    expect(chooseLogo(6, [{ id: "a", found: 2 }, { id: "b", found: 12 }])).toBeNull();
    expect(chooseLogo(PICK_MIN_POSTS, [{ id: "a", found: 16 }])).toBeNull();
  });

  it("replaces a logo the posts do not carry with the candidate they carry", () => {
    expect(chooseLogo(0, [{ id: "a", found: 5 }, { id: "b", found: 3 }])).toBe("a");
    expect(chooseLogo(0, [{ id: "a", found: 2 }, { id: "b", found: 10 }])).toBe("b");
    expect(chooseLogo(1, [{ id: "a", found: 2 }])).toBe("a");
  });

  it("keeps the logo the client has when no candidate is carried: one post alone, none, or no candidate", () => {
    expect(chooseLogo(0, [{ id: "a", found: 1 }])).toBeNull();
    expect(chooseLogo(1, [{ id: "a", found: 1 }])).toBeNull();
    expect(chooseLogo(0, [{ id: "a", found: 0 }, { id: "b", found: 0 }])).toBeNull();
    expect(chooseLogo(0, [])).toBeNull();
  });

  it("counts a logo that was read twice on every post either read finds it on, with the higher score of the two", () => {
    // A standing logo: its own search at the model's spot, and its set's read at the place measured from its posts.
    const own = [on(0.3), on(0.9), on(0.99, false), null, on(0.3)];
    const set = [on(0.95), on(0.8), on(0.4), on(0.9), null];
    const both = own.map((p, i) => eitherRead(p, set[i]));
    expect(both).toEqual([on(0.95), on(0.9), { found: false, score: 0.99 }, on(0.9), on(0.3)]);
    expect(eitherRead(null, undefined)).toBeNull();
    // Found on one post by its own search, on three by either read: the posts carry it, and it is never replaced.
    expect(postsCarrying([own, [on(0.8), on(0.2), on(0.2), on(0.85), on(0.2)]]).counts).toEqual([1, 2]);
    const counted = postsCarrying([both, [on(0.8), on(0.2), on(0.2), on(0.85), on(0.2)]]);
    expect(counted).toEqual({ by: [0, 0, null, 0, null], counts: [3, 0] });
    expect(chooseLogo(counted.counts[0], [{ id: "first", found: counted.counts[1] }])).toBeNull();
  });

  it("takes the earlier candidate on the page when two are carried by as many posts", () => {
    expect(chooseLogo(1, [{ id: "header", found: 3 }, { id: "footer", found: 3 }])).toBe("header");
  });
});

describe("a picture's size from its header", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(24);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x89504e47); v.setUint32(4, 0x0d0a1a0a); v.setUint32(8, 13); v.setUint32(12, 0x49484452); v.setUint32(16, w); v.setUint32(20, h);
    return b;
  };
  /** A JPEG as cameras and editors write it: an APP0 segment, a table, then the frame header. */
  const jpeg = (w: number, h: number, frame = 0xc0) => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
    const table = [0xff, 0xdb, 0x00, 0x05, 1, 2, 3];
    const sof = [0xff, frame, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, ...new Array(9).fill(0)];
    return new Uint8Array([0xff, 0xd8, ...app0, ...table, ...sof, 0xff, 0xd9]);
  };

  it("reads a PNG, a baseline and a progressive JPEG, and a GIF", () => {
    expect(imageSize(png(1080, 1350))).toEqual([1080, 1350]);
    expect(imageSize(jpeg(720, 900))).toEqual([720, 900]);
    expect(imageSize(jpeg(1080, 1350, 0xc2))).toEqual([1080, 1350]);
    const gif = new Uint8Array(13);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]);
    expect(imageSize(gif)).toEqual([800, 600]);
  });

  it("reads the three kinds of WebP", () => {
    const riff = (kind: string, fill: (b: Uint8Array, v: DataView) => void) => {
      const b = new Uint8Array(32);
      b.set([0x52, 0x49, 0x46, 0x46], 0); b.set([0x57, 0x45, 0x42, 0x50], 8); b.set([...kind].map((ch) => ch.charCodeAt(0)), 12);
      fill(b, new DataView(b.buffer));
      return b;
    };
    expect(imageSize(riff("VP8 ", (_b, v) => { v.setUint16(26, 640, true); v.setUint16(28, 800, true); }))).toEqual([640, 800]);
    expect(imageSize(riff("VP8L", (_b, v) => { v.setUint32(21, (640 - 1) | ((800 - 1) << 14), true); }))).toEqual([640, 800]);
    expect(imageSize(riff("VP8X", (b) => { b.set([0x7f, 0x02, 0x00], 24); b.set([0x1f, 0x03, 0x00], 27); }))).toEqual([640, 800]);
  });

  it("answers null for bytes that are no picture", () => {
    expect(imageSize(new TextEncoder().encode("<html><body>not here</body></html>"))).toBeNull();
    expect(imageSize(new Uint8Array(4))).toBeNull();
  });
});

describe("the placement from the rectangles where a logo was found", () => {
  const at = (x: number, y: number, width: number, height: number, frame: [number, number] = [1000, 1250]) => ({ rect: { x, y, width, height }, frame });

  it("has nothing to say with no rectangle", () => {
    expect(measuredPlacement([])).toBeNull();
    expect(measuredPlacement([at(0, 0, 0, 0)])).toBeNull();
  });

  it("puts a logo found in the middle of its posts in the center, at the middle top and width", () => {
    const p = measuredPlacement([at(440, 1100, 120, 40), at(430, 1125, 140, 46), at(445, 1150, 110, 36)]);
    expect(p).toEqual({ anchor: "center", width: 0.12, top: 0.9 });
  });

  it("anchors a logo at the side its posts put it, with the distance to that edge", () => {
    expect(measuredPlacement([at(50, 60, 200, 50), at(60, 50, 200, 50), at(40, 70, 200, 50)])).toEqual({ anchor: "left", width: 0.2, top: 0.048, left: 0.05 });
    expect(measuredPlacement([at(750, 60, 200, 50), at(740, 50, 200, 50), at(760, 70, 200, 50)])).toEqual({ anchor: "right", width: 0.2, top: 0.048, left: 0.05 });
  });

  it("reads each rectangle as shares of its own post, whatever the post's size", () => {
    const p = measuredPlacement([at(440, 1100, 120, 40, [1000, 1250]), at(220, 550, 60, 20, [500, 625]), at(880, 2200, 240, 80, [2000, 2500])]);
    expect(p).toEqual({ anchor: "center", width: 0.12, top: 0.88 });
  });

  it("moves the middle width only as far as needed for the found sizes to run from 0.55 to 1.2 of it", () => {
    // Five small ones and five large ones: the middle width alone would leave the large ones outside the sizes a design is searched at.
    const widths = [85, 85, 85, 85, 85, 126, 126, 161, 175, 177];
    const p = measuredPlacement(widths.map((w) => at(500 - w / 2, 1100, w, Math.round(w / 3))))!;
    expect(p.anchor).toBe("center");
    expect(p.width).toBe(0.148);
    for (const w of widths) {
      expect(w / (p.width * 1000)).toBeGreaterThanOrEqual(0.55);
      expect(w / (p.width * 1000)).toBeLessThanOrEqual(1.2);
      expect(logoFound({ width: w, score: 1 }, p.width * 1000)).toBe(true);
    }
    // Sizes close together are left at their middle.
    expect(measuredPlacement([100, 104, 110].map((w) => at(450, 100, w, 30)))!.width).toBe(0.104);
  });

  it("leaves the same room at both ends when the found sizes run wider than that", () => {
    const p = measuredPlacement([80, 120, 200].map((w) => at(500 - w / 2, 100, w, 30)))!;
    // 200 / 1.2 = 0.1667 and 80 / 0.55 = 0.1455: no width holds both, so the one between them.
    expect(p.width).toBe(0.156);
    for (const w of [80, 120, 200]) expect(logoFound({ width: w, score: 1 }, p.width * 1000)).toBe(true);
  });

  it("never puts the top so low that the logo leaves the post", () => {
    const p = measuredPlacement([at(300, 1200, 400, 50), at(300, 1200, 400, 50)])!;
    expect(p.top).toBeLessThanOrEqual(1 - (p.width * 1000 * (50 / 400)) / 1250 + 1e-9);
  });

  it("never puts the top so low that the logo leaves the page a design is drawn on, for posts taller than that page", () => {
    // Two 9:16 posts with the logo flush at the bottom. A design is 4:5 (1088 by 1360), where the same logo is taller as a share of the page.
    const p = measuredPlacement([at(340, 1820, 400, 100, [1080, 1920]), at(340, 1820, 400, 100, [1080, 1920])])!;
    const tall = (p.width * 1088 * (100 / 400)) / 1360;
    expect(p.top + tall).toBeLessThanOrEqual(1 + 1e-9);
    // A post of the page's own shape is not moved.
    expect(measuredPlacement([at(340, 1200, 400, 100, [1088, 1360]), at(340, 1200, 400, 100, [1088, 1360])])!.top).toBe(0.882);
  });
});
