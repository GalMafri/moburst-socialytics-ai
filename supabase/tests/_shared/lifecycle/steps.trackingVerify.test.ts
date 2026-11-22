// QA 22 Nov 2026 (P39-01): RivalIQ's "not yet one company per website; check status later" answer after a plan-full wait.
// Live shape (Adaptive Sound Technologies, 22 Nov): status failed after 4 tries, result still says waiting_for rivaliq_full.
import { afterEach, describe, expect, it } from "vitest";
import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../../functions/_shared/lifecycle/fakeDb";
import { rowAfter, type StepRow } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); });

const T = "2026-11-21T10:00:00.000Z";
const set = { id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null };
const client = { id: "c1", name: "Adaptive Sound Technologies", website_url: "https://www.adaptivesound.com/", field_sources: {} };

describe("tracking after RivalIQ's verify answer 'check status later'", () => {
  it("is a wait for RivalIQ, not a failure whose row still says waiting_for rivaliq_full", async () => {
    const db = fakeDb({ clients: [client], competitor_sets: [set], competitors: [] }, { lifecycle_write_client: writeClientRpc });
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.now = () => new Date(T);
    // rivaliqSetup.ts:95, thrown through advanceSetupOnServer on the run after the plan-full wait.
    deps.advanceSetupOnServer = (async () => { throw new Error("RivalIQ has not returned exactly one company for every reviewed website. Nothing was linked; check status later."); }) as never;
    const key = (await STEPS.tracking.inputs(db, client, new Map()))!;
    const prev: StepRow = { client_id: "c1", step: "tracking", inputs_key: key, status: "running", attempts: 0, attempted_at: T, done_at: null, next_attempt_at: null, result: { set_id: "s1", waiting_for: "rivaliq_full" }, error: null };
    let outcome;
    try { outcome = await STEPS.tracking.run(db, client, { force: true, previous: prev, rows: new Map([["tracking", prev]]) }); } catch (e) { outcome = { status: "failed" as const, error: (e as Error).message }; }
    const stored = rowAfter(prev, { client_id: "c1", step: "tracking", inputs_key: key }, outcome, new Date(T));
    // The row must not say failed while its result says it waits for a free place on the plan.
    expect({ status: stored.status, waiting_for: stored.result?.waiting_for }).not.toEqual({ status: "failed", waiting_for: "rivaliq_full" });
    // A "check status later" answer is RivalIQ still settling: expected a wait with a recheck, like "pending".
    expect(stored.status).toBe("waiting");
  });
});
