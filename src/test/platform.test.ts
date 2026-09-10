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

describe("prettyPlatformName on Sprout's raw network types", () => {
  it("turns the network_type a Sprout profile carries into a readable name", async () => {
    const { prettyPlatformName } = await import("@/lib/platform-config");
    expect(prettyPlatformName("fb_instagram_account")).toBe("Instagram");
    expect(prettyPlatformName("linkedin_company")).toBe("LinkedIn");
    expect(prettyPlatformName("fb_page")).toBe("Facebook");
    expect(prettyPlatformName("twitter_profile")).toBe("Twitter/X");
  });
  it("leaves a name that is already readable alone", async () => {
    const { prettyPlatformName } = await import("@/lib/platform-config");
    expect(prettyPlatformName("Instagram")).toBe("Instagram");
    expect(prettyPlatformName("TikTok")).toBe("TikTok");
  });
});
