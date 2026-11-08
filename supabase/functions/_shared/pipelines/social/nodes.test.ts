// @vitest-environment node
// The report is client-facing: what it says about a missing brief or missing
// trends states the fact and never tells anyone what to do.
import { describe, expect, it } from "vitest";
import { generateRunSummary, prepareBriefText } from "./nodes";

// deno-lint-ignore no-explicit-any
type Any = any;

const INSTRUCTION = /client setup|\bAdd\b|\bpaste\b|\bUse a\b/i;

describe("Prepare Brief Text", () => {
  it("says the linked brief could not be read, with what was used instead, and no instruction", () => {
    const withSaved = prepareBriefText({ brief_file_id: "f1", brief_text: "Saved brief." }, { text: "" });
    expect(withSaved.brief_warning).toBe("The linked brief could not be read. The saved brief text was used instead.");
    const withNone = prepareBriefText({ brief_file_id: "f1", brief_text: "" }, { text: "" });
    expect(withNone.brief_warning).toBe("The linked brief could not be read. This analysis has no text from that brief.");
    for (const r of [withSaved, withNone]) expect(r.brief_warning).not.toMatch(INSTRUCTION);
  });
});

describe("Generate Run Summary trend warnings", () => {
  const summary = (trendStatus: Any): Any => generateRunSummary({
    gamma: {}, presentation: {}, clientData: {}, combined: {}, config: {}, sprout: null, ai: {}, prepared: {},
    trendStatus, startedAt: new Date("2026-11-01T00:00:00.000Z"), now: new Date("2026-11-01T00:05:00.000Z"),
  });

  it("says TikTok and Instagram trends were not available, without an instruction", () => {
    const warnings: string[] = summary({ tiktok: "missing_keywords", instagram: "missing_keywords" }).warnings;
    expect(warnings).toContain("TikTok trends were not available this month.");
    expect(warnings).toContain("Instagram trends were not available this month.");
    for (const w of warnings) expect(w).not.toMatch(INSTRUCTION);
  });
});
