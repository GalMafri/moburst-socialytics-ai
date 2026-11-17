import { describe, expect, it } from "vitest";
import {
  contrast, generatedMediaPath, inkColor, libraryPaths, logoNormalization, logoStorePlan, parseLogoSpot, personKey, personOther, pickBackground, placementFor, pngSize, readInputs,
  referencePaths, storedSpotRead, toneKeyTail, toPlacement, weakestContrast,
} from "../../../functions/_shared/lifecycle/designSettings";

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
    expect(pickBackground(["#3bd4ff", "#0c1d2f", "#ffcc00"], [[255, 255, 255]])).toEqual({ hex: "#0C1D2F", from: "brand_color" });
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });
  it("falls back to a neutral ground when no brand color reaches 3:1", () => {
    expect(pickBackground(["#ffffff", "#f5f5f5"], [[250, 250, 250]])).toEqual({ hex: "#0B0E1A", from: "neutral" });
    expect(pickBackground(["#123456", "#abcdef"], null)).toEqual({ hex: "#123456", from: "brand_color" });
    expect(pickBackground(["#123456", "#abcdef"], [])).toEqual({ hex: "#123456", from: "brand_color" });
  });
  it("holds a brand color to the logo's weakest whole part, never to the average of its ink", () => {
    // Two green letters and a near-black one. Their average stands out on the near-black brand color; the near-black letter does not.
    const inks: Array<[number, number, number]> = [[59, 172, 85], [26, 25, 25]];
    expect(contrast([51, 136, 70], [26, 26, 26])).toBeGreaterThan(3);
    expect(weakestContrast(inks, [26, 26, 26])).toBeLessThan(1.1);
    expect(weakestContrast([], [26, 26, 26])).toBe(Infinity);
    // No brand color shows every part: the neutral of the ground the file was made for.
    expect(pickBackground(["#6BE468", "#02473D", "#1A1A1A"], inks, "light")).toEqual({ hex: "#FFFFFF", from: "neutral" });
    // Without the file's own ground, the neutral its weakest part shows best on.
    expect(pickBackground(["#6BE468", "#02473D", "#1A1A1A"], inks)).toEqual({ hex: "#FFFFFF", from: "neutral" });
    // An orange and purple mark with a black wordmark: its brand orange hides the orange half.
    expect(pickBackground(["#ff9d2f", "#5a19e9", "#a98cf7"], [[255, 146, 44], [0, 0, 0], [73, 0, 208]], "light")).toEqual({ hex: "#FFFFFF", from: "neutral" });
    // A brand color every part shows on is still taken, the one the weakest part shows best on.
    expect(pickBackground(["#233a5e", "#2ec4f1", "#f7c948"], [[252, 222, 65], [251, 103, 115], [253, 253, 253]], "dark")).toEqual({ hex: "#233A5E", from: "brand_color" });
    expect(pickBackground(["#d40f3d", "#ff6f91", "#ffcfda"], [[17, 18, 24]], "light")).toEqual({ hex: "#FFCFDA", from: "brand_color" });
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

describe("the stored read of the logo's spot", () => {
  const INPUTS = "refs:2026-10-19T10:00:00.000Z|logo:https://brand.test/logo.svg";
  const OLD_KEY = `${INPUTS}|colors:#111111,#222222,#333333`;
  const NEW_KEY = `${OLD_KEY}|site:|other:|tone:2`;
  const READ = { shown: true, at: "bottom-center" as const, width: 0.14 };
  const done = (inputs_key: string) => ({ inputs_key, done_at: "2026-11-01T08:00:00.000Z" });

  it("reads the refs and logo parts out of a key, and nothing out of a person's key", () => {
    expect(readInputs(OLD_KEY)).toBe(INPUTS);
    expect(readInputs(NEW_KEY)).toBe(INPUTS);
    // A logo address may hold a bar: the parts end at the colors.
    expect(readInputs("refs:r|logo:https://x.test/a|b.png|colors:,,|site:|other:|tone:2")).toBe("refs:r|logo:https://x.test/a|b.png");
    expect(readInputs("person")).toBeNull();
    expect(readInputs("person|logo:c1/logo.png|refs:r|site:|other:|tone:2")).toBeNull();
    expect(readInputs("")).toBeNull();
    expect(readInputs(null)).toBeNull();
  });

  it("reuses the stored read when it was made for these inputs", () => {
    const row = { source: "lifecycle", derived: { logo_read: READ, logo_read_for: INPUTS } };
    expect(storedSpotRead(row, null, INPUTS)).toEqual({ read: READ });
    // Whatever the step's row says: the record on the settings row is exact.
    expect(storedSpotRead(row, { inputs_key: "refs:other|logo:x|colors:", done_at: null }, INPUTS)).toEqual({ read: READ });
    // Made for other posts or another logo.
    expect(storedSpotRead(row, done(NEW_KEY), "refs:2026-11-10T10:00:00.000Z|logo:https://brand.test/logo.svg")).toBeNull();
    // A person's row is never read from, and no row means no read.
    expect(storedSpotRead({ ...row, source: "person" }, done(NEW_KEY), INPUTS)).toBeNull();
    expect(storedSpotRead(null, done(NEW_KEY), INPUTS)).toBeNull();
    expect(storedSpotRead({ source: "lifecycle", derived: null }, done(NEW_KEY), INPUTS)).toBeNull();
  });

  it("reuses a stored read that found no spot", () => {
    // A read that found no logo spot is kept as null: it stands for the default placement and is not asked again.
    expect(storedSpotRead({ source: "lifecycle", derived: { logo_read: null, logo_read_for: INPUTS } }, null, INPUTS)).toEqual({ read: null });
    expect(storedSpotRead({ source: "lifecycle", derived: { logo_read: null } }, done(OLD_KEY), INPUTS)).toEqual({ read: null });
    // No read was ever stored.
    expect(storedSpotRead({ source: "lifecycle", derived: { placement_from: "default" } }, done(OLD_KEY), INPUTS)).toBeNull();
  });

  it("reuses a read from before the record existed only when the step's row is done on the same posts and logo", () => {
    const row = { source: "lifecycle", derived: { logo_read: READ } };
    // The brand colors changed, or the tone rule arrived: the posts and the logo are the same.
    expect(storedSpotRead(row, done(OLD_KEY), INPUTS)).toEqual({ read: READ });
    expect(storedSpotRead(row, done(`${INPUTS}|colors:#999999,,`), INPUTS)).toEqual({ read: READ });
    // The posts or the logo changed since the step last finished.
    expect(storedSpotRead(row, done("refs:2026-09-01T10:00:00.000Z|logo:https://brand.test/logo.svg|colors:"), INPUTS)).toBeNull();
    expect(storedSpotRead(row, done("refs:2026-10-19T10:00:00.000Z|logo:https://brand.test/old.svg|colors:"), INPUTS)).toBeNull();
    expect(storedSpotRead(row, null, INPUTS)).toBeNull();
  });

  it("does not reuse a read after a run that failed before it finished", () => {
    // The step's row already holds the new key from a run that did not finish: the read on the settings row may be for older posts.
    const row = { source: "lifecycle", derived: { logo_read: READ } };
    expect(storedSpotRead(row, { inputs_key: NEW_KEY, done_at: null }, INPUTS)).toBeNull();
  });
});

describe("the tone part of the step's key", () => {
  const LOGO = "c1/design-settings/logo-site-aaaa.png";
  const person = { path: "c1/design-settings/logo-other-9.png", of: LOGO, at: "2026-11-16T09:00:00+00:00" };

  it("gives the key a tail that changes with the website's logo files and a person's second file in use", () => {
    expect(toneKeyTail(undefined, null)).toBe("|site:|other:|tone:2");
    expect(toneKeyTail([], { logo_path: LOGO, logo_set: null })).toBe("|site:|other:|tone:2");
    const one = toneKeyTail(["https://brand.test/logo-white.svg"], null);
    expect(one).toMatch(/^\|site:[0-9a-z]{4,8}\|other:\|tone:2$/);
    expect(toneKeyTail(["https://brand.test/logo-white.svg", "https://brand.test/b.png"], null)).not.toBe(one);
    expect(toneKeyTail(["https://brand.test/logo-white.svg"], null)).toBe(one);
    // Not a list of addresses: nothing.
    expect(toneKeyTail("x", null)).toBe("|site:|other:|tone:2");
    // A person's second file, while it belongs to the row's logo.
    expect(toneKeyTail([], { logo_path: LOGO, logo_set: { person } })).toBe(`|site:|other:${person.path}|tone:2`);
    expect(toneKeyTail([], { logo_path: "c1/newer-logo.png", logo_set: { person } })).toBe("|site:|other:|tone:2");
  });

  it("gives a person's row a key that changes with its logo and its second file", () => {
    const row = { logo_path: LOGO, placement: { anchor: "center" as const, width: 0.3, top: 0.05 }, logo_set: null };
    const key = personKey(row, "2026-10-19T10:00:00.000Z", []);
    expect(key).toBe(`person|logo:${LOGO}|refs:2026-10-19T10:00:00.000Z|at:center,0.3,0.05,|site:|other:|tone:2`);
    // Their logo, the posts as last learned, the website's logo files and their second file each move it.
    expect(personKey({ ...row, logo_path: "c1/newer-logo.png" }, "2026-10-19T10:00:00.000Z", [])).not.toBe(key);
    expect(personKey(row, "2026-11-10T10:00:00.000Z", [])).not.toBe(key);
    expect(personKey(row, "2026-10-19T10:00:00.000Z", ["https://brand.test/logo-white.svg"])).not.toBe(key);
    expect(personKey({ ...row, logo_set: { person } }, "2026-10-19T10:00:00.000Z", [])).toBe(`person|logo:${LOGO}|refs:2026-10-19T10:00:00.000Z|at:center,0.3,0.05,|site:|other:${person.path}|tone:2`);
    // Where they put the logo is where their posts are searched, so it is part of the key too.
    expect(personKey({ ...row, placement: { anchor: "left" as const, width: 0.3, top: 0.05, left: 0.05 } }, "2026-10-19T10:00:00.000Z", [])).toContain("|at:left,0.3,0.05,0.05|");
    // Their background is not: a job reads it from the row itself.
    expect(personKey({ ...row, background: "#101010" } as never, "2026-10-19T10:00:00.000Z", [])).toBe(key);
    // The read of the logo's spot is never taken from a person's key.
    expect(readInputs(key)).toBeNull();
  });

  it("knows a person's second file only while it belongs to the row's logo", () => {
    expect(personOther({ logo_path: LOGO, logo_set: { person } })).toEqual(person);
    expect(personOther({ logo_path: "c1/newer-logo.png", logo_set: { person } })).toBeNull();
    expect(personOther({ logo_path: LOGO, logo_set: { of: LOGO } })).toBeNull();
    expect(personOther({ logo_path: LOGO, logo_set: { person: { path: "", of: LOGO } } })).toBeNull();
    expect(personOther(null)).toBeNull();
  });
});
