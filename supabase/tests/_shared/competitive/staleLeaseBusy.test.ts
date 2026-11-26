// @vitest-environment node
// QA 22 Nov 2026 (P31-05): a run that died holding the setup row's lease (edge
// function killed past its wall clock: the `finally` release never runs)
// leaves lease_id set. Once that lease has expired the same selection could
// lease the row again, but a CHANGED selection (a competitor swapped, a
// website or the client's name edited) could not: the old row was deleted only
// `where lease_id is null`. Every run answered "busy"; the lifecycle waited
// in_progress and looked again every 3 minutes, for good.
import { describe, expect, it } from "vitest";
import { advanceSetupOnServer, planFingerprint, setupPlan } from "../../../functions/_shared/competitive/rivaliqSetupRun";
import { fakeDb } from "../../support/lifecycleFakeDb";

describe("P31-05 an expired lease left by a dead run, then a selection change", () => {
  it("lets a later run take the setup over instead of answering busy for good", async () => {
    const db = fakeDb({
      competitor_sets: [{ id: "set", client_id: "c", status: "confirmed", rivaliq_landscape_id: null }],
      clients: [{ id: "c", name: "Olo", website_url: "https://olo.com", archived_at: null, demo_job_id: null }],
      competitors: ["one", "two", "three"].map((n, i) => ({ id: n, set_id: "set", name: n, website_url: `https://${n}.com`, is_selected: true, selected_rank: i + 1 })),
      rivaliq_setup_jobs: [],
    });
    // The table's default (20260923000001_rivaliq_setup_jobs.sql: phase NOT NULL DEFAULT 'ready').
    const from = db.from.bind(db);
    db.from = (t: string) => {
      const q = from(t);
      if (t !== "rivaliq_setup_jobs") return q;
      const upsert = q.upsert.bind(q);
      q.upsert = (p: Record<string, unknown>, o: unknown) => upsert({ phase: "ready", lease_id: null, lease_until: null, ...p }, o);
      return q;
    };
    const plan = await setupPlan(db, "set");
    const expired = new Date(Date.now() - 3_600_000).toISOString();
    // The read finds no landscape the dead run made: the row is removed and setup starts again.
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "following", landscape_id: "L1", operation_token: "t", lease_id: "dead-run", lease_until: expired });
    db.tables.competitors[2].website_url = "https://three-new.com"; // staff correct a competitor's website
    const api = async (path: string, method = "GET") => {
      if (path === "/landscapes" && method === "POST") return { landscape: { id: "L2" } };
      if (method === "POST" && path.endsWith("/companies/byUrl")) return { token: "tok" };
      if (path.startsWith("/pendingOperations/")) return { status: 1 };
      return { landscapes: [] };
    };
    const outcomes = [];
    for (let run = 0; run < 3; run++) outcomes.push((await advanceSetupOnServer(db, "set", api)).state);
    expect(outcomes).not.toContain("busy");
    expect(db.tables.rivaliq_setup_jobs[0].fingerprint).not.toBe(await planFingerprint(plan));
  });
});
