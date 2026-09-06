import { describe, expect, it } from "vitest";
import {
  imageAspectRatio,
  isVerticalFormat,
  videoAspectRatio,
} from "../../../supabase/functions/_shared/design-prompts/aspect";

describe("isVerticalFormat", () => {
  it("treats a YouTube Short as vertical", () => {
    // The bug this file exists for: YouTube used to force 16:9 on every format,
    // so a Short came back horizontal.
    expect(isVerticalFormat("YouTube", "Short")).toBe(true);
    expect(isVerticalFormat("YouTube", "Shorts")).toBe(true);
    expect(isVerticalFormat("YouTube", "Vertical YouTube Short")).toBe(true);
  });

  it("keeps an ordinary YouTube video wide", () => {
    expect(isVerticalFormat("YouTube", "Video")).toBe(false);
    expect(isVerticalFormat("YouTube", "")).toBe(false);
  });

  it("makes a plain Video vertical where the platform publishes it that way", () => {
    // "Video" says nothing about shape, so the platform decides.
    expect(isVerticalFormat("Instagram", "Video")).toBe(true);
    expect(isVerticalFormat("TikTok", "Video")).toBe(true);
    expect(isVerticalFormat("Instagram", "Short Video")).toBe(true);
    expect(isVerticalFormat("Facebook", "Video")).toBe(false);
    expect(isVerticalFormat("LinkedIn", "Video")).toBe(false);
    expect(isVerticalFormat("YouTube", "Video")).toBe(false);
  });

  it("does not turn Instagram stills vertical", () => {
    // The same rule drives generated images, so the moving-format fallback must
    // not reshape a feed post.
    for (const f of ["Single Image", "Carousel", "Document/PDF", "Image"]) {
      expect(isVerticalFormat("Instagram", f), f).toBe(false);
      expect(isVerticalFormat("TikTok", f), f).toBe(false);
    }
  });

  it("still lets an explicit shape override the platform", () => {
    expect(isVerticalFormat("Instagram", "Landscape Video")).toBe(false);
    expect(isVerticalFormat("YouTube", "Vertical Video")).toBe(true);
  });

  it("handles the other vertical formats the planner produces", () => {
    for (const f of ["Reel/Video", "Reel", "Story", "Short Video", "Portrait"]) {
      expect(isVerticalFormat("Instagram", f), f).toBe(true);
    }
  });

  it("lets the format override the platform in both directions", () => {
    expect(isVerticalFormat("TikTok", "Landscape")).toBe(false);
    expect(isVerticalFormat("LinkedIn", "Reel")).toBe(true);
  });

  it("falls back to the platform only when no format is given", () => {
    expect(isVerticalFormat("TikTok", "")).toBe(true);
    expect(isVerticalFormat("Instagram", "")).toBe(false);
  });

  it("does not match a format that merely contains the word", () => {
    expect(isVerticalFormat("Instagram", "Shortlist carousel")).toBe(false);
    expect(isVerticalFormat("Instagram", "Storyboard")).toBe(false);
  });
});

describe("videoAspectRatio", () => {
  it("is 9:16 for shorts and reels, 16:9 otherwise", () => {
    expect(videoAspectRatio("YouTube", "Short")).toBe("9:16");
    expect(videoAspectRatio("Instagram", "Reel/Video")).toBe("9:16");
    expect(videoAspectRatio("TikTok", "Short Video")).toBe("9:16");
    expect(videoAspectRatio("YouTube", "Video")).toBe("16:9");
    expect(videoAspectRatio("Facebook", "Video")).toBe("16:9");
    expect(videoAspectRatio("LinkedIn", "Article")).toBe("16:9");
    expect(videoAspectRatio("Instagram", "Video")).toBe("9:16");
    expect(videoAspectRatio("TikTok", "Video")).toBe("9:16");
  });

  it("only ever returns a ratio Veo accepts", () => {
    const inputs: Array<[string, string]> = [
      ["YouTube", "Short"], ["Instagram", "Carousel"], ["LinkedIn", "Document/PDF"],
      ["Facebook", "Single Image"], ["Pinterest", "Pin"], ["", ""],
    ];
    for (const [p, f] of inputs) {
      expect(["16:9", "9:16"]).toContain(videoAspectRatio(p, f));
    }
  });
});

describe("imageAspectRatio", () => {
  it("gives a YouTube Short cover a vertical frame, not a square one", () => {
    expect(imageAspectRatio("YouTube", "Short")).toBe("9:16");
  });

  it("keeps the existing shapes for everything else", () => {
    expect(imageAspectRatio("Instagram", "Single Image")).toBe("1:1");
    expect(imageAspectRatio("Instagram", "Carousel")).toBe("1:1");
    // A cover still for an Instagram video is tall, like the clip it fronts.
    expect(imageAspectRatio("Instagram", "Video")).toBe("9:16");
    expect(imageAspectRatio("LinkedIn", "Single Image")).toBe("16:9");
    expect(imageAspectRatio("Pinterest", "Pin")).toBe("2:3");
    expect(imageAspectRatio("", "")).toBe("1:1");
  });
});

describe("buildImagePrompt noText", () => {
  it("forbids every rendered word for a video anchor frame", async () => {
    const { buildImagePrompt } = await import("../../../supabase/functions/_shared/design-prompts/buildImagePrompt");
    const out = buildImagePrompt({ basePrompt: "An attorney in an office", noText: true });
    expect(out).toContain("Render NO text of any kind");
    expect(out).not.toContain("only use text that appears in the creative direction");
  });

  it("leaves the normal still constraint alone", async () => {
    const { buildImagePrompt } = await import("../../../supabase/functions/_shared/design-prompts/buildImagePrompt");
    const out = buildImagePrompt({ basePrompt: "An attorney in an office" });
    expect(out).toContain("only use text that appears in the creative direction");
    expect(out).not.toContain("Render NO text of any kind");
  });
});
