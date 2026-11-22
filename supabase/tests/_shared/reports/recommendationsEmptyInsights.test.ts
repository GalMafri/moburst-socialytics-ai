// QA 22 Nov 2026 (P48-02): an insights answer that carries no recommendations is parsed as []; shownSocial
// then shows none and blanks the report's own recommendations, while an empty
// insights list falls back to the report's own.
import { describe, it, expect } from "vitest";
import { parseInsights } from "../../../functions/_shared/reports/insights";
import { shownSocial } from "../../../functions/_shared/reports/shownFields";

describe("P48-02 shownSocial recommendations", () => {
  it("a report's own recommendations show when the insights carry none", () => {
    const fields = parseInsights("social", JSON.stringify({ summary: { text: "Reach rose 12%.", facts: ["F1"] }, insights: [{ text: "Reels led.", facts: ["F1"] }] }));
    expect(fields).not.toBeNull();
    const ai = { sprout_performance_analysis: { key_insights: ["own"], pillar_alignment: { recommendations: ["Post two Reels a week.", "Answer comments within a day."] } } };
    const shown = shownSocial(ai, { report_id: "r1", facts: [], fields: fields!, confirmed_at: "2026-11-01T00:00:00Z" });
    expect(shown.recommendations.map((r) => r.text)).toEqual(["Post two Reels a week.", "Answer comments within a day."]);
  });
});
