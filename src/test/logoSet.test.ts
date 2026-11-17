import { describe, expect, it } from "vitest";
import { logoSetView } from "@/lib/logoSet";

// What the design settings card shows of a row's logo set: one tile for
// each kind of picture a file of the client's serves, where each file came
// from, the logo in white, and the one control for a file of the team's own.

const LOGO = "c1/design-settings/logo-site-aaaa.png";
const OTHER = "c1/design-settings/logo-0123456789abcdef-other.png";
const WHITE = "c1/design-settings/logo-0123456789abcdef-white.png";
const PERSON = "c1/design-settings/logo-other-9.png";
const SITE = "c1/design-settings/logo-site-bbbb.png";
const AT = "2026-11-16T09:00:00.000Z";

const set = (over: Record<string, unknown> = {}) => ({
  of: LOGO, rule: 2, own: "light", both: false, inks: [[23, 87, 132]], other: null, white: null, made: { other: OTHER, white: WHITE }, site: null,
  posts: { read: 8, found: 0, shown: { stored: 0, other: 0, white: 0 } }, canvas: { file: "stored", ground: "#FFCFDA", from: "settings" }, at: AT, ...over,
});
const row = (logo_set: unknown, over: Record<string, unknown> = {}) => ({ logo_path: LOGO, background: "#FFCFDA", source: "lifecycle", logo_set, ...over });
const view = (logo_set: unknown, over: Record<string, unknown> = {}) => logoSetView(row(logo_set, over));
const tile = (v: ReturnType<typeof logoSetView>, key: string) => v.tiles.find((t) => t.key === key);
const NOTHING = { tiles: [], control: null };

describe("the card's view of a logo set", () => {
  it("shows nothing before the set exists or when it belongs to another logo", () => {
    expect(logoSetView(null)).toEqual(NOTHING);
    expect(view(null)).toEqual(NOTHING);
    expect(view(undefined)).toEqual(NOTHING);
    expect(view(set({ of: "c1/older-logo.png" }))).toEqual(NOTHING);
    // A set of a version of the rule that is not read is not shown.
    expect(view({ ...set(), rule: 3 })).toEqual(NOTHING);
    expect(view({ ...set(), rule: undefined })).toEqual(NOTHING);
    // A set of the rule before is shown until the lifecycle has made it again: its files are the same, so no tile goes away and comes back.
    expect(view({ ...set(), rule: 1, inks: undefined })).toEqual(view(set()));
    expect(view({ ...set(), rule: 1, inks: undefined }).tiles.length).toBeGreaterThan(0);
    // A person's second file saved before any set was made: nothing yet.
    expect(view({ person: { path: PERSON, of: LOGO, at: AT } })).toEqual(NOTHING);
  });

  it("puts the stored file on its own ground and the second file on the other, with where each came from", () => {
    // A dark logo and the light copy the client's posts show.
    const made = view(set({ other: { path: OTHER, from: "made", size: [300, 90] } }));
    expect(tile(made, "light")).toEqual({ key: "light", label: "Logo on light pictures", path: LOGO, ground: "#FFFFFF", caption: "The client's logo file" });
    expect(tile(made, "dark")).toEqual({ key: "dark", label: "Logo on dark pictures", path: OTHER, ground: "#0B0E1A", caption: "A light version of it" });
    expect(made.tiles.map((t) => t.key)).toEqual(["light", "dark"]);
    // A light logo and its dark copy.
    const dark = view(set({ own: "dark", other: { path: OTHER, from: "made", size: [300, 90] } }));
    expect(tile(dark, "dark")).toMatchObject({ path: LOGO, caption: "The client's logo file" });
    expect(tile(dark, "light")).toMatchObject({ path: OTHER, caption: "A dark version of it" });
    // The brand's own file from its website.
    expect(tile(view(set({ other: { path: SITE, from: "site", size: [640, 190] }, site: SITE })), "dark")).toMatchObject({ path: SITE, caption: "From the client's website" });
  });

  it("shows the stored file on both grounds when it shows on both", () => {
    const v = view(set({ own: "dark", both: true }));
    expect(tile(v, "dark")).toMatchObject({ path: LOGO, caption: "The client's logo file" });
    expect(tile(v, "light")).toMatchObject({ path: LOGO, caption: "The client's logo file" });
  });

  it("shows no tile for pictures no file serves", () => {
    // A dark logo with no second file: it is shown on light pictures, and nothing stands in for dark ones.
    expect(view(set()).tiles).toEqual([{ key: "light", label: "Logo on light pictures", path: LOGO, ground: "#FFFFFF", caption: "The client's logo file" }]);
    expect(view(set({ own: "dark" })).tiles.map((t) => t.key)).toEqual(["dark"]);
    // No tile is ever without a file.
    for (const own of ["light", "dark"]) for (const both of [true, false]) for (const white of [null, { path: WHITE }]) {
      for (const t of view(set({ own, both, white })).tiles) expect(t.path).toBeTruthy();
    }
  });

  it("names the one control for the pictures the client's logo file was not made for", () => {
    expect(view(set()).control).toEqual({ label: "Choose a file for dark pictures", removable: false });
    expect(view(set({ own: "dark" })).control).toEqual({ label: "Choose a file for light pictures", removable: false });
    // The same control when a file already serves those pictures: a file of the team's own takes its place.
    expect(view(set({ other: { path: OTHER, from: "made", size: [300, 90] } })).control).toEqual({ label: "Choose a file for dark pictures", removable: false });
    expect(view(set({ own: "dark", both: true })).control).toEqual({ label: "Choose a file for light pictures", removable: false });
    // A row a person set has the control too.
    expect(view(set(), { source: "person" }).control).toEqual({ label: "Choose a file for dark pictures", removable: false });
  });

  it("shows a person's file from the moment it is saved, and lets it be removed", () => {
    const person = { path: PERSON, of: LOGO, at: AT };
    // Saved a moment ago: the set still holds the copy, and the tile already shows their file.
    const saved = view(set({ other: { path: OTHER, from: "made", size: [300, 90] }, person }));
    expect(tile(saved, "dark")).toEqual({ key: "dark", label: "Logo on dark pictures", path: PERSON, ground: "#0B0E1A", caption: "Set by your team" });
    expect(saved.control).toEqual({ label: "Choose a file for dark pictures", removable: true });
    // Settled with it.
    expect(tile(view(set({ other: { path: PERSON, from: "person", size: [500, 200] }, person })), "dark")).toMatchObject({ path: PERSON, caption: "Set by your team" });
    // Put beside an older main logo: not used, and the tile shows what the set holds.
    const older = view(set({ other: { path: OTHER, from: "made", size: [300, 90] }, person: { ...person, of: "c1/older-logo.png" } }));
    expect(tile(older, "dark")).toMatchObject({ path: OTHER, caption: "A light version of it" });
    expect(older.control?.removable).toBe(false);
    // Removed a moment ago: the set still names their file until it is settled again, and no tile shows it.
    expect(view(set({ other: { path: PERSON, from: "person", size: [500, 200] } })).tiles.map((t) => t.key)).toEqual(["light"]);
    expect(tile(view(set({ own: "dark", both: true, other: { path: PERSON, from: "person", size: [500, 200] } })), "light")).toMatchObject({ path: LOGO, caption: "The client's logo file" });
  });

  it("shows the white file only when the set has one", () => {
    expect(tile(view(set()), "white")).toBeUndefined();
    const v = view(set({ own: "dark", both: true, white: { path: WHITE } }));
    expect(tile(v, "white")).toEqual({ key: "white", label: "Logo in white", path: WHITE, ground: "#0B0E1A", caption: "A white version of it" });
    expect(v.tiles.map((t) => t.key)).toEqual(["light", "dark", "white"]);
  });

  it("shows the same tiles for a row the lifecycle wrote and a row a person set, and nothing of how a design is started", () => {
    const fromPosts = set({ other: { path: OTHER, from: "made", size: [300, 90] }, canvas: { file: "other", ground: "#0F294C", from: "client_posts" } });
    expect(view(fromPosts).tiles).toEqual(view(fromPosts, { source: "person" }).tiles);
    expect(view(fromPosts).tiles.map((t) => t.key)).toEqual(["light", "dark"]);
  });
});
