import { describe, expect, it } from "vitest";
import { fakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { plannerLibrary } from "../../functions/design-request/library";

// Pay The Pyper's library as the design_refs step keeps it, and its settings row's paths.
const harvested = [
  { path: "c1/upload.png", upload: true, kept: true },
  { path: "c1/ig-1.jpg", platform: "Instagram", posted_at: "2026-10-30T15:00:00Z", quality_checked: true },
  { path: "c1/li-1.jpg", platform: "LinkedIn", posted_at: "2026-10-28T15:00:00Z", quality_checked: true, kept: true },
  { path: "c1/ig-2.jpg", platform: "Instagram", posted_at: "2026-10-21T15:00:00Z", quality_checked: true },
];
const paths = ["c1/upload.png", "c1/ig-1.jpg", "c1/li-1.jpg", "c1/ig-2.jpg", "c1/missing.jpg"];

function world() {
  const db = fakeDb({});
  for (const p of paths.slice(0, 4)) db.uploads.set(`design-references/${p}`, "image");
  return db;
}
const labels = (content: Array<{ type: string; text?: string }>) => content.filter((b) => b.type === "text").map((b) => b.text);

describe("the client's posts a design is planned from", () => {
  it("are labeled with platform and date, the request platform's posts first", async () => {
    const out = await plannerLibrary(world(), { paths, harvested, platform: "LinkedIn", max: 16 });
    expect(out.library).toEqual(["c1/li-1.jpg", "c1/upload.png", "c1/ig-1.jpg", "c1/ig-2.jpg"]);
    expect(labels(out.content)).toEqual([
      "Post 1 (LinkedIn, Oct 28, 2026, kept by the team):",
      "Post 2 (uploaded by the team):",
      "Post 3 (Instagram, Oct 30, 2026):",
      "Post 4 (Instagram, Oct 21, 2026):",
    ]);
    expect(out.content.filter((b) => b.type === "image")).toHaveLength(4);
    expect(out.otherPlatforms).toBe(true);
  });

  it("say nothing of other platforms when every post is the request's own", async () => {
    const out = await plannerLibrary(world(), { paths: ["c1/ig-1.jpg", "c1/ig-2.jpg"], harvested, platform: "Instagram", max: 16 });
    expect(out.otherPlatforms).toBe(false);
    expect(labels(out.content)).toEqual(["Post 1 (Instagram, Oct 30, 2026):", "Post 2 (Instagram, Oct 21, 2026):"]);
  });

  it("keep to the planner's budget, counted in posts that could be read", async () => {
    const out = await plannerLibrary(world(), { paths, harvested, platform: "TikTok", max: 2 });
    expect(out.library).toEqual(["c1/upload.png", "c1/li-1.jpg"]);
  });

  it("are a video's stills, numbered as stills, when the client's videos lead", async () => {
    const db = world();
    db.uploads.set("design-references/c1/frame-1.jpg", "image");
    const out = await plannerLibrary(db, { paths: ["c1/frame-1.jpg"], harvested, platform: "TikTok", max: 16, stills: true });
    expect(labels(out.content)).toEqual(["Still 1:"]);
    expect(out.otherPlatforms).toBe(false);
  });
});
