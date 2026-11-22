// P46-01: a v2 (template-from-posts) frame draws the emphasised word glued to its neighbours.
// fillTemplate -> wrapSpans measures a space between every word, but only joins words of the
// same style with ' '; composeLayers then places each span at x += width(previous span), so no
// space is drawn where the style changes ("Grow yourbrandtoday").
import { describe, it, expect, vi } from "vitest";

// Every glyph is half the font size wide; bold the same, so the arithmetic is plain.
vi.mock("https://esm.sh/opentype.js@1.3.4", () => {
  const ot = { parse: () => ({ getAdvanceWidth: (text: string, size: number) => [...text].length * size * 0.5 }) };
  return { ...ot, default: ot };
});
vi.mock("https://esm.sh/@resvg/resvg-wasm@2.6.2", () => ({ Resvg: class {}, initWasm: async () => {} }));

import { Faces, composeLayers } from "../../../functions/_shared/render/layers";
import { composeFrameV2 } from "../../../functions/_shared/design-system/v2";

const template = {
  id: "t1", name: "t", source_path: "", score: 1, width: 1080, height: 1350, format: "4:5",
  fixed: [], hero: null, logo: null, faces: { primary: "Inter" },
  slots: [{ role: "headline", x: 100, y: 200, w: 880, h: 300, size: 40, lineHeight: 1.2, align: "left", weight: 400, color: "#fff", accent: "#f0f", maxLines: 3, sample: "" }],
} as any;

describe("P46-01 v2 emphasis spacing", () => {
  it("leaves a space before and after the emphasised word", () => {
    const faces = new Faces("Inter", { Inter: { 400: new Uint8Array(8), 700: new Uint8Array(8) } });
    const svg = composeLayers(composeFrameV2(template, faces, { headline: "Grow your brand today", emphasis: "brand" }, null), faces);
    const spans = [...svg.matchAll(/<tspan x="([\d.]+)"[^>]*>([^<]*)<\/tspan>/g)].map((m) => ({ x: Number(m[1]), text: m[2] }));
    expect(spans.map((s) => s.text)).toEqual(["Grow your", "brand", "today"]);
    const space = 20; // ' ' at 40px
    // Expected: "brand" starts after "Grow your" (180) plus a space; actual: right at 180.
    expect(spans[1].x).toBeGreaterThanOrEqual(spans[0].x + 180 + space);
  });
});
