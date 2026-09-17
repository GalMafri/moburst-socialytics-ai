import { describe, expect, it } from "vitest";
import {
  CLEAN_VERDICT,
  correctionFor,
  verdictIsDirty,
} from "../../../supabase/functions/_shared/design-prompts/correction";
// Both consumers import the same module now. Importing through BOTH entry
// points is the point of this file: if anyone reintroduces a local copy on
// either side, these stop agreeing.
import { correctionFor as browserCorrectionFor, verdictIsDirty as browserIsDirty } from "@/lib/designGuard";
import { correctionFor as edgeCorrectionFor } from "../../../supabase/functions/_shared/design-prompts/validateImage";

const DIRTY = { has_logo: true, has_garbled_text: true, has_hex_codes: true, has_text: true, off_brand: true };

describe("one correction, not two", () => {
  it("the browser and the edge functions return identical text", () => {
    // This drifted for months: the edge copy had been taught that a large
    // decorative letterform counts as a logo and the browser copy had not, so
    // a design could fail review for exactly that and be retried with a
    // correction that never mentioned it.
    for (const opts of [{}, { expectNoText: true }, { expectNoText: true, avoid: "never use red" }]) {
      expect(browserCorrectionFor(DIRTY, opts)).toBe(correctionFor(DIRTY, opts));
      expect(edgeCorrectionFor(DIRTY, opts)).toBe(correctionFor(DIRTY, opts));
    }
  });

  it("names the failure the validator actually asks about", () => {
    // validateImage's question 2 asks about a single large letter used as a
    // watermark, so the retry has to name that, not just "a logo".
    const out = correctionFor({ has_logo: true });
    expect(out).toMatch(/letterform/i);
    expect(out).toMatch(/single letter or initial/i);
  });

  it("tells the model how to fix garbled text, not merely that it was wrong", () => {
    const out = correctionFor({ has_garbled_text: true });
    expect(out).toMatch(/fewer words/i);
    expect(out).toMatch(/6 per line/);
  });
});

describe("correctionFor", () => {
  it("says nothing about a clean verdict", () => {
    expect(correctionFor(CLEAN_VERDICT)).toBe("");
    expect(correctionFor(CLEAN_VERDICT, { expectNoText: true })).toBe("");
  });

  it("ignores lettering unless the design was asked for none", () => {
    expect(correctionFor({ has_text: true })).toBe("");
    expect(correctionFor({ has_text: true }, { expectNoText: true })).toMatch(/NO lettering/);
  });

  it("quotes the brand's own rules when it has them", () => {
    expect(correctionFor({ off_brand: true }, { avoid: "never use red" })).toMatch(/never use red/);
    expect(correctionFor({ off_brand: true })).toMatch(/Re-stage the subject/);
  });

  it("reads avoid off the verdict when the caller passes none, which is how the browser gets it", () => {
    expect(correctionFor({ off_brand: true, avoid: "no stock smiles" })).toMatch(/no stock smiles/);
  });

  it("prefers an explicit avoid over the one on the verdict", () => {
    expect(correctionFor({ off_brand: true, avoid: "from verdict" }, { avoid: "from caller" })).toMatch(/from caller/);
  });

  it("truncates a very long rule set rather than sending the whole thing", () => {
    const out = correctionFor({ off_brand: true }, { avoid: "x".repeat(2000) });
    expect(out).toContain("x".repeat(600));
    expect(out).not.toContain("x".repeat(601));
  });

  it("carries no em dash, because this text reaches a person in the toast trail", () => {
    expect(correctionFor(DIRTY, { expectNoText: true })).not.toMatch(/—/);
  });
});

describe("verdictIsDirty", () => {
  it("is not dirty when the check never ran", () => {
    // A skipped check is not a clean bill of health, but it is not evidence of
    // a fault either, and regenerating costs money.
    expect(verdictIsDirty({ has_logo: true, skipped: true })).toBe(false);
    expect(browserIsDirty({ has_logo: true, skipped: true })).toBe(false);
  });

  it("is not dirty on null or on a clean verdict", () => {
    expect(verdictIsDirty(null)).toBe(false);
    expect(verdictIsDirty(undefined)).toBe(false);
    expect(verdictIsDirty(CLEAN_VERDICT)).toBe(false);
  });

  it("is dirty on any single flag", () => {
    for (const k of ["has_logo", "has_garbled_text", "has_hex_codes", "off_brand"] as const) {
      expect(verdictIsDirty({ [k]: true })).toBe(true);
    }
  });

  it("counts text only when the design was asked for none", () => {
    expect(verdictIsDirty({ has_text: true })).toBe(false);
    expect(verdictIsDirty({ has_text: true }, { expectNoText: true })).toBe(true);
  });
});
