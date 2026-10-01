import { describe, it, expect } from "vitest";
import type { JobRecord, StepDef } from "../_shared/api/jobs";
import { discardJob, workerTick } from "./worker";

const job = (id: string, over: Partial<JobRecord> = {}): JobRecord => ({ id, status: "queued", steps: [{ name: "a", status: "pending" }, { name: "b", status: "pending" }], outputs: null, gaps: [], client_id: null, run_ids: [], next_check_at: null, started_at: null, completed_at: null, error: null, input: {}, ...over });

describe("workerTick", () => {
  it("advances every leased job and releases each one even when another throws", async () => {
    const saved: string[] = [];
    const released: string[] = [];
    const steps: StepDef<{ id: string }>[] = [
      { name: "a", run: async (j) => { if (j.id === "j-bad") throw new Error("boom"); return { status: "done" }; } },
      { name: "b", run: async () => ({ status: "done" }) },
    ];
    const r = await workerTick({
      lease: async () => [job("j-ok"), job("j-bad")], save: async (j) => { saved.push(`${j.id}:${j.status}`); }, release: async (id) => { released.push(id); },
      ctx: { id: "x" }, steps, budgetMs: 60_000, now: () => new Date("2026-09-30T12:00:00Z"),
    });
    expect(r.leased).toBe(2);
    expect(r.results.map((x) => [x.id, x.status])).toEqual([["j-ok", "completed"], ["j-bad", "partial"]]);
    expect(released.sort()).toEqual(["j-bad", "j-ok"]);
    expect(saved).toContain("j-ok:completed");
  });
  it("releases a job whose save throws and reports the error", async () => {
    const released: string[] = [];
    const r = await workerTick({
      lease: async () => [job("j-1")], save: async () => { throw new Error("db down"); }, release: async (id) => { released.push(id); },
      ctx: {}, steps: [{ name: "a", run: async () => ({ status: "done" }) }, { name: "b", run: async () => ({ status: "done" }) }], budgetMs: 60_000, now: () => new Date(),
    });
    expect(released).toEqual(["j-1"]);
    expect(r.results[0]).toMatchObject({ id: "j-1", error: "db down" });
  });
  it("does nothing when nothing is due", async () => {
    const r = await workerTick({ lease: async () => [], save: async () => {}, release: async () => {}, ctx: {}, steps: [], budgetMs: 1, now: () => new Date() });
    expect(r).toEqual({ leased: 0, results: [] });
  });
});

describe("discardJob", () => {
  function fakeDb(clientDemoJob: string | null) {
    const calls: Array<{ table: string; op: string; filter: Record<string, unknown> }> = [];
    const del = (table: string) => ({ delete: () => ({ eq: (col: string, val: unknown) => ({ select: async () => { calls.push({ table, op: "delete", filter: { [col]: val } }); return { data: [{ id: 1 }, { id: 2 }].slice(0, table === "reports" || table === "competitive_reports" ? 1 : 2), error: null }; } }) }) });
    const db = {
      from: (table: string) => table === "clients"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "c-1", name: "Brooklinen", demo_job_id: clientDemoJob, created_by: "u-creator" }, error: null }) }) }) }
        : { ...del(table) },
    };
    return { db, calls };
  }
  it("deletes a client the job created through delete-client", async () => {
    const { db, calls } = fakeDb("job-1");
    const called: Array<{ name: string; body: unknown }> = [];
    const j = job("job-1", { client_id: "c-1", status: "completed" });
    j.steps = [{ name: "resolve_client", status: "done", data: { acted_as: "u-actor" } }];
    const r = await discardJob(j, { db: db as never, call: async (name, body, actAs) => { called.push({ name, body, actAs }); return { ok: true, status: 200, data: {}, text: "{}" }; } });
    expect(called).toEqual([{ name: "delete-client", body: { client_id: "c-1" }, actAs: "u-actor" }]);
    // Without the resolve step's record, the client's creator is the actor.
    const again: unknown[] = [];
    await discardJob(job("job-1", { client_id: "c-1", status: "completed" }), { db: db as never, call: async (_n, _b, actAs) => { again.push(actAs); return { ok: true, status: 200, data: {}, text: "{}" }; } });
    expect(again).toEqual(["u-creator"]);
    expect(r.removed.client).toBe(true);
    expect(calls).toEqual([]);
  });
  it("removes only the flagged rows when the client existed before", async () => {
    const { db, calls } = fakeDb(null);
    const r = await discardJob(job("job-1", { client_id: "c-1", status: "completed" }), { db: db as never, call: async () => { throw new Error("must not delete"); } });
    expect(r.removed).toEqual({ client: false, competitor_sets: 2, reports: 1, competitive_reports: 1, posts: 2, media_jobs: 2 });
    expect(calls.map((c) => c.table).sort()).toEqual(["competitive_reports", "competitor_sets", "media_jobs", "post_iterations", "reports"]);
    expect(calls.every((c) => c.filter.demo_job_id === "job-1")).toBe(true);
  });
  it("reports a refused delete", async () => {
    const { db } = fakeDb("job-1");
    await expect(discardJob(job("job-1", { client_id: "c-1", status: "completed" }), { db: db as never, call: async () => ({ ok: false, status: 500, data: null, text: "nope" }) })).rejects.toThrow(/delete-client/);
  });
});
