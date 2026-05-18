import { describe, it, expect } from "vitest";
import { flattenSynthesis } from "../../../supabase/functions/_shared/design-prompts/flattenSynthesis";

describe("flattenSynthesis", () => {
  it("returns empty string for null/undefined", () => {
    expect(flattenSynthesis(null)).toBe("");
    expect(flattenSynthesis(undefined)).toBe("");
  });

  it("returns empty string when all fields are missing", () => {
    expect(flattenSynthesis({})).toBe("");
  });

  it("includes labels and content for populated fields", () => {
    const md = flattenSynthesis({
      composition_patterns: "Asymmetric, generous breathing room",
      anti_patterns: "Centered stock photography",
    });
    expect(md).toContain("## Brand design language");
    expect(md).toContain("### Composition");
    expect(md).toContain("Asymmetric, generous breathing room");
    expect(md).toContain("### Anti-patterns (avoid)");
    expect(md).toContain("Centered stock photography");
  });

  it("skips empty-string fields", () => {
    const md = flattenSynthesis({
      composition_patterns: "",
      typography_treatment: "Serif display + sans body",
    });
    expect(md).not.toContain("### Composition");
    expect(md).toContain("### Typography");
  });
});
