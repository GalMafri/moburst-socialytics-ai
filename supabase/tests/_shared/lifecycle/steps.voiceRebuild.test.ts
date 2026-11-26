// QA 22 Nov 2026 (P39-04): the voice rebuild asked for because an own account was parked fails; the voice step takes the failed job as made and never asks again.
import { afterEach, describe, expect, it } from "vitest";
import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../support/lifecycleFakeDb";
import { ONE_PER_NETWORK_RULE } from "../../../functions/_shared/lifecycle/accounts";
import type { StepRow } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); });
const BUILT = "2026-11-01T10:00:00.000Z";
const PARKED = "2026-11-17T10:00:00.000Z";

describe("voice step after an own account was parked", () => {
  it("asks for the rebuild again when the one it asked for failed", async () => {
    deps.now = () => new Date("2026-11-18T10:00:00.000Z");
    const client = { id: "c1", name: "Acme", voice_built_at: BUILT };
    const db = fakeDb({ clients: [{ ...client, social_voice: { built_at: BUILT, overall: "Warm." } }], scheduled_jobs: [] }, { lifecycle_write_client: writeClientRpc });
    const accounts = { step: "accounts", status: "done", inputs_key: `name:acme|own:${ONE_PER_NETWORK_RULE}`, result: { display_names: [], own_dropped_at: PARKED } } as unknown as StepRow;
    const rows = new Map([["accounts", accounts]]);
    await STEPS.voice.run(db, client, { force: false, previous: null, rows });
    expect(db.tables.scheduled_jobs).toHaveLength(1);
    // The rebuild job ran and failed (Sprout or the model did not answer).
    db.tables.scheduled_jobs[0].status = "failed";
    const again = await STEPS.voice.run(db, client, { force: true, previous: null, rows });
    const queued = db.tables.scheduled_jobs.filter((j) => !j.status || j.status === "queued").length;
    // A new rebuild is queued, and the step waits for it, looked at again hourly.
    expect({ status: again.status, queued }).toEqual({ status: "waiting", queued: 1 });
    expect(again).toMatchObject({ recheckMinutes: 60 });
    // Each failed rebuild is asked again, three in all; then the step fails (the monthly rebuild is the next).
    for (const j of db.tables.scheduled_jobs) j.status = "failed";
    expect(await STEPS.voice.run(db, client, { force: true, previous: null, rows })).toMatchObject({ status: "waiting" });
    expect(db.tables.scheduled_jobs).toHaveLength(3);
    for (const j of db.tables.scheduled_jobs) j.status = "failed";
    expect(await STEPS.voice.run(db, client, { force: true, previous: null, rows })).toMatchObject({ status: "failed" });
    expect(db.tables.scheduled_jobs).toHaveLength(3);
    // A rebuild that was made ends the wait.
    db.tables.scheduled_jobs[2].status = "done";
    expect(await STEPS.voice.run(db, client, { force: true, previous: null, rows })).toMatchObject({ status: "done" });
  });
});
