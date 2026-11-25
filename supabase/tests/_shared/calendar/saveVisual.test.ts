// Social AI sync, 18 Nov 2026: the calendar's save wrote a post's new visual
// into its revision only, so the post's "Visual:" line, which the calendar and
// a design read, kept the old one.
import { describe, expect, it } from "vitest";
import { saveCopy, type CopyPost, type CopyWrites, type IterationRow } from "../../../functions/_shared/calendar/saveCopy";

const CLIENT = "00000000-0000-4000-8000-000000000001";
const KEY = "plan:2026-11-09:instagram:1";
const NOW = new Date("2026-11-03T12:00:00.000Z");
const POST: CopyPost = { copy: "Captains pay last.", hashtags: [], cta: null, platform: "Instagram", format: "Single image", updated_at: "2026-11-03T10:00:00+00:00" };

function writes() {
  const updates: Array<Record<string, unknown>> = [];
  const iterations: IterationRow[] = [];
  const w: CopyWrites = {
    post: async () => POST,
    lastVersion: async () => 1,
    insertIteration: async (row) => { iterations.push(row); },
    updatePost: async (_c, _k, fields) => { updates.push(fields); return "2026-11-03T12:00:00.5+00:00"; },
  };
  return { w, updates, iterations };
}

describe("saving a post with its visual", () => {
  it("writes the new visual on the post as well as on its revision", async () => {
    const { w, updates, iterations } = writes();
    await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "Captains always pay last.", visualDirection: " Two skates crossed on the ice. ", source: "regeneration", userId: "u", now: NOW });
    expect(updates[0]).toMatchObject({ copy: "Captains always pay last.", visual_direction: "Two skates crossed on the ice." });
    expect(iterations[0].visual_direction).toBe(" Two skates crossed on the ice. ");
  });

  it("puts the old visual back when the revision cannot be written", async () => {
    const post: Record<string, unknown> = { ...POST, visual_direction: "A dim rink at night." };
    const w: CopyWrites = {
      post: async () => ({ ...post }) as CopyPost,
      lastVersion: async () => 1,
      insertIteration: async () => { throw new Error("insert failed"); },
      updatePost: async (_c, _k, fields) => { Object.assign(post, fields); return "2026-11-03T12:00:00.5+00:00"; },
    };
    await expect(saveCopy(w, { clientId: CLIENT, key: KEY, copy: "Captains pay last.", visualDirection: "Two skates crossed on the ice.", source: "regeneration", userId: "u", now: NOW })).rejects.toThrow("insert failed");
    expect(post.visual_direction).toBe("A dim rink at night.");
  });

  it("leaves the post's visual alone when the save carries none", async () => {
    const { w, updates } = writes();
    await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "Captains always pay last.", source: "calendar", userId: "u", now: NOW });
    expect(updates[0]).not.toHaveProperty("visual_direction");
  });
});
