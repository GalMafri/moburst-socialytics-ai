import { describe, expect, it } from "vitest";
import { harvestedPaths, libraryEntries, planLibrary, platformFirst, postLabel, referenceCounts, referencesFor } from "../../../supabase/functions/_shared/design-prompts/designRefs";

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
    expect(referencesFor(["c/manual.png"], harvest, 3, null)).toEqual(["c/manual.png", "c/h-new.png", "c/h-old.png"]);
  });
  it("keeps to the consumer's budget", () => {
    expect(referencesFor(["a.png", "b.png", "c.png", "d.png", "e.png"], harvest, 4, null)).toHaveLength(4);
    expect(referencesFor([], harvest, 1, null)).toEqual(["c/h-new.png"]);
  });
  it("never lists the same file twice", () => {
    expect(referencesFor(["c/h-new.png"], harvest, 5, null)).toEqual(["c/h-new.png", "c/h-old.png"]);
  });
  it("returns nothing when the client has nothing", () => {
    expect(referencesFor(null, null, 8, "Instagram")).toEqual([]);
  });
});

describe("referenceCounts", () => {
  it("counts the two pools separately, so the setup screen can tell staff which is missing", () => {
    expect(referenceCounts(["a.png"], harvest)).toEqual({ manual: 1, harvested: 2 });
    expect(referenceCounts(null, null)).toEqual({ manual: 0, harvested: 0 });
  });
});

// The library the design_refs step keeps: in turn across platforms, kept first, uploads first of all.
const library = [
  { path: "c/upload.png", upload: true, kept: true },
  { path: "c/ig-kept.jpg", platform: "Instagram", posted_at: "2026-06-20T15:00:00Z", quality_checked: true, kept: true },
  { path: "c/li-1.jpg", platform: "LinkedIn", posted_at: "2026-10-28T15:00:00Z", quality_checked: true },
  { path: "c/ig-1.jpg", platform: "Instagram", posted_at: "2026-10-30T15:00:00Z", quality_checked: true },
  { path: "c/li-2.jpg", platform: "LinkedIn", posted_at: "2026-10-12T15:00:00Z", quality_checked: true },
  { path: "c/ig-2.jpg", platform: "INSTAGRAM", posted_at: "2026-10-20T15:00:00Z", quality_checked: true },
];

describe("the library for one post", () => {
  it("leads with the post's platform, then the rest kept first, then newest first", () => {
    expect(referencesFor([], library, 16, "LinkedIn")).toEqual(["c/li-1.jpg", "c/li-2.jpg", "c/upload.png", "c/ig-kept.jpg", "c/ig-1.jpg", "c/ig-2.jpg"]);
    expect(referencesFor([], library, 16, "instagram")).toEqual(["c/ig-kept.jpg", "c/ig-1.jpg", "c/ig-2.jpg", "c/upload.png", "c/li-1.jpg", "c/li-2.jpg"]);
    // With no post, the library's own order.
    expect(referencesFor([], library, 3, null)).toEqual(["c/upload.png", "c/ig-kept.jpg", "c/li-1.jpg"]);
  });
  it("holds the uploads a person kept, and no older manual campaign fills spare slots", () => {
    expect(referencesFor(["c/upload.png", "c/old-campaign.png"], library, 16, "TikTok")).not.toContain("c/old-campaign.png");
    expect(referencesFor(["c/upload.png"], library, 16, "TikTok")[0]).toBe("c/upload.png");
  });
  it("names each platform the calendar's way", () => {
    expect(libraryEntries(library).map((e) => e.platform)).toEqual([null, "Instagram", "LinkedIn", "Instagram", "LinkedIn", "Instagram"]);
    expect(platformFirst(libraryEntries(library), "Facebook").map((e) => e.path)[0]).toBe("c/upload.png");
  });
});

describe("what the planner is told about each post", () => {
  it("labels each image with its platform and date, and says when the team kept or uploaded it", () => {
    const [upload, kept, li] = libraryEntries(library);
    expect(postLabel(3, li)).toBe("Post 3 (LinkedIn, Oct 28, 2026)");
    expect(postLabel(1, kept)).toBe("Post 1 (Instagram, Jun 20, 2026, kept by the team)");
    expect(postLabel(2, upload)).toBe("Post 2 (uploaded by the team)");
    expect(postLabel(4, null)).toBe("Post 4");
  });
  it("puts the request platform's posts first, and a path the library no longer describes last", () => {
    const planned = planLibrary(["c/gone.jpg", "c/ig-1.jpg", "c/li-1.jpg", "c/upload.png"], library, "LinkedIn");
    expect(planned.map((p) => p.path)).toEqual(["c/li-1.jpg", "c/upload.png", "c/ig-1.jpg", "c/gone.jpg"]);
    expect(planned[3].entry).toBeNull();
  });
});
