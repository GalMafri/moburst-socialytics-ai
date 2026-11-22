// @vitest-environment node
// P45-02: the deck's key insight says every metric declined when only impressions fell.
import { describe, expect, it } from "vitest";
import { buildPresentationContent, metricChange } from "../../../functions/_shared/pipelines/social/nodes";

describe("P45-02 deck key insight on a fall in impressions", () => {
  it("does not claim a decline across all metrics while reactions and comments rose", () => {
    const changes = { impressions: metricChange(400, 1000), reactions: metricChange(300, 100), comments: metricChange(80, 20) };
    const clientData = { client_name: "Acme", sprout: { profiles: [{ id: 1 }], month_comparison: { changes, summary: [] }, platform_breakdown: [] }, context: {} };
    const { presentation_content } = buildPresentationContent(clientData, {}, new Date("2026-11-01T00:00:00Z"));
    expect(presentation_content).not.toMatch(/decline across all metrics/);
  });
});
