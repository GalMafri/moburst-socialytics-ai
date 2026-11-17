import { describe, expect, it } from "vitest";
import { brandColors, brandColorsLine } from "../../../functions/_shared/design/brandLook";

// The facts the app holds about a client's colors, given to the planner so
// the look it builds on is anchored in them (17 Nov 2026).

const set = (over: Record<string, unknown> = {}) => ({
  of: "c1/logo.png", rule: 2, own: "light", both: false, inks: [[11, 31, 58], [214, 40, 40]],
  canvas: { file: "stored", ground: "#FFFFFF", from: "client_posts" }, ...over,
});
const settings = (over: Record<string, unknown> = {}) => ({
  logo_path: "c1/logo.png", background: "#0b1f3a", source: "lifecycle", derived: { background_from: "brand_color" }, logo_set: set(), ...over,
});
const identity = { primary_color: "#0b1f3a", secondary_color: "D62828", accent_color: "#ffffff", tone_of_voice: "direct" };

describe("brandColors", () => {
  it("reads the brand colors, the logo's inks, the ground the posts show the logo on and the settings background", () => {
    expect(brandColors(settings(), identity)).toEqual({
      brand: ["#0B1F3A", "#D62828", "#FFFFFF"], logo: ["#0B1F3A", "#D62828"], logoGround: "#FFFFFF", background: "#0B1F3A",
    });
  });

  it("keeps only what is a color, each once", () => {
    expect(brandColors(settings({ logo_set: null }), { primary_color: "navy", secondary_color: "#0B1F3A", accent_color: "#0b1f3a" }).brand).toEqual(["#0B1F3A"]);
    expect(brandColors(settings({ logo_set: set({ inks: [[11, 31, 58], [11, 31, 58], [300, 0, 0], "x", [1, 2]] }) }), null).logo).toEqual(["#0B1F3A"]);
    expect(brandColors(settings({ background: "white" }), null).background).toBeNull();
  });

  it("reads nothing from a logo set made for another logo file", () => {
    const c = brandColors(settings({ logo_set: set({ of: "c1/old-logo.png" }) }), identity);
    expect(c.logo).toEqual([]);
    expect(c.logoGround).toBeNull();
  });

  it("takes the logo's ground only when the client's posts gave it", () => {
    for (const from of ["settings", "pole"]) expect(brandColors(settings({ logo_set: set({ canvas: { file: "stored", ground: "#FFFFFF", from } }) }), identity).logoGround).toBeNull();
  });

  it("leaves out a background that is only a neutral chosen for the logo to show on, and keeps a person's", () => {
    expect(brandColors(settings({ derived: { background_from: "neutral" } }), identity).background).toBeNull();
    expect(brandColors(settings({ source: "person", derived: null }), identity).background).toBe("#0B1F3A");
  });

  it("holds nothing for a client with no settings facts", () => {
    expect(brandColors(null, undefined)).toEqual({ brand: [], logo: [], logoGround: null, background: null });
    expect(brandColors({}, "x")).toEqual({ brand: [], logo: [], logoGround: null, background: null });
  });
});

describe("brandColorsLine", () => {
  it("states every fact once, and how to use them to tell a one-off", () => {
    expect(brandColorsLine("Northwind", brandColors(settings(), identity))).toBe(
      "What the app holds about Northwind's colors: its brand colors are #0B1F3A, #D62828 and #FFFFFF; its logo is in #0B1F3A and #D62828; its posts show the logo on #FFFFFF; its designs start from a #0B1F3A background. " +
      "Use them to tell the shared look from a one-off: when most of the posts are in these colors, a post whose grounds, bands and type are in none of them is a one-off.",
    );
  });

  it("states only the facts there are", () => {
    expect(brandColorsLine("Northwind", { brand: ["#0B1F3A"], logo: [], logoGround: null, background: null })).toContain("What the app holds about Northwind's colors: its brand colors are #0B1F3A. Use them");
    expect(brandColorsLine("Northwind", { brand: [], logo: ["#0B1F3A", "#D62828", "#FFFFFF"], logoGround: null, background: null })).toContain("colors: its logo is in #0B1F3A, #D62828 and #FFFFFF. Use them");
  });

  it("is empty when the app holds no color, so the planner is told nothing it cannot rely on", () => {
    expect(brandColorsLine("Northwind", { brand: [], logo: [], logoGround: null, background: null })).toBe("");
  });

  it("is one line", () => {
    expect(brandColorsLine("Northwind", brandColors(settings(), identity)).includes("\n")).toBe(false);
  });
});
