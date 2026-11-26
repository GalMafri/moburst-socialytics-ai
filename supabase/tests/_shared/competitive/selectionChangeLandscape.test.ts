// @vitest-environment node
// QA 22 Nov 2026 (P31-04): a setup in progress whose selection then changed
// (one competitor swapped) had its job row deleted, and with it the only record
// of the landscape it created. The next run created a second landscape under
// the same name; the first kept following the old companies (plan places) and
// was never removed. Two landscapes with one name then made a lost create
// answer permanently "uncertain".
import { describe, expect, it } from "vitest";
import { advanceSetupOnServer, planFingerprint, setupPlan } from "../../../functions/_shared/competitive/rivaliqSetupRun";
import { fakeDb } from "../../support/lifecycleFakeDb";

const tables = () => ({
  competitor_sets: [{ id: "set", client_id: "c", status: "confirmed", rivaliq_landscape_id: null }],
  clients: [{ id: "c", name: "Olo", website_url: "https://olo.com", archived_at: null, demo_job_id: null }],
  competitors: ["one", "two", "three"].map((n, i) => ({ id: n, set_id: "set", name: n, website_url: `https://${n}.com`, is_selected: true, selected_rank: i + 1 })),
  rivaliq_setup_jobs: [] as Record<string, unknown>[],
});
const NAME = "Socialytics - Olo - set";
const co = (id: number, host: string) => ({ id, url: `https://${host}` });

async function startedThenSwapped() {
  const db = fakeDb(tables());
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
  // The follow of "three" failed on plan capacity; L1 holds the client, one and two.
  db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "following_failed", landscape_id: "L1", operation_token: "t", lease_id: null, lease_until: null });
  // Staff swap competitor three for four.
  Object.assign(db.tables.competitors[2], { id: "four", name: "four", website_url: "https://four.com" });
  return db;
}

describe("P31-04 a selection change during setup", () => {
  it("follows the new selection into the landscape it already made", async () => {
    const db = await startedThenSwapped();
    const calls: string[] = [];
    let followed: unknown = null;
    const api = async (path: string, method = "GET", body?: unknown) => {
      calls.push(`${method} ${path}`);
      if (path === "/landscapes/L1" && method === "GET") return { landscape: { id: "L1", name: NAME } };
      if (path === "/landscapes" && method === "GET") return { landscapes: [{ id: "L1", name: NAME, companies: [co(1, "olo.com"), co(2, "one.com"), co(3, "two.com")] }] };
      if (path === "/landscapes" && method === "POST") return { landscape: { id: "L2" } };
      if (method === "POST" && path.endsWith("/companies/byUrl")) { followed = body; return { token: "tok" }; }
      if (path.startsWith("/pendingOperations/")) return { status: 1 };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const out = await advanceSetupOnServer(db, "set", api);
    const job = db.tables.rivaliq_setup_jobs[0];
    expect(out.state).toBe("pending");
    expect(job.landscape_id).toBe("L1");
    expect(calls).not.toContain("POST /landscapes");
    expect(calls).toContain("POST /landscapes/L1/companies/byUrl");
    expect(followed).toEqual({ companyUrls: ["https://olo.com/", "https://one.com/", "https://two.com/", "https://four.com/"] });
    expect(job.fingerprint).toBe(await planFingerprint(await setupPlan(db, "set")));
  });

  it("never follows into a landscape it did not make (an imported or shared one)", async () => {
    const db = await startedThenSwapped();
    const calls: string[] = [];
    const api = async (path: string, method = "GET") => {
      calls.push(`${method} ${path}`);
      if (path === "/landscapes/L1" && method === "GET") return { landscape: { id: "L1", name: "Agency shared set" } };
      if (path === "/landscapes" && method === "GET") return { landscapes: [] };
      if (path === "/landscapes" && method === "POST") return { landscape: { id: "L2" } };
      if (method === "POST" && path.endsWith("/companies/byUrl")) return { token: "tok" };
      if (path.startsWith("/pendingOperations/")) return { status: 1 };
      throw new Error(`unexpected ${method} ${path}`);
    };
    await advanceSetupOnServer(db, "set", api);
    expect(calls).not.toContain("POST /landscapes/L1/companies/byUrl");
    expect(db.tables.rivaliq_setup_jobs[0].landscape_id).toBe("L2");
  });

  it("does not stay in create_requested for good when two landscapes carry the setup's name", async () => {
    const db = fakeDb(tables());
    const plan = await setupPlan(db, "set");
    // A create whose answer was lost, while an earlier selection's landscape still carries the name.
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "create_requested", landscape_id: null, operation_token: null, lease_id: null, lease_until: null });
    const api = async (path: string, method = "GET") => {
      if (path === "/landscapes" && method === "GET") return { landscapes: [{ id: "L1", name: NAME, companies: [co(1, "olo.com"), co(2, "one.com")] }, { id: "L2", name: NAME, companies: [] }] };
      if (method === "POST" && path.endsWith("/companies/byUrl")) return { token: "tok" };
      if (path.startsWith("/pendingOperations/")) return { status: 1 };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const out = await advanceSetupOnServer(db, "set", api);
    expect(out.state).toBe("pending");
    expect(db.tables.rivaliq_setup_jobs[0]).toMatchObject({ phase: "following", landscape_id: "L1" });
  });
});
