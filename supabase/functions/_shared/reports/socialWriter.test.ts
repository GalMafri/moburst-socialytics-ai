// @vitest-environment node
// The social report writer, shared by update-report (n8n's writeback) and the
// in-app pipeline. n8n's path is update-report's as it was before the move;
// the in-app path adds the attempt fence and the running-only rule.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../lifecycle/fakeDb";
import { handleSocialWrite } from "./socialWriter";

const CREATED = "2026-11-07T07:15:02.000Z";
const NOW = () => Date.parse("2026-11-07T07:40:30.000Z");
const db = (status = "running") => fakeDb({ reports: [{ id: "r1", created_at: CREATED, status, report_data: {}, gamma_url: null, duration_minutes: null }] });

describe("n8n's writeback, unchanged", () => {
  it("needs a report id", async () => {
    expect(await handleSocialWrite(db(), { status: "completed" })).toEqual({ status: 400, body: { error: "report_id is required" } });
  });

  it("writes what it is sent, and the runtime from created_at when n8n sends 0", async () => {
    const d = db();
    const r = await handleSocialWrite(d, { report_id: "r1", status: "completed", report_data: { a: 1 }, gamma_url: "", duration_minutes: 0 }, { now: NOW });
    expect(r.status).toBe(200);
    expect(d.tables.reports[0]).toMatchObject({ status: "completed", report_data: { a: 1 }, gamma_url: "", duration_minutes: 25 });
    // A real number wins.
    await handleSocialWrite(d, { report_id: "r1", duration_minutes: 7 }, { now: NOW });
    expect(d.tables.reports[0].duration_minutes).toBe(7);
  });

  it("never fails a completed report, and answers a late writeback as done", async () => {
    const d = db("completed");
    expect(await handleSocialWrite(d, { report_id: "r1", status: "failed", report_data: { error: "x" } }, { now: NOW })).toEqual({ status: 200, body: { ok: true, skipped: "No unfinished report to fail" } });
    expect(d.tables.reports[0].status).toBe("completed");
    expect(await handleSocialWrite(d, { report_id: "gone", status: "completed" }, { now: NOW })).toEqual({ status: 200, body: { ok: true, skipped: "This run was replaced by a newer one" } });
  });

  it("writes whatever the status while there is no fence (n8n's path has none)", async () => {
    const d = db("failed");
    await handleSocialWrite(d, { report_id: "r1", status: "completed", report_data: { b: 2 } }, { now: NOW });
    expect(d.tables.reports[0]).toMatchObject({ status: "completed", report_data: { b: 2 } });
  });
});

describe("the in-app pipeline's writes", () => {
  it("write only the attempt the run was started for, and only while it runs", async () => {
    const d = db();
    const fenced = { attemptStartedAt: CREATED, onlyRunning: true, now: NOW };
    expect(await handleSocialWrite(d, { report_id: "r1", status: "completed", report_data: { a: 1 } }, { ...fenced, attemptStartedAt: "2026-11-07T06:00:00.000Z" })).toEqual({ status: 200, body: { ok: true, skipped: "superseded report attempt" } });
    expect(d.tables.reports[0].status).toBe("running");
    const r = await handleSocialWrite(d, { report_id: "r1", status: "completed", report_data: { a: 1 }, gamma_url: "https://gamma.app/docs/x", duration_minutes: 24 }, fenced);
    expect(r.status).toBe(200);
    expect(d.tables.reports[0]).toMatchObject({ status: "completed", report_data: { a: 1 }, duration_minutes: 24 });
    expect(await handleSocialWrite(d, { report_id: "r1", status: "completed", report_data: { b: 2 } }, fenced)).toEqual({ status: 200, body: { ok: true, skipped: "report is no longer running" } });
    expect(await handleSocialWrite(d, { report_id: "gone", status: "completed" }, fenced)).toEqual({ status: 200, body: { ok: true, skipped: "superseded report attempt" } });
  });

  it("refuse to write without an attempt", async () => {
    expect((await handleSocialWrite(db(), { report_id: "r1", status: "completed" }, { attemptStartedAt: null, onlyRunning: true })).status).toBe(400);
  });
});
