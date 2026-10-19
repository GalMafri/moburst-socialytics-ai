import { afterEach, describe, expect, it } from "vitest";
import { nextLookAt, runLifecycle, runLifecycleStep, runStepNow } from "./run";
import { deps, STEPS } from "./steps";
import { fakeDb, writeClientRpc } from "./fakeDb";
import { rowAfter } from "./policy";

const original = { ...deps };
const originalAccess = STEPS.access;
afterEach(() => {
  Object.assign(deps, original);
  STEPS.access = originalAccess;
});

const NOW = new Date("2026-10-19T10:00:00Z");
const base = { id: "c1", name: "Pay The Pyper", website_url: null, archived_at: null, demo_job_id: null, field_sources: {}, company_slug: null };
const db = (client: Record<string, unknown> = {}) =>
  fakeDb({ clients: [{ ...base, ...client }], client_lifecycle_steps: [], scheduled_jobs: [], competitor_sets: [], sprout_profiles: [], sprout_profile_removals: [] }, { lifecycle_write_client: writeClientRpc });

describe("runLifecycle", () => {
  it("leaves a demo copy to its demo job", async () => {
    const d = db({ demo_job_id: "job-1" });
    expect(await runLifecycle(d, { id: "j", client_id: "c1", payload: null }, NOW)).toMatchObject({ status: "skipped" });
    expect(d.tables.scheduled_jobs).toEqual([]);
  });
  it("queues the steps whose inputs exist, claimed so a second look queues nothing", async () => {
    const d = db();
    const first = await runLifecycle(d, { id: "j", client_id: "c1", payload: null }, NOW);
    // A client with a name and no website: its accounts (by Sprout's brand name) and its slug.
    expect(first.result).toEqual({ queued: ["accounts (new)", "access (new)"] });
    expect(d.tables.scheduled_jobs).toMatchObject([{ kind: "lifecycle_step", payload: { step: "accounts", force: false, why: "new" } }, { kind: "lifecycle_step", payload: { step: "access" } }]);
    expect((await runLifecycle(d, { id: "j2", client_id: "c1", payload: null }, NOW)).result).toEqual({ queued: [] });
  });
});

describe("runLifecycleStep", () => {
  it("stores the outcome and looks at the client again at once, so the steps after it start", async () => {
    const d = db();
    await runLifecycleStep(d, { id: "j", client_id: "c1", payload: { step: "access" } }, NOW);
    expect(d.tables.client_lifecycle_steps).toMatchObject([{ step: "access", status: "done", result: { slug: "pay-the-pyper" } }]);
    expect(d.tables.clients[0].company_slug).toBe("pay-the-pyper");
    expect(d.tables.scheduled_jobs).toMatchObject([{ kind: "lifecycle", client_id: "c1" }]);
  });
  it("looks again when a wait or a retry is due, not before", () => {
    const at = new Date("2026-10-19T10:00:00Z");
    const waiting = rowAfter(null, { client_id: "c1", step: "tracking", inputs_key: "k" }, { status: "waiting", reason: "in_progress", recheckMinutes: 5 }, at);
    expect(nextLookAt(waiting, { status: "waiting", reason: "in_progress", recheckMinutes: 5 }, at)?.toISOString()).toBe("2026-10-19T10:05:00.000Z");
    const forInput = rowAfter(null, { client_id: "c1", step: "tracking", inputs_key: "k" }, { status: "waiting", reason: "selection" }, at);
    expect(nextLookAt(forInput, { status: "waiting", reason: "selection" }, at)).toBeNull();
  });
});

describe("runStepNow", () => {
  it("runs a due step in the request, then answers from what it stored", async () => {
    const d = db({ demo_job_id: "job-1" });
    const first = await runStepNow(d, "c1", "access", NOW);
    expect(first).toMatchObject({ status: "done", ran: true, result: { slug: "pay-the-pyper" } });
    // A demo copy's runs never queue looks: its job drives it.
    expect(d.tables.scheduled_jobs).toEqual([]);
    expect(await runStepNow(d, "c1", "access", NOW)).toMatchObject({ status: "done", ran: false });
  });
  it("carries on with work it started without waiting for the recheck time", async () => {
    const d = db({ demo_job_id: "job-1" });
    let runs = 0;
    STEPS.access = { ...originalAccess, async run() { runs++; return runs === 1 ? { status: "waiting", reason: "in_progress", recheckMinutes: 60, result: { phase: 1 } } : { status: "done", result: { phase: 2 } }; } };
    expect(await runStepNow(d, "c1", "access", NOW)).toMatchObject({ status: "waiting", waiting_for: "in_progress" });
    expect(await runStepNow(d, "c1", "access", NOW)).toMatchObject({ status: "done", result: { phase: 2 } });
    expect(runs).toBe(2);
  });
  it("answers 'no_input' for a step whose input does not exist", async () => {
    expect(await runStepNow(db(), "c1", "brand_read", NOW)).toMatchObject({ status: "no_input", ran: false });
  });
});
