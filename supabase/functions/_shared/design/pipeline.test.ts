import { describe, it, expect } from "vitest";
import { copyMatches, logoCheckPrompt, parseLogoCheck, parseRead, readable } from "./pipeline";
import { findLogo, logoFound } from "./logoMatch";

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
  // A 40x16 logo: a white bar with a dark notch, on a dark page.
  const lw = 40, lh = 16;
  const logo = new Uint8ClampedArray(lw * lh * 4);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const ink = !(x > 10 && x < 18 && y > 4 && y < 12) && (x < 30 || y < 8);
    logo.set(ink ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * lw + x) * 4);
  }
  const W = 320, H = 240;
  const pageWith = (sx: number, sy: number, sw: number, sh: number) => {
    const page = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) page.set([10, 12, 30, 255], i * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const lx = Math.floor((x * lw) / sw), ly = Math.floor((y * lh) / sh);
      if (logo[(ly * lw + lx) * 4 + 3]) page.set([255, 255, 255, 255], ((sy + y) * W + sx + x) * 4);
    }
    return page;
  };
  const usual = { x: 60, y: 30, width: 80, height: 32 };

  it("finds the logo the model drew smaller than usual, where it drew it", () => {
    // Drawn at 60% of the usual width, 6 px right and 4 px down of the usual spot.
    const r = findLogo(pageWith(66, 34, 48, 19), W, H, logo, lw, lh, usual, [10, 12, 30], { scales: [0.45, 1.15] });
    expect(Math.abs(r.x - 66)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y - 34)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.width - 48)).toBeLessThanOrEqual(3);
    expect(logoFound(r, usual.width)).toBe(true);
  });

  it("does not accept a design with no logo, or one drawn far larger than the client ever uses", () => {
    const blank = pageWith(0, 0, 0, 0);
    expect(logoFound(findLogo(blank, W, H, logo, lw, lh, usual, [10, 12, 30], { scales: [0.45, 1.15] }), usual.width)).toBe(false);
    const huge = findLogo(pageWith(50, 30, 160, 64), W, H, logo, lw, lh, usual, [10, 12, 30], { scales: [0.45, 1.15] });
    expect(logoFound(huge, usual.width)).toBe(false);
  });
});

describe("logo check", () => {
  it("asks about anything touching or crossing the logo, and reads a yes or no", () => {
    expect(logoCheckPrompt("Bader Law")).toMatch(/line, rule, border, frame.*touch or cross the logo/);
    expect(logoCheckPrompt("Bader Law")).toMatch(/background behind the logo is fine: photography/);
    expect(parseLogoCheck('{"clear": false, "touching": "a white frame line runs through it"}')).toEqual({ clear: false, touching: "a white frame line runs through it" });
    expect(parseLogoCheck('Sure: {"clear": true, "touching": ""}')).toEqual({ clear: true, touching: "" });
    expect(parseLogoCheck("it looks fine")).toBeNull();
    expect(parseLogoCheck('{"clear": false, "touching": "a glow behind the "L" of the wordmark"}')).toEqual({ clear: false, touching: 'a glow behind the "L" of the wordmark' });
  });
});

