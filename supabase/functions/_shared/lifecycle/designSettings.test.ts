import { describe, expect, it } from "vitest";
import { contrast, generatedMediaPath, inkColor, parseLogoSpot, pickBackground, placementFor, pngSize, referencePaths, toPlacement } from "./designSettings";

describe("placement", () => {
  it("is the design settings card's placement for a spot, width and edge", () => {
    // A top-center logo at 30% of the width, as Bader's settings hold it.
    expect(toPlacement("top-center", 0.3, 0.05, 3)).toEqual({ anchor: "center", width: 0.3, top: 0.05 });
    const left = toPlacement("bottom-left", 0.2, 0.04, 4);
    expect(left.anchor).toBe("left");
    expect(left.left).toBeCloseTo(0.04 * (1360 / 1088), 3);
    expect(left.top).toBeCloseTo(1 - 0.04 - (0.2 * 1088) / 4 / 1360, 3);
  });
  it("reads the spot from the client's posts, and falls back to the card's starting values", () => {
    expect(placementFor({ shown: true, at: "top-right", width: 0.18 }, 2)).toMatchObject({ from: "client_posts", placement: { anchor: "right", width: 0.18 } });
    expect(placementFor({ shown: false, at: null, width: null }, 2)).toMatchObject({ from: "default", placement: { anchor: "center", width: 0.25, top: 0.04 } });
  });
  it("parses the read with the video read's bounds", () => {
    expect(parseLogoSpot('Here: {"logo":"shown","logo_at":"bottom-center","logo_width":0.22,"posts_with_logo":5}')).toEqual({ shown: true, at: "bottom-center", width: 0.22 });
    expect(parseLogoSpot('{"logo":"shown","logo_at":"middle","logo_width":2}')).toEqual({ shown: true, at: null, width: null });
    expect(parseLogoSpot("no json")).toBeNull();
  });
});

describe("background", () => {
  it("takes the brand color that sets the logo's ink off best", () => {
    // A white logo: the dark navy wins over the bright accents.
    expect(pickBackground(["#3bd4ff", "#0c1d2f", "#ffcc00"], [255, 255, 255])).toEqual({ hex: "#0C1D2F", from: "brand_color" });
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });
  it("falls back to a neutral ground when no brand color reaches 3:1", () => {
    expect(pickBackground(["#ffffff", "#f5f5f5"], [250, 250, 250])).toEqual({ hex: "#0B0E1A", from: "neutral" });
    expect(pickBackground(["#123456", "#abcdef"], null)).toEqual({ hex: "#123456", from: "brand_color" });
  });
  it("averages only the logo's visible ink", () => {
    expect(inkColor([255, 0, 0, 255, 0, 0, 255, 0])).toEqual([255, 0, 0]);
    expect(inkColor([1, 2, 3, 0])).toBeNull();
  });
});

describe("files", () => {
  it("reads a PNG's size from its header", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 64]);
    expect(pngSize(png)).toEqual([256, 64]);
    expect(pngSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
  it("lists a person's uploads first, then the posts found on the client's accounts, at most 16", () => {
    expect(referencePaths(["own.png"], [{ path: "a.jpg" }, { path: "own.png" }, {}])).toEqual(["own.png", "a.jpg"]);
    expect(referencePaths(null, Array.from({ length: 20 }, (_, i) => ({ path: `${i}.jpg` })))).toHaveLength(16);
  });
  it("knows a file in the project's generated-media bucket", () => {
    expect(generatedMediaPath("https://x.supabase.co/storage/v1/object/public/generated-media/Pay-The-Pyper/logo-1.png", "https://x.supabase.co")).toBe("Pay-The-Pyper/logo-1.png");
    expect(generatedMediaPath("https://cdn.example.com/logo.png", "https://x.supabase.co")).toBeNull();
  });
});
