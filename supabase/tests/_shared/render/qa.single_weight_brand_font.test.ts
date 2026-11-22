// P46-05: a brand face Google serves at 400 only (Bebas Neue, Anton, ...) passes the design-system
// check (fontAvailable asks for 400), but renderStill always fetches 700 too and throws, so every
// v1 preview and frame of that client fails. P46-06: a v2 face with no loaded weight crashes measuring.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("https://esm.sh/opentype.js@1.3.4", () => {
  const ot = { parse: () => ({ getAdvanceWidth: (t: string, s: number) => t.length * s * 0.5 }) };
  return { ...ot, default: ot };
});
vi.mock("https://esm.sh/@resvg/resvg-wasm@2.6.2", () => ({
  initWasm: async () => {},
  Resvg: class { render() { return { asPng: () => new Uint8Array([1]) }; } },
}));

import { fontAvailable } from "../../../functions/_shared/render/fonts";
import { renderStill } from "../../../functions/_shared/render/render";
import { Faces, cssWeight } from "../../../functions/_shared/render/layers";
import { drawable } from "../../../functions/_shared/render/measure";

const db = { storage: { from: () => ({
  download: async () => ({ data: null }),
  upload: async () => ({ error: null }),
}) } };
// Google css2 answers 400 for a weight the family does not have.
const fetchStub = vi.fn(async (url: string) => {
  if (url.includes("fonts.googleapis.com")) return url.includes("wght@400") ? new Response("src: url(https://fonts.gstatic.com/x.ttf) format('truetype');") : new Response("bad", { status: 400 });
  return new Response(new Uint8Array([0, 1, 0, 0]));
});
afterEach(() => vi.unstubAllGlobals());
// jsdom has no AbortSignal.timeout (Deno does); give it one so fonts.ts runs as deployed.
if (!(AbortSignal as any).timeout) (AbortSignal as any).timeout = () => new AbortController().signal;

const input = {
  width: 1080, height: 1350, heroHref: "data:,", logoHref: "data:,", logoAspect: 3, headline: "Hello world",
  spec: { safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 }, headlineScale: 0.08 },
  template: { id: "t", formats: ["4:5"], headline: { region: "bottom", width_pct: 100, max_lines: 3 }, hero_region: "background", card: true, frame: false },
  system: { tokens: {
    font: { family: "Bebas Neue", body_weight: 400, emphasis_weight: 700, casing: "upper" },
    colors: { ink: "#fff", surface: "#111", accent: "#0ff", background: "#000", frame: [] },
    card: { style: "solid", alpha: 1, radius_em: 0.5, border_alpha: 0.1 }, frame: { style: "none", width_pct: 0 },
    logo: { asset_path: "x", position: "top-center", width_pct: { portrait: 28, square: 24, landscape: 16 } },
  } },
} as any;

describe("P46 fonts", () => {
  it("P46-05 renders a still in a family that the design-system check accepted", async () => {
    vi.stubGlobal("fetch", fetchStub);
    expect(await fontAvailable("Bebas Neue")).toBe(true);
    await expect(renderStill(db, input)).resolves.toMatchObject({ png: expect.any(Uint8Array) });
  });

  it("P46-06 measures a span whose face loaded no weight with the default face", () => {
    const faces = new Faces("Inter", { Inter: { 400: new Uint8Array(4) }, Oswald: {} });
    expect(() => faces.advance("Hi", 40, 400, "Oswald")).not.toThrow();
  });
});

// P46-08 (suspected): measured with the weight the rasteriser draws, by the CSS matching rule.
describe("P46 weight fallback", () => {
  it("measures 600 with 700 when only 500 and 700 are loaded, as CSS matching draws it", () => {
    expect(cssWeight([500, 700], 600)).toBe(700);
    expect(cssWeight([300, 700], 400)).toBe(300);
    expect(cssWeight([400, 700], 500)).toBe(400);
    expect(cssWeight([400, 700], 300)).toBe(400);
    expect(cssWeight([400, 600], 700)).toBe(600);
    expect(cssWeight([300, 400, 500, 600, 700], 600)).toBe(600);
  });
});

// P46-07 (suspected): emoji the brand face cannot draw are taken out before measuring and drawing.
describe("P46 emoji outside the brand face", () => {
  const latin = { charToGlyphIndex: (ch: string) => (/[\p{L}\p{N}\s!©]/u.test(ch) ? 1 : 0), getAdvanceWidth: (t: string, s: number) => [...t].length * s * 0.5 };
  it("drops an emoji and its selector, keeps a sign the face has and every letter", () => {
    expect(drawable("Launch day 🚀 is here ❤️!", [latin])).toBe("Launch day is here !");
    expect(drawable("Acme© 2026", [latin])).toBe("Acme© 2026");
    expect(drawable("שלום", [latin])).toBe("שלום");
    // A face with no glyph table to ask (a test stand-in) changes nothing.
    expect(drawable("Hi 🚀", [{}])).toBe("Hi 🚀");
  });
});
