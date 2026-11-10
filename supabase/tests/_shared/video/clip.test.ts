// @vitest-environment node
import { describe, it, expect } from "vitest";
import { clipRequest, clipOrderDecision, needsClipPrice, REASONS } from "../../../functions/_shared/video/clip";
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
    expect(clipOrderDecision({}, null, 128, 1000)).toEqual({ action: "stop", reason: REASONS.price });
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
