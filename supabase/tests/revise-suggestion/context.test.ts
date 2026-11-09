// A rewrite sees the report as the screen shows it (shownFields.ts): the
// summary and the other suggestions shown next to the one being rewritten,
// so it can't duplicate one of them.
import { describe, expect, it } from "vitest";
import { revisionContext } from "../../functions/revise-suggestion/context";
import type { ShownInsightsRow } from "../../functions/_shared/reports/shownFields";

const REPORT = {
  ai_analysis: {
    executive_summary: "The model's summary.",
    gaps_for_client: [{ gap: "The model's gap", platform: "instagram", why_it_matters: "w", suggested_play: "s" }, { gap: "Weekly Reels", platform: "instagram", why_it_matters: "w", suggested_play: "s" }],
  },
};
const INSIGHTS: ShownInsightsRow = {
  report_id: "c1", confirmed_at: "x", facts: [],
  fields: { kind: "competitive", summary: [{ text: "Moburst trails on followers.", facts: [] }], gaps: [{ gap: "Followers trail", platform: "instagram", why_it_matters: "w", suggested_play: "s", facts: [] }, { gap: "Test a weekly poll", platform: "all", why_it_matters: "w", suggested_play: "s", facts: [] }] },
};

describe("revisionContext", () => {
  it("gives the summary and the other suggestions the screen shows, from the report's insights where it has them", () => {
    const ctx = revisionContext(REPORT, INSIGHTS, "Followers trail");
    expect(ctx.summary).toBe("Moburst trails on followers.");
    expect(ctx.others).toEqual(["Test a weekly poll"]);
    expect(ctx.report.ai_analysis.gaps_for_client.map((g: { gap: string }) => g.gap)).toEqual(["Followers trail", "Test a weekly poll"]);
  });

  it("gives the report's own without insights", () => {
    const ctx = revisionContext(REPORT, null, "Weekly Reels");
    expect(ctx.summary).toBe("The model's summary.");
    expect(ctx.others).toEqual(["The model's gap"]);
  });
});
