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

  it("falls back to a platform-appropriate default for unknown formats on known platforms", () => {
    // Instagram is vertical-first; unknown format on IG should not collapse to 1:1.
    expect(getPlaybookEntry("Instagram", "tiktok-style").orientation).not.toBe("square");
    expect(getPlaybookEntry("Instagram", "tiktok-style").aspectRatio).not.toBe("1:1");
    // LinkedIn defaults to landscape single image.
    expect(getPlaybookEntry("LinkedIn", "weird-format").aspectRatio).toBe("1.91:1");
    // YouTube defaults to 16:9.
    expect(getPlaybookEntry("YouTube", "weird-format").aspectRatio).toBe("16:9");
  });

  it("renders motionGuidance only when present (single-image case)", () => {
    const single = getPlaybookEntry("LinkedIn", "Single Image");
    expect(single.motionGuidance).toBeUndefined();
    const md = renderPlaybookSection(single, "LinkedIn", "Single Image");
    expect(md).not.toContain("Motion:");
  });

  it("sanitizes multi-slide language from the carousel playbook when slideContext is present", () => {
    // Rationale: the Instagram/LinkedIn carousel playbook entries describe
    // "users swipe through" and "cover vs interior slides" — phrases that
    // confuse Gemini into composing multi-panel images even when the rest of
    // the prompt demands a single slide. When the call is for ONE slide of
    // an N-slide carousel, the rendered playbook must stop describing the
    // OTHER slides.
    const entry = getPlaybookEntry("Instagram", "carousel");
    const withSlide = renderPlaybookSection(
      entry,
      "Instagram",
      "carousel",
      { index: 0, total: 5 },
    );
    // No raw "swipe through" instructions to other slides.
    expect(withSlide.toLowerCase()).not.toMatch(/swipe through/);
    // No raw "interior slides" framing — should have been reframed.
    expect(withSlide.toLowerCase()).not.toMatch(/interior slides have/);

    // Sanity: the un-sanitized version still has the multi-slide language.
    const withoutSlide = renderPlaybookSection(entry, "Instagram", "carousel");
    expect(withoutSlide.toLowerCase()).toMatch(/swipe|interior/);
  });
});
