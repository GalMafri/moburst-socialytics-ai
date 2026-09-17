import { expect, it } from "vitest";
import { comparisonScale, factualDimensions, inclusiveDays, normalizedCompetitiveMetrics } from "@/lib/competitiveMetrics";

it.each([["2026-09-09", "2026-09-15", 7], ["2024-02-01", "2024-02-29", 29], ["2026-09-09", "2026-09-09", 1]])("counts inclusive days", (start, end, days) => expect(inclusiveDays(start, end)).toBe(days));
it("preserves the relationship between 411 and 1384 instead of saturating both bars", () => {
  expect(comparisonScale(411, 1384).client).toBeCloseTo(29.6965, 3);
  expect(comparisonScale(411, 1384).competitor).toBe(100);
  expect(comparisonScale(0, 0)).toEqual({ client: 0, competitor: 0 });
});
const companies = [
  { is_client: true, post_count: 16, cadence_per_week: 18.7, by_channel: { instagram: { post_count: 4, cadence_per_week: 4.7 } }, rivaliq_metrics: { audience: { current: 14952 }, engagement: { current: 411 } } },
  { is_client: false, post_count: 11, rivaliq_metrics: { audience: { current: 368559 }, engagement: { current: 1384 } } },
];
it("uses real audience totals and labels weekly cadence", () => {
  expect(factualDimensions(companies, 7)).toEqual(expect.arrayContaining([
    expect.objectContaining({ dimension: "Audience", client: 14952, competitor_avg: 368559 }),
    expect.objectContaining({ dimension: "Cadence", client: 16, unit: "posts/week" }),
  ]));
});
it("does not turn absent measurements into zero", () => expect(factualDimensions([{ is_client: true }, {}], null)).toEqual([]));
it("corrects historical numeric views without mutating stored input or replacing AI prose", () => {
  const original = { period: { start: "2026-09-09", end: "2026-09-15", days: 6 }, aggregates: { companies }, ai_analysis: { executive_summary: "Original narrative", benchmark_scorecard: { dimensions: [{ dimension: "Audience", client: 25 }] } } };
  const result = normalizedCompetitiveMetrics(original);
  expect(result.period.days).toBe(7);
  expect(result.aggregates.companies[0].cadence_per_week).toBe(16);
  expect(result.aggregates.companies[0].by_channel.instagram.cadence_per_week).toBe(4);
  expect(result.ai_analysis.executive_summary).toBe("Original narrative");
  expect(original.aggregates.companies[0].cadence_per_week).toBe(18.7);
});
