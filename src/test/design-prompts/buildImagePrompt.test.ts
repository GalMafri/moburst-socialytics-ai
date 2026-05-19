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

  it("includes single-slide carousel context when slideContext present", () => {
    const cover = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 0, total: 5 },
    });
    expect(cover).toContain("slide 1 of 5");
    expect(cover.toLowerCase()).toContain("cover");
    // Critical anti-instructions that prevent the contact-sheet output:
    expect(cover).toContain("SINGLE-SLIDE OUTPUT");
    expect(cover).toContain("DO NOT show multiple slides");
    expect(cover).toContain("contact sheet");

    const interior = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 2, total: 5 },
    });
    expect(interior).toContain("slide 3 of 5");
    expect(interior).toContain("INTERIOR");
    expect(interior).toContain("SINGLE-SLIDE OUTPUT");
  });

  it("front-loads the single-slide directive before primary objective and creative direction", () => {
    // Rationale: in the previous version the SINGLE-SLIDE OUTPUT block was in
    // position 5, AFTER primary objective + brand language + creative direction
    // + platform playbook. LLMs weight early tokens heavier, so a brief that
    // says "5-slide carousel" earlier in the prompt can override the later
    // single-slide instruction. Front-loading is the proven fix — the model's
    // very first instruction is "one image, one slide", and everything else is
    // rendered in service of that.
    const out = buildImagePrompt({
      basePrompt: "Render a 5-slide carousel about the new product",
      synthesis: { composition_patterns: "Asymmetric" },
      slideContext: { index: 0, total: 5 },
    });
    const criticalIdx = out.indexOf("CRITICAL OUTPUT FORMAT");
    const objectiveIdx = out.indexOf("Primary objective");
    const brandIdx = out.indexOf("BRAND DESIGN LANGUAGE");
    const creativeIdx = out.indexOf("Creative direction");
    expect(criticalIdx).toBeGreaterThanOrEqual(0);
    expect(criticalIdx).toBeLessThan(objectiveIdx);
    expect(criticalIdx).toBeLessThan(brandIdx);
    expect(criticalIdx).toBeLessThan(creativeIdx);
  });

  it("repeats the single-slide reminder mid-prompt for multi-instance reinforcement", () => {
    // Rationale: even with the directive front-loaded, repeating it after the
    // creative direction prevents the model from drifting back to multi-panel
    // composition once it's deep in rendering decisions. This is a standard
    // prompt-engineering technique for getting models to follow critical rules
    // through long prompts.
    const out = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 0, total: 5 },
    });
    expect(out).toContain("SINGLE-SLIDE OUTPUT — REMINDER");
    // Reminder must come after the front-loaded directive.
    const criticalIdx = out.indexOf("CRITICAL OUTPUT FORMAT");
    const reminderIdx = out.indexOf("SINGLE-SLIDE OUTPUT — REMINDER");
    expect(reminderIdx).toBeGreaterThan(criticalIdx);
  });

  it("does not emit slide-context sections when no slideContext is present", () => {
    const out = buildImagePrompt({ basePrompt: "x" });
    expect(out).not.toContain("CRITICAL OUTPUT FORMAT");
    expect(out).not.toContain("SINGLE-SLIDE OUTPUT");
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
