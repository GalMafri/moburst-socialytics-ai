import { describe, it, expect } from "vitest";
import { competitiveFromLight, reportFromLight } from "./store";
import { competitiveReportOut, reportOut } from "./serializers";

describe("light list rows", () => {
  it("rebuild the report_data the summary serializer reads", () => {
    const row = reportFromLight({ id: "r", client_id: "c", report_type: "weekly", status: "completed", date_range_start: "2026-08-01", date_range_end: "2026-08-31", gamma_url: null, duration_minutes: 38, created_at: "2026-09-01T00:00:00.000Z", demo_job_id: null,
      rd_period: { current_month: { start: "2026-08-01", end: "2026-08-31" }, previous_month: { start: "2026-07-01", end: "2026-07-31" } }, rd_counts: { total_recommendations: 12 }, rd_metrics: { impressions_change: -2 }, rd_warnings: ["w"], rd_trend: "ok", rd_gamma_status: "ok", rd_gamma_url: "https://gamma.app/x", rd_completed: "2026-09-01T07:38:00.000Z", rd_error: null, rd_duration: 38 });
    expect(reportOut(row)).toMatchObject({ previous_period: { start: "2026-07-01" }, counts: { total_recommendations: 12 }, warnings: ["w"], trend_status: "ok", deck: { url: "https://gamma.app/x", status: "ok" }, completed_at: "2026-09-01T07:38:00.000Z" });
    const c = competitiveFromLight({ id: "x", client_id: "c", set_id: "s", status: "complete", gamma_url: null, duration_minutes: 20, date_range_start: null, date_range_end: null, created_at: "2026-09-25T00:00:00.000Z", demo_job_id: null, rd_period: { start: "2026-08-25", end: "2026-09-24", days: 31 }, rd_totals: { posts_analyzed: 4 }, rd_quality: { state: "needs_review" }, rd_provider: "ok", rd_generated: "2026-09-25T08:00:00.000Z", rd_gamma_url: null });
    expect(competitiveReportOut(c)).toMatchObject({ period: { start: "2026-08-25", days: 31 }, totals: { posts_analyzed: 4 }, quality_check: { state: "needs_review" }, completed_at: "2026-09-25T08:00:00.000Z" });
  });
});
