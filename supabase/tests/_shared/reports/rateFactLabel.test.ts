// QA 22 Nov 2026 (P47-04): a monthly report's rate fact names the client's Sprout rate with the bare
// "engagement rate", which rateLabels.ts (owner, 20 Oct) reserves for neither rate.
import { describe, expect, it } from "vitest";
import { socialFacts } from "../../../functions/_shared/reports/facts";
import { SPROUT_RATE_LABEL } from "../../../../src/lib/rateLabels";

const report = {
  sprout_performance: {
    overall_totals: { engagements: 300, impressions: 10000 },
    month_comparison: { current_month: { engagements: 300, impressions: 10000 }, previous_month: { engagements: 200, impressions: 10000 } },
  },
};

describe("P47-04 rate fact label", () => {
  it("names the rate as the screens do", () => {
    const rate = socialFacts(report).find((f) => f.key === "change|all|engagement_rate|")!;
    expect(rate.sentence.toLowerCase()).toContain(SPROUT_RATE_LABEL.toLowerCase());
  });
});
