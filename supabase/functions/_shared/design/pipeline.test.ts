import { describe, it, expect } from "vitest";
import { copyMatches, parseRead, readable } from "./pipeline";
import { findLogo } from "./logoMatch";

describe("copyMatches", () => {
  it("accepts the headline set in capitals, with typographic apostrophes, over any line breaks", () => {
    expect(copyMatches(["THE NEXT LEAGUE WON’T BE MANAGED.", "IT’LL BE COMPUTED."], ["THE NEXT LEAGUE WON'T BE MANAGED.", "IT'LL BE COMPUTED."])).toBe(true);
    expect(copyMatches(["Search and AI Visibility", "Need Different Habits", "Winning teams build both."], ["Search and AI Visibility Need Different Habits", "Winning teams build both."])).toBe(true);
  });
  it("rejects a misspelled, missing or added word", () => {
    expect(copyMatches(["Results matter.", "Standards mater first."], ["Results matter.", "Standards matter first."])).toBe(false);
    expect(copyMatches(["Results matter."], ["Results matter.", "Standards matter first."])).toBe(false);
    expect(copyMatches(["Results matter.", "Standards matter first.", "Learn more"], ["Results matter.", "Standards matter first."])).toBe(false);
  });
  it("rejects a misread letter such as AI read as Al", () => {
    expect(copyMatches(["Search and Al Visibility"], ["Search and AI Visibility"])).toBe(false);
  });
});

describe("parseRead", () => {
  it("reads the lines out of the reply, and nothing out of a reply that is not JSON", () => {
    expect(parseRead('Here you go: {"lines":["One","Two"]}')).toEqual(["One", "Two"]);
    expect(parseRead("no text found")).toBeNull();
  });
  it("normalizes only what a reader would not notice", () => {
    expect(readable("  It’s  “fine” — really ")).toBe(`it's "fine" - really`);
  });
});

describe("findLogo", () => {
  it("finds a logo drawn away from its canvas spot and at another size", () => {
    // A 40x16 logo: a white bar with a dark notch, on a dark page.
    const lw = 40, lh = 16;
    const logo = new Uint8ClampedArray(lw * lh * 4);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const ink = !(x > 10 && x < 18 && y > 4 && y < 12) && (x < 30 || y < 8);
      logo.set(ink ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * lw + x) * 4);
    }
    // The page: the logo drawn 1.25x larger, 14 px right and 9 px down of where the canvas had it.
    const W = 320, H = 240, sx = 60 + 14, sy = 30 + 9, sw = 50, sh = 20;
    const page = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) page.set([10, 12, 30, 255], i * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const lx = Math.floor((x * lw) / sw), ly = Math.floor((y * lh) / sh);
      if (logo[(ly * lw + lx) * 4 + 3]) page.set([255, 255, 255, 255], ((sy + y) * W + sx + x) * 4);
    }
    const r = findLogo(page, W, H, logo, lw, lh, { x: 60, y: 30, width: 40, height: 16 }, [10, 12, 30]);
    expect(Math.abs(r.x - sx)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y - sy)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.width - sw)).toBeLessThanOrEqual(3);
    expect(r.score).toBeGreaterThan(0.9);
  });
});
