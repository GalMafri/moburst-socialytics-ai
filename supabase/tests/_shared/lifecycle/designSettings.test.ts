import { describe, expect, it } from "vitest";
import { contrast, generatedMediaPath, inkColor, libraryPaths, logoNormalization, logoStorePlan, parseLogoSpot, pickBackground, placementFor, pngSize, referencePaths, toPlacement } from "../../../functions/_shared/lifecycle/designSettings";

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
  it("follows the library the design_refs step keeps, on a person's row as on the lifecycle's: an upload left out stays out", () => {
    // The library holds the uploads a person kept; one left out is in clients.design_references but not in the library.
    const library = [{ path: "c1/upload-kept.png", upload: true, kept: true }, { path: "c1/social-a.jpg", platform: "Instagram", quality_checked: true }];
    expect(libraryPaths(["c1/upload-kept.png", "c1/upload-left-out.png"], library)).toEqual(["c1/upload-kept.png", "c1/social-a.jpg"]);
    // Before there is a library: the uploads, then the posts found.
    expect(libraryPaths(["own.png"], [{ path: "a.jpg" }])).toEqual(["own.png", "a.jpg"]);
    expect(libraryPaths(null, Array.from({ length: 20 }, (_, i) => ({ path: `${i}.jpg`, quality_checked: true })))).toHaveLength(16);
  });
  it("knows a file in the project's generated-media bucket", () => {
    expect(generatedMediaPath("https://x.supabase.co/storage/v1/object/public/generated-media/Pay-The-Pyper/logo-1.png", "https://x.supabase.co")).toBe("Pay-The-Pyper/logo-1.png");
    expect(generatedMediaPath("https://cdn.example.com/logo.png", "https://x.supabase.co")).toBeNull();
  });
});

describe("logoNormalization", () => {
  /** An RGBA canvas of w by h with an opaque block at the given box. */
  const canvas = (w: number, h: number, ink: { x: number; y: number; w: number; h: number } | null) => {
    const px = new Uint8Array(w * h * 4);
    if (ink) for (let y = ink.y; y < ink.y + ink.h; y++) for (let x = ink.x; x < ink.x + ink.w; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
    return px;
  };

  it("trims a logo to where its ink is, so a mark on a padded canvas is stored as the mark", () => {
    const n = logoNormalization(canvas(400, 400, { x: 40, y: 134, w: 320, h: 128 }), 400, 400)!;
    expect(n.box).toEqual({ x: 40, y: 134, width: 320, height: 128 });
    expect(n.size).toEqual([320, 128]);
    expect(n.changed).toBe(true);
  });

  it("caps the long side at 1,200 pixels, keeping the proportions, and never makes a logo larger", () => {
    const wide = logoNormalization(canvas(2160, 2160, { x: 100, y: 800, w: 1800, h: 600 }), 2160, 2160)!;
    expect(wide.size).toEqual([1200, 400]);
    const small = logoNormalization(canvas(100, 100, { x: 0, y: 0, w: 100, h: 40 }), 100, 100)!;
    expect(small.size).toEqual([100, 40]);
  });

  it("leaves a logo that is already its ink alone, and answers null when nothing shows", () => {
    const full = logoNormalization(canvas(300, 100, { x: 0, y: 0, w: 300, h: 100 }), 300, 100)!;
    expect(full.changed).toBe(false);
    expect(logoNormalization(canvas(50, 50, null), 50, 50)).toBeNull();
  });
});

describe("logoStorePlan", () => {
  const canvas = (w: number, h: number, ink: { x: number; y: number; w: number; h: number } | null) => {
    const px = new Uint8Array(w * h * 4);
    if (ink) for (let y = ink.y; y < ink.y + ink.h; y++) for (let x = ink.x; x < ink.x + ink.w; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
    return px;
  };

  it("keeps a PNG that is already its ink alone and small enough", () => {
    expect(logoStorePlan(canvas(300, 100, { x: 0, y: 0, w: 300, h: 100 }), 300, 100, true)).toBeNull();
  });

  it("redraws a padded or oversized PNG from the box of its ink at the capped size", () => {
    expect(logoStorePlan(canvas(400, 400, { x: 40, y: 134, w: 320, h: 128 }), 400, 400, true)).toEqual({ box: { x: 40, y: 134, width: 320, height: 128 }, size: [320, 128] });
    expect(logoStorePlan(canvas(2160, 2160, { x: 100, y: 800, w: 1800, h: 600 }), 2160, 2160, true)).toMatchObject({ size: [1200, 400] });
  });

  it("always redraws a file that is not a PNG, trimmed when it can be and whole when nothing shows", () => {
    expect(logoStorePlan(canvas(300, 100, { x: 0, y: 0, w: 300, h: 100 }), 300, 100, false)).toMatchObject({ size: [300, 100] });
    expect(logoStorePlan(canvas(50, 40, null), 50, 40, false)).toEqual({ box: { x: 0, y: 0, width: 50, height: 40 }, size: [50, 40] });
  });
});
