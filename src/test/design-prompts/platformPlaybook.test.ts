import { describe, it, expect } from "vitest";
import {
  getPlaybookEntry,
  renderPlaybookSection,
} from "../../../supabase/functions/_shared/design-prompts/platformPlaybook";

describe("platformPlaybook", () => {
  it("returns Reel entry for Instagram + Reel", () => {
    const entry = getPlaybookEntry("Instagram", "Reel/Video");
    expect(entry.aspectRatio).toBe("9:16");
    expect(entry.orientation).toBe("vertical");
    expect(entry.motionGuidance).toBeDefined();
  });

  it("returns TikTok video entry for TikTok + anything-video-like", () => {
    expect(getPlaybookEntry("TikTok", "Short Video").aspectRatio).toBe("9:16");
    expect(getPlaybookEntry("TikTok", "Reel").aspectRatio).toBe("9:16");
  });

  it("falls back to default for unknown platform", () => {
    const entry = getPlaybookEntry("MyTeenSocial", "Whatever");
    expect(entry).toBeDefined();
    expect(entry.aspectRatio).toBe("1:1");
  });

  it("normalizes platform aliases (ig, tt, fb)", () => {
    expect(getPlaybookEntry("ig", "carousel").aspectRatio).toBe("4:5");
    expect(getPlaybookEntry("tt", "video").aspectRatio).toBe("9:16");
    expect(getPlaybookEntry("fb", "single image").aspectRatio).toBe("1.91:1");
  });

  it("renders a markdown section with the platform name", () => {
    const entry = getPlaybookEntry("LinkedIn", "Single Image");
    const md = renderPlaybookSection(entry, "LinkedIn", "Single Image");
    expect(md).toContain("LinkedIn");
    expect(md).toContain("Aspect: 1.91:1");
    expect(md).toContain("Avoid:");
  });
});
