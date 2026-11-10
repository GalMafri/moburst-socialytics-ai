// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CLIP_LOST_MS, OLD_STEPS, clipOutcome, clipRequest, clipOrderDecision, framePrompt, needsClipPrice, REASONS } from "../../../functions/_shared/video/clip";
import { VIDEO_MODEL } from "../../../functions/_shared/higgsfield/generate";

describe("clipRequest", () => {
  it("fixes every clip's settings and never passes video references", () => {
    const r = clipRequest("prompt", "frame-1", ["k1", "k2"]);
    expect(r).toMatchObject({ prompt: "prompt", aspect: "9:16", seconds: 8, resolution: "1080p", withAudio: true, model: VIDEO_MODEL, startImageId: "frame-1", referenceIds: ["k1", "k2"] });
    expect(r.videoReferenceIds).toBeUndefined();
  });
});

describe("clipOrderDecision", () => {
  it("orders once, at or under the approved price", () => {
    expect(clipOrderDecision({}, 128, 128, 1000)).toEqual({ action: "order" });
    expect(clipOrderDecision({}, 128, 120, 1000)).toEqual({ action: "order" });
    expect(clipOrderDecision({}, 128, 144, 1000)).toEqual({ action: "stop", reason: REASONS.price });
    expect(clipOrderDecision({}, null, 128, 1000)).toEqual({ action: "stop", reason: REASONS.unquoted });
    // A video never priced stops at once, without waiting for a price to read.
    expect(clipOrderDecision({}, null, null, 1000)).toEqual({ action: "stop", reason: REASONS.unquoted });
    expect(clipOrderDecision({}, 128, null, 1000)).toEqual({ action: "wait" });
    expect(clipOrderDecision({}, 128, 128, 100)).toEqual({ action: "stop", reason: REASONS.balance });
    expect(clipOrderDecision({}, 128, 128, null)).toEqual({ action: "order" });
  });
  it("never orders again once an order is recorded", () => {
    expect(clipOrderDecision({ clip_order: { price: 128, at: "x", job_id: "j" } }, 128, 100, 1000)).toEqual({ action: "wait" });
    expect(clipOrderDecision({ clip_order: { price: 128, at: "x" } }, 128, 100, 1000)).toEqual({ action: "stop", reason: REASONS.lostOrder });
  });
});

describe("needsClipPrice", () => {
  it("prices a generated video at its own click, unless a price was approved already", () => {
    expect(needsClipPrice("video", null, undefined)).toBe(true);
    expect(needsClipPrice("video", "", undefined)).toBe(true);
    // The week's press approved it (or could not read it): no second read.
    expect(needsClipPrice("video", null, 128)).toBe(false);
    expect(needsClipPrice("video", null, null)).toBe(false);
  });

  it("reads no price for a still or for a filmed clip, which orders no paid clip", () => {
    expect(needsClipPrice("single", null, undefined)).toBe(false);
    expect(needsClipPrice("carousel", null, undefined)).toBe(false);
    expect(needsClipPrice("video", "c1/footage.mp4", undefined)).toBe(false);
  });
});

describe("clipOutcome", () => {
  const HOUR = 60 * 60_000;
  it("is ready only with a finished clip's file", () => {
    expect(clipOutcome({ status: "completed", result_url: "u" }, 0, 1)).toBe("ready");
    expect(clipOutcome({ status: "completed", result_url: null }, 0, 1)).toBe("failed");
  });
  it("is failed when the video service ends the clip any other way", () => {
    expect(clipOutcome({ status: "failed" }, 0, 1)).toBe("failed");
    for (const status of ["nsfw", "canceled", "timed_out"]) expect(clipOutcome({ status }, 0, 1)).toBe("failed");
    expect(clipOutcome({ status: "running", error: "boom" }, 0, 1)).toBe("failed");
  });
  it("keeps waiting for a running clip until CLIP_LOST_MS, then takes it as lost", () => {
    expect(CLIP_LOST_MS).toBe(3 * HOUR);
    expect(clipOutcome({ status: "running" }, 0, HOUR)).toBe("running");
    expect(clipOutcome({ status: "running" }, 0, 4 * HOUR)).toBe("lost");
    expect(clipOutcome(undefined, 0, HOUR)).toBe("running");
    expect(clipOutcome(undefined, 0, 4 * HOUR)).toBe("lost");
  });
});

describe("framePrompt", () => {
  it("draws the video's opening frame at 9:16 from its brief, to the footage's rules", () => {
    const p = framePrompt("a shrimp frying", "RULES");
    expect(p).toContain("a shrimp frying");
    expect(p).toContain("RULES");
    expect(p).toContain("opening frame");
    expect(p).toContain("9:16");
  });
});

describe("REASONS", () => {
  it("are plain sentences with no dashes", () => {
    for (const r of Object.values(REASONS)) {
      expect(r).not.toMatch(/[\u2013\u2014]| - /);
      expect(r).toMatch(/\.$/);
    }
    expect(REASONS.unquoted).toBe("This video was not priced when it was queued. Press again to make it.");
  });
});

describe("OLD_STEPS", () => {
  it("names every step from before the video update", () => {
    expect([...OLD_STEPS]).toEqual(["references", "references_wait", "footage", "footage_wait", "hook", "hook_check", "compose", "compose_wait", "clean", "clean_wait"]);
  });
});
