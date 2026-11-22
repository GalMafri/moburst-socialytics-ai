// @vitest-environment node
// P45-04: metrics_summary (API/report list) records a rise from zero as a 0% change.
import { describe, expect, it } from "vitest";
import { metricChange, metricsSummaryChanges } from "../../../functions/_shared/pipelines/social/nodes";

describe("P45-04 metrics_summary for a metric that was zero before", () => {
  it("does not say impressions did not change when they went from 0 to 5,000", () => {
    const summary = metricsSummaryChanges({ impressions: metricChange(5000, 0) });
    expect(summary.impressions_change).not.toBe(0);
  });
});
