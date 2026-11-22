// @vitest-environment node
// P45-01: the social pipeline accepts and writes an analysis with no pillar_alignment (the shape P21-01 shows dead).
import { describe, expect, it } from "vitest";
import { synthesisProblems } from "../../../functions/_shared/pipelines/social/analysis";
import { generateRunSummary } from "../../../functions/_shared/pipelines/social/nodes";

describe("P45-01 analysis without pillar_alignment", () => {
  it("is sent to repair instead of being written as a successful report", () => {
    const ai = { sprout_performance_analysis: { month_over_month_summary: "Reach rose.", key_insights: ["Reels lead: they took most views."] } };
    const problems = synthesisProblems(ai);
    const report = generateRunSummary({ gamma: {}, presentation: {}, clientData: {}, combined: {}, config: {}, sprout: null, ai, prepared: {}, industryTrends: null, startedAt: new Date(0), now: new Date(0) });
    const written = problems.length === 0 && report.status === "success";
    expect(written ? report.ai_analysis.sprout_performance_analysis.pillar_alignment : "flagged").toBeDefined();
  });
});
