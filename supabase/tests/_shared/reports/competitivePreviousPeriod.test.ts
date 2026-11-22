// QA 22 Nov 2026 (P47-06): a competitive report's change facts call the previous period "February" for a
// March report, but the competitive run compares with the equal-length window before
// (29 Jan to 28 Feb). Only the monthly pipeline uses the calendar month before.
import { describe, expect, it } from "vitest";
import { competitiveChanges } from "../../../functions/_shared/reports/facts";
import { previousPeriodOf } from "../../../functions/_shared/pipelines/competitive/nodes";

const pair = (current: number, previous: number) => ({ current, previous });
const company = (name: string, is_client: boolean, posts: number, eng: [number, number], aud: [number, number]) => ({
  name, is_client, post_count: posts,
  rivaliq_metrics: { period: { start: "2026-03-01", end: "2026-03-31" }, posts: pair(posts, posts - 2), engagement: pair(...eng), audience: pair(...aud), estimated_impressions: pair(1000, 1000),
    by_network: { instagram: { posts: pair(posts, posts - 2), engagement: pair(...eng), impressions: pair(1000, 1000), followers: pair(...aud) } } },
  by_channel: { instagram: { post_count: posts } },
});
const report = { period: { start: "2026-03-01", end: "2026-03-31" }, aggregates: { metric_semantics_version: 4, period: { start: "2026-03-01", end: "2026-03-31", days: 31 },
  companies: [company("Acme", true, 14, [620, 400], [14900, 14000]), company("Rival", false, 30, [2100, 1800], [68000, 65000])] } };

describe("P47-06 competitive previous period label", () => {
  it("does not name a calendar month the comparison window is not", () => {
    const window = previousPeriodOf({ range_start: "2026-03-01", range_end: "2026-03-31" });
    expect(window).toEqual({ start: "2026-01-29", end: "2026-02-28" });
    const change = competitiveChanges(report, { start: "2026-03-01", end: "2026-03-31" }).find((c) => c.metric === "engagements")!;
    expect(change.basis).not.toContain("in February");
  });
});
