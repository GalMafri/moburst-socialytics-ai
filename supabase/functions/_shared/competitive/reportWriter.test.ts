// @vitest-environment node
// The competitive writer shared by update-competitive-report (n8n's
// writeback) and the in-app pipeline: the attempt fence, the snapshot and
// report writes, the coverage notes, the quality hold, the set lifecycle,
// and the in-app pipeline's rule that writes only while the report runs.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../lifecycle/fakeDb";
import { completedCompetitiveReport, handleCompetitiveWrite } from "./reportWriter";

const ATTEMPT = "2026-10-07T07:15:04.906Z";
const READY = { provider_status: 1, aggregates: { metric_semantics_version: 4, companies: [] }, schema_note: "" };

function db(o: { status?: string; snapshot?: Record<string, unknown> | null } = {}) {
  return fakeDb({
    competitive_reports: [{ id: "rep-1", client_id: "client-1", set_id: "set-1", created_at: ATTEMPT, status: o.status ?? "running", report_data: {} }],
    competitor_sets: [{ id: "set-1", status: "analyzing" }],
    rivaliq_snapshots: o.snapshot === null ? [] : [{ id: "s0", report_id: "rep-1", endpoint: "socialposts", attempt_started_at: ATTEMPT, fetched_at: ATTEMPT, payload: o.snapshot ?? { expected_windows: 5, failed_windows: 0, truncated_pages: 0 } }],
  });
}
const report = (d: ReturnType<typeof db>) => d.tables.competitive_reports[0];

describe("handleCompetitiveWrite", () => {
  it("needs the report and its attempt, and lets a superseded attempt's write go quietly", async () => {
    expect(await handleCompetitiveWrite(db(), { op: "report", report_id: "rep-1" })).toEqual({ status: 400, body: { error: "report_id and attempt_started_at are required" } });
    expect(await handleCompetitiveWrite(db(), { op: "report", report_id: "gone", attempt_started_at: ATTEMPT })).toEqual({ status: 200, body: { ok: true, skipped: "superseded report attempt" } });
    expect(await handleCompetitiveWrite(db(), { op: "report", report_id: "rep-1", attempt_started_at: "2026-10-07T08:00:00Z" })).toEqual({ status: 200, body: { ok: true, skipped: "superseded report attempt" } });
    expect(await handleCompetitiveWrite(db(), { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, client_id: "client-2" })).toEqual({ status: 409, body: { error: "report client mismatch" } });
    expect(await handleCompetitiveWrite(db(), { op: "nothing", report_id: "rep-1", attempt_started_at: ATTEMPT })).toEqual({ status: 400, body: { error: "op must be 'snapshot' or 'report'" } });
  });

  it("appends a snapshot to the attempt", async () => {
    const d = db();
    const r = await handleCompetitiveWrite(d, { op: "snapshot", report_id: "rep-1", attempt_started_at: ATTEMPT, landscape_id: 652500, endpoint: "status", payload: { status: 1 } });
    expect(r.status).toBe(200);
    expect(d.tables.rivaliq_snapshots[1]).toMatchObject({ client_id: "client-1", attempt_started_at: ATTEMPT, report_id: "rep-1", landscape_id: "652500", endpoint: "status", params_hash: "", payload: { status: 1 } });
    expect((await handleCompetitiveWrite(d, { op: "snapshot", report_id: "rep-1", attempt_started_at: ATTEMPT, endpoint: "status", payload: {} })).status).toBe(400);
  });

  it("completes a report whose post coverage was saved, and marks the set complete", async () => {
    const d = db();
    const r = await handleCompetitiveWrite(d, { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, status: "complete", report_data: READY, duration_minutes: 12 });
    expect(r).toEqual({ status: 200, body: { ok: true, report: expect.objectContaining({ id: "rep-1", status: "complete" }) } });
    expect(report(d)).toMatchObject({ status: "complete", duration_minutes: 12, report_data: READY });
    expect(d.tables.competitor_sets[0].status).toBe("complete");
  });

  it("refuses to complete a report before its post coverage is saved", async () => {
    expect(await handleCompetitiveWrite(db({ snapshot: null }), { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, status: "complete", report_data: READY })).toEqual({ status: 409, body: { error: "Current attempt source coverage has not been saved" } });
  });

  it("says when windows did not load, and holds an analysis that does not pass its checks", async () => {
    const d = db({ snapshot: { expected_windows: 5, failed_windows: 1, truncated_pages: 0 } });
    await handleCompetitiveWrite(d, { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, status: "complete", report_data: { ...READY }, gamma_url: "https://gamma.app/x" });
    expect(report(d).status).toBe("failed");
    expect(report(d).gamma_url).toBeNull();
    expect(report(d).report_data.schema_note).toBe("1 of 5 weekly windows did not load, so this report covers only part of the period and the comparison is incomplete.");
    expect(report(d).report_data.quality_check).toEqual({ state: "needs_review", reasons: ["Some reporting windows did not load."] });
    expect(d.tables.competitor_sets[0].status).toBe("failed");
  });

  it("never turns a complete report into a failed one", async () => {
    const d = db({ status: "complete" });
    expect(await handleCompetitiveWrite(d, { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, status: "failed", report_data: { error: "late" } })).toEqual({ status: 200, body: { ok: true, skipped: "report already complete" } });
    expect(report(d).status).toBe("complete");
  });

  it("with onlyRunning (the in-app pipeline), writes nothing to a report that is no longer running", async () => {
    for (const status of ["failed", "complete"]) {
      const d = db({ status });
      expect(await handleCompetitiveWrite(d, { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, status: "complete", report_data: READY }, { onlyRunning: true })).toEqual({ status: 200, body: { ok: true, skipped: "report is no longer running" } });
      expect(await handleCompetitiveWrite(d, { op: "snapshot", report_id: "rep-1", attempt_started_at: ATTEMPT, landscape_id: 1, endpoint: "status", payload: {} }, { onlyRunning: true })).toEqual({ status: 200, body: { ok: true, skipped: "report is no longer running" } });
      expect(d.tables.rivaliq_snapshots).toHaveLength(1);
      expect(report(d).status).toBe(status);
    }
    const running = db();
    expect((await handleCompetitiveWrite(running, { op: "report", report_id: "rep-1", attempt_started_at: ATTEMPT, status: "complete", report_data: READY }, { onlyRunning: true })).body).toMatchObject({ ok: true });
    expect(report(running).status).toBe("complete");
  });
});

describe("completedCompetitiveReport", () => {
  it("adds the coverage notes and the quality check as the writer stores them", () => {
    expect(completedCompetitiveReport({ ...READY }, { expected_windows: 5, failed_windows: 0, truncated_pages: 0 })).toEqual({ status: "complete", report_data: READY, gamma_url_cleared: false });
    const held = completedCompetitiveReport({ ...READY, provider_status: 2 }, { expected_windows: 5 });
    expect(held.status).toBe("failed");
    expect(held.report_data.quality_check.reasons).toEqual(["RivalIQ is still collecting source data. Retry once tracking is ready."]);
    expect(completedCompetitiveReport({ ...READY }, { expected_windows: 5, truncated_pages: 2 }).report_data.totals).toEqual({ truncated_pages: 2 });
  });
});
