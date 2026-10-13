import { describe, it, expect } from "vitest";
import { copyOperations, elementBox, inkBox, logoRect, pickLogoLayers, placementRegion, type Layer } from "./finish";

// Layers as Canva's editing transaction returned them for real designs on
// 13 Oct 2026 (Moburst run 3, LegaBot run 2), so the rules are pinned to what
// Magic Layers actually produces.
const MOBURST = { anchor: "center" as const, width: 0.323, top: 0.048 };
const LEGABOT = { anchor: "left" as const, width: 0.23, top: 0.029, left: 0.035 };

describe("placementRegion", () => {
  it("pads the client's habitual spot for a centred logo", () => {
    const [x0, y0, x1, y1] = placementRegion(MOBURST, 701, 251, 1088, 1360);
    expect(x0).toBeCloseTo(308.3, 0);
    expect(y0).toBeCloseTo(5.3, 0);
    expect(x1).toBeCloseTo(779.7, 0);
    expect(y1).toBeCloseTo(251.1, 0);
  });
  it("anchors a left logo at its margin", () => {
    const [x0, y0] = placementRegion(LEGABOT, 2054, 553, 1088, 1360);
    expect(x0).toBeCloseTo(38.08 - 60, 1);
    expect(y0).toBeCloseTo(39.44 - 60, 1);
  });
});

describe("pickLogoLayers", () => {
  const region = placementRegion(MOBURST, 701, 251, 1088, 1360);
  const layers: Layer[] = [
    { id: "wordmark", text: "moburst", box: elementBox({ containerElement: { position: { top: 83.67, left: 387 }, dimension: { width: 237.76, height: 78.09 } } }) },
    { id: "headline", text: "AI answers are changing how brands", box: elementBox({ containerElement: { position: { top: 201.29, left: 138.04 }, dimension: { width: 793.45, height: 175.42 } } }) },
    { id: "headline2", text: "get discovered.", box: elementBox({ containerElement: { position: { top: 368.56, left: 192.04 }, dimension: { width: 685.45, height: 113.22 } } }) },
    { id: "mark", box: [585, 34, 691, 136] },
    { id: "background", box: null },
    { id: "gem", box: [41, 510, 210, 663] },
  ];
  it("takes the drawn wordmark and mark, and nothing else", () => {
    expect(pickLogoLayers(layers, region, ["AI answers are changing how brands get discovered."]).map((l) => l.id)).toEqual(["wordmark", "mark"]);
  });
  it("never takes a copy layer that sits inside the logo region", () => {
    const tight: Layer[] = [{ id: "copy-in-region", text: "AI answers", box: [400, 120, 700, 180] }];
    expect(pickLogoLayers(tight, region, ["AI answers are changing how brands get discovered."])).toEqual([]);
  });
});

describe("copyOperations", () => {
  it("sets the exact copy and keeps the design's line breaks (Canva misread AI as Al)", () => {
    const r = copyOperations(
      [
        { id: "b", text: "get discovered.", box: [212, 420, 869, 523] },
        { id: "a", text: "Al answers are\nchanging how brands", box: [180, 261, 902, 425] },
      ],
      ["AI answers are changing how brands get discovered."],
    );
    expect(r).toEqual({ ops: [{ type: "replace_text", element_id: "a", text: "AI answers are\nchanging how brands" }] });
  });
  it("restores the copy's case and apostrophes across two copy lines", () => {
    const r = copyOperations(
      [
        { id: "h1", text: "The next sports league ", box: [110, 976, 971, 1091] },
        { id: "h2", text: "Won’t be managed.", box: [140, 1050, 940, 1184] },
        { id: "sub", text: "It’ll be computed.", box: [187, 1169, 894, 1303] },
      ],
      ["THE NEXT SPORTS LEAGUE WON'T BE MANAGED.", "It'll be computed."],
    );
    expect(r).toEqual({
      ops: [
        { type: "replace_text", element_id: "h1", text: "THE NEXT SPORTS LEAGUE" },
        { type: "replace_text", element_id: "h2", text: "WON'T BE MANAGED." },
        { type: "replace_text", element_id: "sub", text: "It'll be computed." },
      ],
    });
  });
  it("changes nothing when the design holds a different number of words", () => {
    const r = copyOperations([{ id: "x", text: "AI answers are changing", box: [0, 0, 10, 10] }], ["AI answers are changing how brands get discovered."]);
    expect(r).toEqual({ error: "The copy has 8 words; the design's text holds 4." });
  });
});

describe("inkBox and logoRect", () => {
  it("finds only the pixels the delete changed, inside the deleted layers", () => {
    const w = 20, h = 10;
    const before = new Uint8Array(w * h * 4).fill(10);
    const after = new Uint8Array(w * h * 4).fill(10);
    for (let y = 3; y <= 5; y++) for (let x = 6; x <= 13; x++) before[(y * w + x) * 4] = 250; // the drawn logo
    before[(9 * w + 19) * 4] = 250; // a change far outside the layers' boxes is ignored
    expect(inkBox(before, after, w, h, [[5, 2, 14, 6]])).toEqual([6, 3, 13, 5]);
  });
  it("puts the file at the drawn logo's width and centre, in the file's own proportions", () => {
    expect(logoRect([395, 51, 687, 148], 701, 251)).toEqual({ left: 395, top: 47, width: 293, height: 104.9 });
  });
});

import { canvasLogoRect, designPrompt } from "./brief";

describe("designPrompt", () => {
  it("is the instruction the 13 Oct proof used", () => {
    expect(designPrompt({ brand_name: "Moburst", platform: "Facebook", concept: "a glowing crystal brain on a glass pedestal" }, ["AI answers are changing how brands get discovered."], 3)).toBe(
      "The first image is the canvas for a new Moburst Facebook post (4:5). Its logo is final: keep it exactly as it is, where it is. " +
      "Design the whole post around it in the visual language of the other three images, which are Moburst's own posts. The picture shows a glowing crystal brain on a glass pedestal. " +
      "Headline, spelled exactly: \"AI answers are changing how brands get discovered.\" Add no other text and no other logo.",
    );
  });
  it("adds a second line when the copy has one", () => {
    expect(designPrompt({ brand_name: "LegaBot", platform: "Instagram", concept: "x" }, ["THE NEXT SPORTS LEAGUE WON'T BE MANAGED.", "It'll be computed."], 3))
      .toContain("Headline, spelled exactly: \"THE NEXT SPORTS LEAGUE WON'T BE MANAGED.\" Second line, spelled exactly: \"It'll be computed.\"");
  });
});

describe("canvasLogoRect", () => {
  it("places the logo where the proof's canvases had it", () => {
    expect(canvasLogoRect({ anchor: "center", width: 0.323, top: 0.048 }, 701, 251, 1088, 1360)).toEqual({ x: 368, y: 65, width: 351, height: 126 });
    expect(canvasLogoRect({ anchor: "left", width: 0.23, top: 0.029, left: 0.035 }, 2054, 553, 1088, 1360)).toEqual({ x: 38, y: 39, width: 250, height: 67 });
  });
});

import { resampleRGBA } from "./brief";

describe("resampleRGBA", () => {
  it("averages coverage, keeping colour where only some pixels are inked", () => {
    // 2x2 → 1x1: one opaque red pixel, three transparent ones.
    const src = [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(Array.from(resampleRGBA(src, 2, 2, 1, 1))).toEqual([255, 0, 0, 64]);
  });
});

describe("designPrompt for carousel slides", () => {
  const g = { brand_name: "Moburst", platform: "LinkedIn", concept: "a glass panel in deep space" };
  it("tells the cover it opens a series", () => {
    expect(designPrompt(g, ["Four checkpoints."], 3, { index: 0, count: 5, withCover: false })).toContain("the canvas for the cover, slide 1 of 5 of a new Moburst LinkedIn carousel");
  });
  it("hands every later slide the cover to follow", () => {
    const p = designPrompt(g, ["Checkpoint two."], 3, { index: 2, count: 5, withCover: true });
    expect(p).toContain("slide 3 of 5");
    expect(p).toContain("The second image is slide 1 of this same carousel");
    expect(p).toContain("the last three images, which are Moburst's own posts");
  });
});

import { composeOver } from "./finish";

describe("composeOver", () => {
  it("keeps the picture where the copy layer is empty and is opaque everywhere", () => {
    const pic = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const layer = new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 0]);
    expect(Array.from(composeOver(pic, layer, 2, 1))).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
  it("takes the layer where it is solid and blends its anti-aliased edges", () => {
    const pic = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const layer = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 51]);
    expect(Array.from(composeOver(pic, layer, 2, 1))).toEqual([255, 255, 255, 255, 51, 51, 51, 255]);
  });
});
