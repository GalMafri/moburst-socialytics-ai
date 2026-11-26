// QA 22 Nov 2026 (P47-05): the monthly report's text check reads the newest complete competitive report
// created before it, held or not; the report page and the run's payload use the newest
// one that passed its checks. A recount of that one never reaches the monthly text.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../support/dbFake";
import { reportTextCheck } from "../../../functions/_shared/reports/correctText";
import { competitiveReportQuality } from "../../../functions/_shared/competitive/reportEvidence";

const monthly = { id: "r1", client_id: "c1", status: "completed", created_at: "2026-11-05T08:00:00Z", date_range_start: "2026-10-01", date_range_end: "2026-10-31",
  report_data: { sprout_performance: {}, ai_analysis: { sprout_performance_analysis: { key_insights: ["Acme published 12 posts in the period, more than Rival."] } } }, correction_audit: null, clients: { name: "Acme", archived_at: null } };
// A: ready, the one the run was sent and the page shows; its client figures were recounted (12 posts became 9).
const ready = { id: "A", created_at: "2026-10-20T08:00:00Z", report_data: { aggregates: { companies: [{ name: "Acme", is_client: true, post_count: 9 }, { name: "Rival", post_count: 5 }] } },
  correction_audit: { original: { client_company: { name: "Acme", is_client: true, post_count: 12 } } } };
// B: newer, complete but held (the source was still collecting), so no screen shows it.
const held = { id: "B", created_at: "2026-11-01T08:00:00Z", report_data: { provider_status: 0, aggregates: { companies: [{ name: "Acme", is_client: true, post_count: 7 }, { name: "Rival", post_count: 4 }] } }, correction_audit: null };

// The complete competitive reports created before the monthly one, newest first, as the query orders them.
const db = (...complete: unknown[]) => fakeDb((call) => (call.table === "reports" ? { data: monthly } : call.table === "competitive_reports" ? { data: complete } : { data: [] })).db;

describe("P47-05 text check reads a held competitive report", () => {
  it("the fixture: A passed its checks, B did not", () => {
    expect(competitiveReportQuality(ready.report_data).ready).toBe(true);
    expect(competitiveReportQuality(held.report_data).ready).toBe(false);
  });
  it("control: read against A, the sentence quoting A's old count is found stale", async () => {
    expect((await reportTextCheck(db(ready), "reports", "r1"))!.stale.length).toBe(1);
  });
  it("with B newest (as the query orders them), the stale sentence is still found", async () => {
    expect((await reportTextCheck(db(held, ready), "reports", "r1"))!.stale.length).toBe(1);
  });
});
