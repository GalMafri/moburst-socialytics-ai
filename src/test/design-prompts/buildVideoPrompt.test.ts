import { describe, it, expect } from "vitest";
import { buildVideoPrompt } from "../../../supabase/functions/_shared/design-prompts/buildVideoPrompt";

describe("buildVideoPrompt", () => {
  it("strips hex codes from the scene description", () => {
    const out = buildVideoPrompt({
      sceneDescription: "A close-up product shot in #FF5733 light",
    });
    expect(out).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(out).toContain("the brand color");
  });

  it("includes motion guidance from the playbook for video formats", () => {
    const out = buildVideoPrompt({
      sceneDescription: "x",
      platform: "TikTok",
      format: "Video",
    });
    expect(out).toContain("Motion:");
  });

  it("uses synthesis as primary brand language", () => {
    const out = buildVideoPrompt({
      sceneDescription: "x",
      synthesis: { mood_and_voice_visual: "Restrained, deliberate, premium" },
    });
    expect(out).toContain("### Mood");
    expect(out).toContain("Restrained");
  });

  it("falls back to brand identity inline summary when no synthesis", () => {
    const out = buildVideoPrompt({
      sceneDescription: "x",
      brandIdentity: {
        visual_style: "Bold, energetic",
        tone_of_voice: "Confident",
      },
    });
    expect(out).toContain("Visual style: Bold, energetic");
    expect(out).toContain("Tone: Confident");
  });

  it("includes the variant angle when provided", () => {
    const out = buildVideoPrompt({
      sceneDescription: "x",
      variantAngle: "Cinematic slow push",
    });
    expect(out).toContain("Variant angle: Cinematic slow push");
  });

  it("places scene description before brand language", () => {
    const out = buildVideoPrompt({
      sceneDescription: "The hero scene description",
      synthesis: { composition_patterns: "Asymmetric" },
    });
    const sceneIdx = out.indexOf("The hero scene description");
    const brandIdx = out.indexOf("Brand design language");
    expect(sceneIdx).toBeGreaterThanOrEqual(0);
    expect(brandIdx).toBeGreaterThan(sceneIdx);
  });

  it("emits the constraints block last", () => {
    const out = buildVideoPrompt({
      sceneDescription: "Some scene",
      synthesis: { composition_patterns: "Asymmetric" },
    });
    const constraintsIdx = out.indexOf("Constraints:");
    expect(constraintsIdx).toBeGreaterThan(0);
    // Nothing after Constraints except whitespace.
    expect(out.slice(constraintsIdx).split("\n\n").length).toBeLessThanOrEqual(2);
  });

  it("switches to anchor-frame + motion-brief mode when a seed image is present", () => {
    // Rationale: when generate-post-video passes a Gemini-generated brand-aligned
    // still to Veo via `image: { bytesBase64Encoded }`, the prompt must pivot
    // from "describe the whole scene" to "describe the MOTION that animates the
    // anchor frame". Without this pivot, Veo re-imagines the scene and drifts
    // off-brand.
    const out = buildVideoPrompt({
      sceneDescription: "Product hero shot, close-up on the device",
      synthesis: { composition_patterns: "Asymmetric" },
      hasSeedImage: true,
    });
    expect(out).toContain("ANCHOR FRAME");
    expect(out).toContain("MOTION BRIEF");
    // The motion brief should still contain the user's scene description.
    expect(out).toContain("Product hero shot");
    // Anchor must come before brand language so it's the primary instruction.
    const anchorIdx = out.indexOf("ANCHOR FRAME");
    const brandIdx = out.indexOf("Brand design language");
    expect(anchorIdx).toBeGreaterThanOrEqual(0);
    expect(brandIdx).toBeGreaterThan(anchorIdx);
  });

  it("omits anchor-frame language when no seed image is present (default)", () => {
    const out = buildVideoPrompt({
      sceneDescription: "Product hero shot",
      synthesis: { composition_patterns: "Asymmetric" },
    });
    expect(out).not.toContain("ANCHOR FRAME");
    expect(out).not.toContain("MOTION BRIEF");
    // Scene description still leads.
    expect(out.indexOf("Product hero shot")).toBe(0);
  });
});
