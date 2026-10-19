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

it("rates every company and network as engagements per impression from RivalIQ's totals, never a stored rate",()=>{
 const input={aggregates:{companies:[{post_count:31,engagement_rate_avg:0.0136,by_channel:{instagram:{post_count:8,engagement_rate_avg:0.5},linkedin:{post_count:3,engagement_rate_avg:0.4}},rivaliq_metrics:{engagement_rate_per_post:{current:0.001548879},engagement:{current:207},estimated_impressions:{current:16280},by_network:{instagram:{rate:{current:0.002},engagement:{current:137},impressions:{current:7081}}}}}]}};
 const result=normalizedCompetitiveMetrics(input).aggregates.companies[0];
 expect(result.engagement_rate_avg).toBe(207/16280);
 expect((result as { engagement_avg?: number }).engagement_avg).toBe(207/31);
 expect(result.by_channel.instagram.engagement_rate_avg).toBe(137/7081);
 // No impressions figure for LinkedIn: no rate, never the stored 40%.
 expect(result.by_channel.linkedin.engagement_rate_avg).toBeNull();
 expect(input.aggregates.companies[0].engagement_rate_avg).toBe(0.0136);
});
it("never passes a stored rate through when a report has no provider totals",()=>{
 const result=normalizedCompetitiveMetrics({aggregates:{companies:[{post_count:4,engagement_rate_avg:3.04,by_channel:{facebook:{post_count:4,engagement_rate_avg:3.04}}}]}}).aggregates.companies[0];
 expect(result.engagement_rate_avg).toBeNull();
 expect(result.by_channel.facebook.engagement_rate_avg).toBeNull();
});
