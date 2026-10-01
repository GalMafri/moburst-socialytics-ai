import { describe, it, expect } from "vitest";
import { buildFindings } from "./health";

const now = new Date("2026-10-01T12:00:00.000Z");
describe("buildFindings", () => {
  it("names stuck reports, failed schedules, failed media and demo jobs with the client", () => {
    const f = buildFindings({
      reports: [{ id: "r1", client_id: "c1", status: "running", created_at: "2026-10-01T09:00:00.000Z" }, { id: "r2", client_id: "c1", status: "running", created_at: "2026-10-01T11:30:00.000Z" }],
      competitive: [{ id: "x1", client_id: "c2", status: "running", created_at: "2026-10-01T08:00:00.000Z" }],
      schedules: [{ id: "s1", client_id: "c1", report_kind: "social", is_active: true, last_result: "failed: 503", last_run_at: null }, { id: "s2", client_id: "c1", report_kind: "social", is_active: true, last_result: "triggered", last_run_at: null }, { id: "s3", client_id: "c1", report_kind: "social", is_active: false, last_result: "failed", last_run_at: null }],
      mediaJobs: [{ id: "m1", client_id: "c2", status: "failed", error: "e", created_at: "2026-10-01T10:00:00.000Z" }, { id: "m2", client_id: "c2", status: "failed", error: "e", created_at: "2026-09-29T10:00:00.000Z" }],
      demoJobs: [{ id: "abcdef12-0000", status: "running", client_id: "c1", updated_at: "2026-10-01T07:00:00.000Z", completed_at: null, error: null }, { id: "12345678-0000", status: "failed", client_id: null, updated_at: "x", completed_at: "2026-10-01T11:00:00.000Z", error: "This key may not work on this client." }],
      clients: [{ id: "c1", name: "Bader Law" }, { id: "c2", name: "Calm" }],
    }, now);
    expect(f.map((x) => `${x.kind}:${x.client ?? "-"}`)).toEqual(["report_stuck:Bader Law", "competitive_report_stuck:Calm", "schedule_failed:Bader Law", "media_failed:Calm", "demo_job_stuck:Bader Law", "demo_job_failed:-"]);
    expect(f[0]).toMatchObject({ severity: "high", report_id: "r1", detail: "A social report has been running for 180 minutes.", link: expect.stringContaining("/clients/c1/reports/r1") });
    expect(f[3].detail).toBe("1 media generation failed in the last 24 hours.");
    expect(f[5]).toMatchObject({ job_id: "12345678-0000", detail: "Demo job 12345678 failed: This key may not work on this client.." });
  });
  it("is empty when everything is fine", () => {
    expect(buildFindings({ reports: [], competitive: [], schedules: [], mediaJobs: [], demoJobs: [], clients: [] }, now)).toEqual([]);
  });
});
