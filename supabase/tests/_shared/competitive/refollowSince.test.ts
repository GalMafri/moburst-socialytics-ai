// @vitest-environment node
// QA 22 Nov 2026 (P31-06): when a failed follow is sent again (the daily rivaliq_full recheck), the pending outcome's
// `since` ("when the setup last moved") is the time of the old failure, read before the reset, so the
// lifecycle (steps.ts:1974) waits 6 hours, not 5 minutes, before it looks at the fresh follow.
import { describe, expect, it } from "vitest";
import { advanceSetupOnServer, planFingerprint, setupPlan } from "../../../functions/_shared/competitive/rivaliqSetupRun";
import { fakeDb } from "../../support/lifecycleFakeDb";

describe("P31-06 since after a re-follow", () => {
  it("is the time of the re-follow", async () => {
    const db = fakeDb({
      competitor_sets: [{ id: "set", client_id: "c", status: "confirmed", rivaliq_landscape_id: null }],
      clients: [{ id: "c", name: "Olo", website_url: "https://olo.com", archived_at: null, demo_job_id: null }],
      competitors: ["one", "two", "three"].map((n, i) => ({ id: n, set_id: "set", name: n, website_url: `https://${n}.com`, is_selected: true, selected_rank: i + 1 })),
      rivaliq_setup_jobs: [],
    });
    // PostgREST hands back copies; the lifecycle fakeDb hands back the live rows (P38-3), which would
    // let a later save rewrite the copy this run already read. Copy what is read, as the database does.
    const from = db.from.bind(db);
    db.from = (t: string) => {
      const q = from(t);
      const then = q.then.bind(q);
      q.then = (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => then((r: unknown) => ok(structuredClone(r)), bad);
      return q;
    };
    const plan = await setupPlan(db, "set");
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "following_failed", landscape_id: "L1", operation_token: "old", updated_at: twoDaysAgo, lease_id: null, lease_until: null });
    const api = async (path: string, method = "GET") => (method === "POST" ? { token: "new" } : path.startsWith("/pendingOperations/") ? { status: 1 } : {});
    const out = await advanceSetupOnServer(db, "set", api);
    expect(out.state).toBe("pending");
    expect(Date.now() - Date.parse(String((out as { since: string }).since))).toBeLessThan(3_600_000);
  });
});
