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

describe("marks never reach the model", () => {
  // The synthesis is learned from the client's own posts, which carry a logo,
  // a monogram watermark and a lockup. The owner's rule is no marks at all, so
  // the logo section is dropped and every sentence about marks elsewhere goes.
  it("drops the logo section outright", () => {
    const out = flattenSynthesis({
      composition_patterns: "Two zones: image top, navy text zone below.",
      logo_and_marks_treatment: "Place the full horizontal lockup centered at the bottom.",
    });
    expect(out).not.toContain("Logo & marks");
    expect(out).not.toContain("lockup centered");
    expect(out).not.toContain("PLACEMENT AWARENESS");
  });

  it("strips sentences about marks from the other sections", () => {
    const out = flattenSynthesis({
      surface_and_texture:
        "Apply the large-scale 'IB' monogram lettermark as a watermark ghost behind the text zone. Keep all other surfaces flat and clean — no gradients.",
      color_usage: "Ground the palette in deep navy. Reserve a near-white for video backgrounds where the logo mark watermark appears ghost-faded.",
    });
    // The closing Marks rule names the marks in order to forbid them; the
    // learned sentences that would have the model draw one must be gone.
    expect(out).not.toContain("Apply the large-scale");
    expect(out).not.toContain("ghost-faded");
    expect(out).toContain("Keep all other surfaces flat and clean");
    expect(out).toContain("Ground the palette in deep navy.");
  });

  it("closes with the rule that this image carries no mark", () => {
    const out = flattenSynthesis({ composition_patterns: "Two zones." });
    expect(out).toContain("### Marks");
    expect(out).toContain("This image carries NONE of them");
  });
});
