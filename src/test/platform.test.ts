import { describe, expect, it } from "vitest";
import { isVideoFormat, normalizePlatform, platformLabel } from "@/lib/platform";

describe("isVideoFormat", () => {
  it("recognises the formats the planner recommends for a clip", () => {
    for (const f of ["Reel", "reel", "Instagram Reel", "Short", "YouTube Shorts", "Video", "short-form video", "IGTV", "TikTok video"]) {
      expect(isVideoFormat(f), f).toBe(true);
    }
  });

  it("leaves still formats alone", () => {
    for (const f of ["Image", "Carousel", "Static post", "Story", "Text", "Link post", "Photo", ""]) {
      expect(isVideoFormat(f), f).toBe(false);
    }
  });

  it("does not treat a word that merely contains a format name as one", () => {
    expect(isVideoFormat("carousel of stills")).toBe(false);
    expect(isVideoFormat("videography behind the scenes")).toBe(false);
  });

  it("falls back to the platform only when no format is given", () => {
    expect(isVideoFormat("", "tiktok")).toBe(true);
    expect(isVideoFormat(null, "youtube")).toBe(true);
    expect(isVideoFormat("Image", "tiktok")).toBe(false);
    expect(isVideoFormat("", "instagram")).toBe(false);
  });
});

describe("platform helpers still behave", () => {
  it("normalises and labels", () => {
    expect(normalizePlatform("Instagram")).toBe("instagram");
    expect(platformLabel("tiktok")).toBe("TikTok");
  });
});
