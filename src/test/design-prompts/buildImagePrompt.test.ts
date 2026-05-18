import { describe, it, expect } from "vitest";
import { buildImagePrompt } from "../../../supabase/functions/_shared/design-prompts/buildImagePrompt";

describe("buildImagePrompt", () => {
  it("never includes hex codes in the output", () => {
    const out = buildImagePrompt({
      basePrompt: "A poster about #FF5733 brand colors",
      platform: "Instagram",
      format: "Single Image",
      brandIdentity: { primary_color: "#FF5733", secondary_color: "#1A73E8" },
    });
    expect(out).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(out.toLowerCase()).toContain("the brand color");
  });

  it("uses the synthesis as primary brand language when available", () => {
    const out = buildImagePrompt({
      basePrompt: "A launch announcement",
      platform: "LinkedIn",
      format: "Single Image",
      synthesis: {
        composition_patterns: "Generous whitespace, asymmetric balance",
        imagery_style: "Editorial photography, restrained palette",
      },
    });
    expect(out).toContain("BRAND DESIGN LANGUAGE");
    expect(out).toContain("### Composition");
    expect(out).toContain("Generous whitespace");
  });

  it("falls back to brand identity fields when no synthesis present", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      brandIdentity: {
        visual_style: "Bold, energetic, slightly retro",
        tone_of_voice: "Confident",
      },
    });
    expect(out).toContain("### Visual style");
    expect(out).toContain("Bold, energetic, slightly retro");
  });

  it("includes the platform playbook for the given combo", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      platform: "Instagram",
      format: "Reel",
    });
    expect(out).toContain("## Platform & format playbook");
    expect(out).toContain("9:16");
  });

  it("includes carousel cover/interior context when slideContext present", () => {
    const cover = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 0, total: 5 },
    });
    expect(cover).toContain("slide 1 of 5");
    expect(cover.toLowerCase()).toContain("cover");

    const interior = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 2, total: 5 },
    });
    expect(interior).toContain("slide 3 of 5");
  });

  it("includes the variant angle when provided", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      variantAngle: "Type-led: text dominates, imagery is secondary",
    });
    expect(out).toContain("## Variant angle");
    expect(out).toContain("Type-led");
  });

  it("places brand language BEFORE creative direction when synthesis is present", () => {
    // Rationale: the brand language must anchor the design, otherwise generic-flavored
    // creative direction text overrides strong brand patterns. The post brief is what
    // to depict; the brand language is how to execute it.
    const out = buildImagePrompt({
      basePrompt: "The post brief",
      synthesis: { composition_patterns: "Asymmetric" },
    });
    const brandIdx = out.indexOf("BRAND DESIGN LANGUAGE");
    const creativeIdx = out.indexOf("Creative direction");
    expect(brandIdx).toBeGreaterThanOrEqual(0);
    expect(creativeIdx).toBeGreaterThan(brandIdx);
  });

  it("places creative direction first when no synthesis is present", () => {
    // Without synthesis there's no binding brand language to anchor on; the brief leads.
    const out = buildImagePrompt({
      basePrompt: "The post brief",
      brandIdentity: { visual_style: "Bold" },
    });
    const creativeIdx = out.indexOf("Creative direction");
    const brandIdx = out.indexOf("Brand design language");
    expect(creativeIdx).toBeGreaterThanOrEqual(0);
    expect(brandIdx).toBeGreaterThan(creativeIdx);
  });

  it("omits the 'Underlying palette' section when no synthesis and no brandIdentity", () => {
    const out = buildImagePrompt({ basePrompt: "x", platform: "Instagram" });
    expect(out).not.toContain("Underlying palette");
  });

  it("includes the 'Underlying palette' section when synthesis is provided", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      synthesis: { composition_patterns: "Asymmetric" },
    });
    expect(out).toContain("## Underlying palette");
  });
});
