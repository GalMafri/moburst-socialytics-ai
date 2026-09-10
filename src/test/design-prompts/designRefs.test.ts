import { describe, expect, it } from "vitest";
import { harvestedPaths, referenceCounts, referencesFor } from "../../../supabase/functions/_shared/design-prompts/designRefs";

const harvest = [
  { path: "c/h-old.png", source_post_id: "1", posted_at: "2026-08-01T00:00:00Z" },
  { path: "c/h-new.png", source_post_id: "2", posted_at: "2026-09-01T00:00:00Z" },
];

describe("harvestedPaths", () => {
  it("puts the most recent post first", () => {
    expect(harvestedPaths(harvest)).toEqual(["c/h-new.png", "c/h-old.png"]);
  });
  it("copes with a plain list of paths and with nothing at all", () => {
    expect(harvestedPaths(["a.png", "b.png"])).toEqual(["a.png", "b.png"]);
    expect(harvestedPaths(null)).toEqual([]);
    expect(harvestedPaths({})).toEqual([]);
  });
});

describe("referencesFor", () => {
  it("leads with what staff chose and fills the rest from the harvest", () => {
    expect(referencesFor(["c/manual.png"], harvest, 3)).toEqual(["c/manual.png", "c/h-new.png", "c/h-old.png"]);
  });
  it("keeps to the consumer's budget", () => {
    expect(referencesFor(["a.png", "b.png", "c.png", "d.png", "e.png"], harvest, 4)).toHaveLength(4);
    expect(referencesFor([], harvest, 1)).toEqual(["c/h-new.png"]);
  });
  it("never lists the same file twice", () => {
    expect(referencesFor(["c/h-new.png"], harvest, 5)).toEqual(["c/h-new.png", "c/h-old.png"]);
  });
  it("returns nothing when the client has nothing", () => {
    expect(referencesFor(null, null, 8)).toEqual([]);
  });
});

describe("referenceCounts", () => {
  it("counts the two pools separately, so the setup screen can tell staff which is missing", () => {
    expect(referenceCounts(["a.png"], harvest)).toEqual({ manual: 1, harvested: 2 });
    expect(referenceCounts(null, null)).toEqual({ manual: 0, harvested: 0 });
  });
});
