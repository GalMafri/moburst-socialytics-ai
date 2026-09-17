import { describe, expect, it } from "vitest";
import { cleanPostCopy, postCopyOf } from "@/lib/postCopy";

describe("cleanPostCopy", () => {
  it("removes the language line the agent glued to the front", () => {
    // The exact shape found in 20 stored rows across two clients.
    expect(cleanPostCopy("language: en\n3 things you must do before you talk to the insurance company:")).toBe(
      "3 things you must do before you talk to the insurance company:",
    );
  });

  it("removes more than one leaked field", () => {
    expect(cleanPostCopy("language: en\nplatform: Instagram\nA crash doesn't end when the tow truck leaves.")).toBe(
      "A crash doesn't end when the tow truck leaves.",
    );
  });

  it("leaves copy that merely starts with a word and a colon", () => {
    // This is the whole risk of the fix: real copy opens this way constantly.
    for (const real of [
      "Tip: keep the first line short.",
      "Fact: many eligible Veterans can buy with no down payment.",
      "VA loan myth: you only get to use it once.",
      "Question: what would you do first?",
      "3 VA loan facts in 30 seconds: 1. No down payment.",
    ]) {
      expect(cleanPostCopy(real)).toBe(real);
    }
  });

  it("leaves a legitimate sentence that happens to contain a field name", () => {
    expect(cleanPostCopy("Your format matters more than your frequency.")).toBe(
      "Your format matters more than your frequency.",
    );
    // "language" mid-sentence is not a leading field line
    expect(cleanPostCopy("We speak your language, not legal jargon.")).toBe(
      "We speak your language, not legal jargon.",
    );
  });

  it("does not eat a long line that only looks like a field", () => {
    // Over the 60-character value cap, so it is prose, not a field.
    const prose = "rationale: this is a genuine sentence of copy that runs well past the length any schema field would ever be, so it stays.";
    expect(cleanPostCopy(prose)).toBe(prose);
  });

  it("handles empty and missing input", () => {
    expect(cleanPostCopy("")).toBe("");
    expect(cleanPostCopy(null)).toBe("");
    expect(cleanPostCopy(undefined)).toBe("");
  });

  it("keeps the body intact, including its own blank lines", () => {
    expect(cleanPostCopy("language: en\nFirst line.\n\nSecond paragraph.")).toBe("First line.\n\nSecond paragraph.");
  });

  it("is a no-op on copy that was already clean", () => {
    const clean = "After a crash, the first few decisions matter.";
    expect(cleanPostCopy(clean)).toBe(clean);
  });
});

describe("postCopyOf", () => {
  it("prefers copy, then caption_angle, then concept", () => {
    expect(postCopyOf({ copy: "a", caption_angle: "b", concept: "c" })).toBe("a");
    expect(postCopyOf({ caption_angle: "b", concept: "c" })).toBe("b");
    expect(postCopyOf({ concept: "c" })).toBe("c");
    expect(postCopyOf(null)).toBe("");
  });

  it("cleans whichever key it took", () => {
    expect(postCopyOf({ caption_angle: "language: he\nשלום" })).toBe("שלום");
  });
});
