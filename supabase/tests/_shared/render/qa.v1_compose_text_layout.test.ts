// P46-02/03/04: the v1 still composer (render/compose.ts, measure.ts).
import { describe, it, expect, vi } from "vitest";

vi.mock("https://esm.sh/opentype.js@1.3.4", () => { const ot = { parse: () => ({}) }; return { ...ot, default: ot }; });

import { compose } from "../../../functions/_shared/render/compose";
import { wordsOf } from "../../../functions/_shared/render/measure";

const font = { getAdvanceWidth: (text: string, size: number) => [...text].length * size * 0.55 };
const face = { regular: font, bold: font };
const system = { tokens: {
  font: { family: "Inter", body_weight: 400, emphasis_weight: 700, casing: "sentence" },
  colors: { ink: "#fff", surface: "#111", accent: "#0ff", background: "#000", frame: [] },
  card: { style: "glass", alpha: 0.6, radius_em: 0.5, border_alpha: 0.1 },
  frame: { style: "none", width_pct: 0.4 },
  logo: { asset_path: "x", position: "top-center", width_pct: { portrait: 28, square: 24, landscape: 16 } },
} } as any;
const spec = { safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 }, headlineScale: 0.08 } as any;
const tpl = (region: string, width_pct: number) => ({ id: "t", formats: ["4:5"], headline: { region, width_pct, max_lines: 3 }, hero_region: "background", card: true, frame: false } as any);
const base = { width: 1080, height: 1350, system, spec, heroHref: "data:,", logoHref: "data:,", logoAspect: 3 };
const tspans = (svg: string) => [...svg.matchAll(/<tspan x="([\d.]+)"[^>]*>([^<]*)<\/tspan>/g)].map((m) => ({ x: Number(m[1]), text: m[2] }));

describe("P46 v1 compose", () => {
  it("P46-02 keeps every headline word inside the card", () => {
    const out = compose(face, { ...base, template: tpl("left", 55), headline: "#SocialMediaMarketingStrategy wins" });
    const right = Math.max(...tspans(out.svg).map((t) => t.x + font.getAdvanceWidth(t.text, out.fontSize)));
    expect(right).toBeLessThanOrEqual(out.card.x + out.card.width);
  });

  it("P46-03 lays a Hebrew headline right to left (first word rightmost)", () => {
    const out = compose(face, { ...base, template: tpl("bottom", 100), headline: "שלום עולם" });
    const [first, second] = tspans(out.svg);
    expect(first.x).toBeGreaterThan(second.x);
  });

  it("P46-04 emphasis matching inside an earlier word does not split that word", () => {
    expect(wordsOf("Restart your art journey", "art").map((w) => w.text)).toEqual(["Restart", "your", "art", "journey"]);
  });
});
