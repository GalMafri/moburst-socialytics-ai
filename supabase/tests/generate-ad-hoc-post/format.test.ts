import { describe, expect, it } from "vitest";
import { adHocFormat, settleFormat } from "../../functions/generate-ad-hoc-post/format";

// The New post dialog's format, as generate-ad-hoc-post asks the model for it
// and saves what comes back (Stories design, 2 Nov 2026).

describe("adHocFormat", () => {
  it("asks for a Story's message in one or two short sentences and no hashtags, on Instagram and Facebook", () => {
    for (const platform of ["Instagram", "Facebook"]) {
      const f = adHocFormat("Story", platform);
      if ("refused" in f) throw new Error("refused");
      expect(f.story).toBe(true);
      expect(f.creative).toContain("Story");
      expect(f.formatField).toBe("Story");
      expect(f.captionField).toContain("one or two short sentences");
      expect(f.hashtagsField).toContain("no hashtags");
    }
  });

  it("refuses a Story on any other network", () => {
    for (const platform of ["LinkedIn", "TikTok", "X"]) expect(adHocFormat("Story", platform)).toEqual({ refused: "Stories are made for Instagram and Facebook." });
  });

  it("never offers the model a Story in auto mode or for another format", () => {
    for (const choice of [undefined, "", "Carousel", "Reel", "Image"]) {
      const f = adHocFormat(choice, "Instagram");
      if ("refused" in f) throw new Error("refused");
      expect(f.story).toBe(false);
      expect(`${f.creative} ${f.formatField}`).not.toMatch(/stor(y|ies)/i);
      expect(f.captionField).toBe("the full post caption text");
      expect(f.hashtagsField).toBe("relevant hashtags");
    }
    const auto = adHocFormat(undefined, "Instagram");
    if ("refused" in auto) throw new Error("refused");
    expect(auto.creative).toBe("AI decides based on topic and platform");
  });
});

describe("settleFormat", () => {
  it("saves a chosen Story as a Story with no hashtags", () => {
    const f = adHocFormat("Story", "Instagram");
    if ("refused" in f) throw new Error("refused");
    expect(settleFormat({ format: "Instagram Story", caption_angle: "Captains pay last.", hashtags: "#beerleague" }, f)).toEqual({ format: "Story", caption_angle: "Captains pay last.", hashtags: [] });
  });

  it("saves a Story the model returned on its own as an image, because a Story is a person's choice", () => {
    for (const choice of [undefined, "Carousel"]) {
      const f = adHocFormat(choice, "Instagram");
      if ("refused" in f) throw new Error("refused");
      expect(settleFormat({ format: "Story", hashtags: "#x" }, f)).toEqual({ format: "Image", hashtags: "#x" });
      expect(settleFormat({ format: "Carousel" }, f)).toEqual({ format: "Carousel" });
    }
  });
});
