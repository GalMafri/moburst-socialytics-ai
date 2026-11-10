// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VIDEO_STEPS, VIDEO_STEPS_FILTER } from "../../../functions/_shared/video/stepNames";
import { OLD_STEPS } from "../../../functions/_shared/video/clip";

describe("VIDEO_STEPS", () => {
  it("lists every step the video worker owns, in the order of a video", () => {
    expect([...VIDEO_STEPS]).toEqual([
      "kit", "kit_wait", "title", "title_check", "frame", "frame_check", "clip", "clip_wait",
      "assemble", "assemble_wait", "transcribe", "transcribe_wait", "style_cut", "style_wait", "style_read",
    ]);
  });
  it("names none of the steps from before the video update", () => {
    for (const old of OLD_STEPS) expect(VIDEO_STEPS as readonly string[]).not.toContain(old);
    for (const word of ["references", "footage", "hook", "compose", "clean"]) {
      expect(VIDEO_STEPS.some((s) => s.includes(word))).toBe(false);
    }
  });
  it("is a PostgREST list for in and not.in filters", () => {
    expect(VIDEO_STEPS_FILTER).toBe(`(${VIDEO_STEPS.join(",")})`);
  });
});
