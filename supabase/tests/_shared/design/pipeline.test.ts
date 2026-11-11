import { describe, it, expect } from "vitest";
import { copyMatches, logoCheckPrompt, marksPrompt, parseLogoCheck, parseMarks, parseRead, readable, removePrompt } from "../../../functions/_shared/design/pipeline";
import { coarseFactor, findLogo, logoFound, templateSize } from "../../../functions/_shared/design/logoMatch";

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

describe("findLogo cost", () => {
  // 10 Nov 2026: Pay The Pyper's logo is a square file of 2160 x 2160 px, drawn at 17% of the page width.
  // Finding it took about 4.3 s on a fast laptop (0.2 to 0.5 s for the other clients' wide logos) and the
  // edge runtime cut the step off, again and again, without a trace. About 0.7 s of that was the search
  // shrinking the whole file for every size it tried; the rest was the coarse search, which brute-forces
  // a template about 80 px wide: 12 times the work for a square logo drawn that small as for a wide one.
  const logoAt = (w: number, h: number) => {
    const px = new Uint8ClampedArray(w * h * 4);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.45;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ink = (d < r && d > r * 0.8) || (Math.abs(y - cy) < h * 0.06 && Math.abs(x - cx) < w * 0.3);
      px.set(ink ? [240, 200, 40, 255] : [0, 0, 0, 0], (y * w + x) * 4);
    }
    return px;
  };
  const W = 1088, H = 1360, bg: [number, number, number] = [26, 26, 26];
  const designWith = (logo: Uint8ClampedArray, lw: number, lh: number, at: { x: number; y: number; width: number; height: number }) => {
    const page = new Uint8ClampedArray(W * H * 4);
    let seed = 7;
    for (let i = 0; i < W * H; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = 26 + (seed >>> 28);
      page.set([v, v, v, 255], i * 4);
    }
    for (let y = 0; y < at.height; y++) for (let x = 0; x < at.width; x++) {
      const k = (Math.floor((y * lh) / at.height) * lw + Math.floor((x * lw) / at.width)) * 4;
      if (logo[k + 3]) page.set([logo[k], logo[k + 1], logo[k + 2], 255], ((at.y + y) * W + at.x + x) * 4);
    }
    return page;
  };
  /** One client's logo: its file, where the client usually puts it and where the model drew it (a little smaller, a little off). */
  const run = (file: [number, number], usual: { x: number; y: number; width: number; height: number }) => {
    const logo = logoAt(file[0], file[1]);
    const drawn = { x: usual.x + 12, y: usual.y + 8, width: Math.round(usual.width * 0.86), height: Math.round(usual.height * 0.86) };
    const design = designWith(logo, file[0], file[1], drawn);
    const t0 = performance.now();
    const found = findLogo(design, W, H, logo, file[0], file[1], usual, bg, { scales: [0.45, 1.35] });
    return { found, drawn, ms: performance.now() - t0 };
  };
  const square = { file: [2160, 2160] as [number, number], usual: { x: 451, y: 1120, width: 185, height: 185 } };
  const wide = { file: [701, 251] as [number, number], usual: { x: 192, y: 65, width: 352, height: 126 } };

  it("brings a logo file down to at most twice the widest size searched, and leaves a small file alone", () => {
    expect(templateSize(2160, 2160, 500)).toEqual([1000, 1000]);
    expect(templateSize(2000, 500, 500)).toEqual([1000, 250]);
    expect(templateSize(701, 251, 703)).toBeNull();
    expect(templateSize(1000, 400, 500)).toBeNull();
  });

  it("starts the coarse search at the same level as before for wide logos, so the clients that work today are searched as they were", () => {
    // Moburst, Bader Law and LegaBot at their usual widths on a 2176 px page.
    expect(coarseFactor(703, 252)).toBe(8);
    expect(coarseFactor(653, 112)).toBe(8);
    expect(coarseFactor(446, 152)).toBe(5);
  });

  it("keeps the coarse template to about the same area whatever the logo's shape, so a square or tall logo costs what a wide one does", () => {
    for (const [w, h] of [[370, 370], [200, 600], [900, 900], [150, 400], [1000, 100], [60, 60]]) {
      const f = coarseFactor(w, h);
      expect(f).toBeGreaterThanOrEqual(1);
      expect((w / f) * (h / f)).toBeLessThanOrEqual(3200);
    }
    expect(coarseFactor(370, 370)).toBeGreaterThan(Math.floor(370 / 80));
  });

  it("finds the same logo in the same place whether its file is 216 or 2160 px wide", () => {
    const usual = { x: 451, y: 1120, width: 185, height: 185 };
    const small = run([216, 216], usual).found, large = run([2160, 2160], usual).found;
    expect(Math.abs(large.x - small.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(large.y - small.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(large.width - small.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(large.score - small.score)).toBeLessThan(0.03);
  }, 60_000);

  it("still finds the drawn logo, at the size and place it was drawn, for a big square file and a small wide one", () => {
    for (const c of [square, wide]) {
      const { found, drawn } = run(c.file, c.usual);
      expect(Math.abs(found.x - drawn.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(found.y - drawn.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(found.width - drawn.width)).toBeLessThanOrEqual(3);
      expect(logoFound(found, c.usual.width)).toBe(true);
    }
  }, 60_000);

  it("takes about as long to find a big square logo as a wide one: the search does not grow with the logo's size or shape", () => {
    const best = (c: typeof square) => Math.min(run(c.file, c.usual).ms, run(c.file, c.usual).ms);
    const wideMs = best(wide), squareMs = best(square);
    expect(squareMs).toBeLessThan(wideMs * 3 + 150);
  }, 120_000);
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

describe("other brands' marks", () => {
  it("asks about real brands' marks on gear, and reads the answer even with quotes inside", () => {
    expect(marksPrompt("LegaBot")).toMatch(/stripes, a swoosh, a formstrip/);
    expect(parseMarks('{"marks": true, "where": "three white "stripes" on the green boot"}')).toEqual({ marks: true, where: 'three white "stripes" on the green boot' });
    expect(parseMarks('{"marks": false, "where": ""}')).toEqual({ marks: false, where: "" });
    expect(parseMarks("no")).toBeNull();
  });
  it("names the marks found in the next removal", () => {
    expect(removePrompt("LegaBot", "three white stripes on the green boot")).toContain("In particular remove this, leaving the surface plain: three white stripes on the green boot.");
    expect(removePrompt("LegaBot")).not.toContain("In particular");
  });
});

