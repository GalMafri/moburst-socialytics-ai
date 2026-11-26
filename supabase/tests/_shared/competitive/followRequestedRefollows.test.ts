// @vitest-environment node
// QA 22 Nov 2026 (P31-01): a follow-by-URL POST that RivalIQ (or the connection coordinator) refused leaves the
// setup in `follow_requested`; every later run reads the empty landscape, throws "check status
// later", and never sends the follow again. Expected: the follow is re-sent once the read shows
// nothing was followed (as a lost create is restarted). Actual: phase stays follow_requested.
import { describe, expect, it } from "vitest";
import { advanceSetupOnServer, planFingerprint, setupPlan } from "../../../functions/_shared/competitive/rivaliqSetupRun";
import { fakeDb } from "../../support/lifecycleFakeDb";

const tables = () => ({
  competitor_sets: [{ id: "set", client_id: "c", status: "confirmed", rivaliq_landscape_id: null }],
  clients: [{ id: "c", name: "Olo", website_url: "https://olo.com", archived_at: null, demo_job_id: null }],
  competitors: ["one", "two", "three"].map((n, i) => ({ id: n, set_id: "set", name: n, website_url: `https://${n}.com`, is_selected: true, selected_rank: i + 1 })),
  rivaliq_setup_jobs: [] as Record<string, unknown>[],
});

describe("P31-01 follow_requested after a refused follow POST", () => {
  it("sends the follow again on a later run instead of waiting forever", async () => {
    const db = fakeDb(tables());
    const plan = await setupPlan(db, "set"); // the row as the table default makes it: phase "ready"
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "ready", lease_id: null, lease_until: null });
    const posts: string[] = [];
    let busy = true;
    const api = async (path: string, method = "GET") => {
      if (method === "POST" && path === "/landscapes") return { landscape: { id: "L1" } };
      if (method === "POST" && path.endsWith("/companies/byUrl")) {
        posts.push(path);
        // First follow: the coordinator answered 429 ConnectionBusy, nothing reached RivalIQ.
        if (busy) { busy = false; throw new Error("RivalIQ returned HTTP 429. Check API permissions or account capacity, then check setup status. No automatic POST retry was sent."); }
        return { token: "tok" };
      }
      if (path === "/landscapes") return { landscapes: [] };
      if (path === "/landscapes/L1/companies") return { companies: [] }; // nothing was followed
      if (path.startsWith("/pendingOperations/")) return { status: 1 };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const run = () => advanceSetupOnServer(db, "set", api).catch((e: Error) => e.message);
    await run(); // ready -> create -> created -> follow POST refused
    for (let day = 0; day < 4; day++) await run(); // the lifecycle's later retries
    const job = db.tables.rivaliq_setup_jobs[0];
    expect(posts.length).toBeGreaterThan(1);
  });
});
