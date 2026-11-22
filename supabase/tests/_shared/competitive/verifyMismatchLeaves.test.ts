// @vitest-environment node
// QA 22 Nov 2026 (P31-02, P31-08): RivalIQ reports the follow done
// (pendingOperations status 2 for every URL) but its companies list never
// matches the plan (here the client's company carries the website its domain
// redirects to). The setup sat in `verify` for good: each run repeated the same
// read and threw "check status later", never re-followed and never named the
// website. A follow RivalIQ never answers sat in `following` the same way.
import { describe, expect, it } from "vitest";
import { advanceSetupOnServer, planFingerprint, setupPlan } from "../../../functions/_shared/competitive/rivaliqSetupRun";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const tables = () => ({
  competitor_sets: [{ id: "set", client_id: "c", status: "confirmed", rivaliq_landscape_id: null }],
  clients: [{ id: "c", name: "Adaptive", website_url: "https://adaptivesound.com", archived_at: null, demo_job_id: null }],
  competitors: ["one", "two", "three"].map((n, i) => ({ id: n, set_id: "set", name: n, website_url: `https://${n}.com`, is_selected: true, selected_rank: i + 1 })),
  rivaliq_setup_jobs: [] as Record<string, unknown>[],
});
const twoDaysAgo = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

describe("P31-02 verify that never matches", () => {
  it("matches the one company left over in its own landscape once RivalIQ said every website was followed", async () => {
    const db = fakeDb(tables());
    const plan = await setupPlan(db, "set");
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "following_failed", landscape_id: "L1", operation_token: "old", lease_id: null, lease_until: null });
    const calls: string[] = [];
    const api = async (path: string, method = "GET") => {
      calls.push(`${method} ${path}`);
      if (method === "POST" && path.endsWith("/companies/byUrl")) return { token: "tok" };
      if (path === "/pendingOperations/tok") return { status: 2, urls: Object.fromEntries(plan.companies.map((c) => [c.url, { status: 2 }])) };
      if (path === "/landscapes/L1/companies") return { companies: [
        { id: 10, url: "https://www.yogasleep.com" }, { id: 11, url: "https://one.com" }, { id: 12, url: "https://two.com" }, { id: 13, url: "https://three.com" },
      ] };
      if (path === "/landscapes/L1") return { landscape: { id: "L1", name: plan.name, focusCompanyId: 10 } };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const errors: string[] = [];
    for (let run = 0; run < 5; run++) await advanceSetupOnServer(db, "set", api).catch((e: Error) => errors.push(e.message));
    const phase = db.tables.rivaliq_setup_jobs[0].phase;
    expect(errors).toEqual([]);
    expect(phase).toBe("complete");
    expect(db.tables.competitor_sets[0].rivaliq_landscape_id).toBe("L1");
  });

  it("follows again, at most once a day, and names the website RivalIQ does not hold", async () => {
    const db = fakeDb(tables());
    const plan = await setupPlan(db, "set");
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "verify", landscape_id: "L1", operation_token: "old", updated_at: twoDaysAgo(), lease_id: null, lease_until: null });
    const posts: string[] = [];
    let token = 0;
    const api = async (path: string, method = "GET") => {
      if (method === "POST" && path.endsWith("/companies/byUrl")) { posts.push(path); return { token: `tok${++token}` }; }
      if (path.startsWith("/pendingOperations/")) return { status: 2, urls: Object.fromEntries(plan.companies.map((c) => [c.url, { status: 2 }])) };
      // Two reviewed websites are held under other addresses: nothing can be matched by elimination.
      if (path === "/landscapes/L1/companies") return { companies: [
        { id: 10, url: "https://www.yogasleep.com" }, { id: 11, url: "https://one.com" }, { id: 12, url: "https://two.com" }, { id: 13, url: "https://three-group.com" },
      ] };
      if (path === "/landscapes/L1") return { landscape: { id: "L1", name: plan.name } };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const errors: string[] = [];
    for (let run = 0; run < 3; run++) await advanceSetupOnServer(db, "set", api).catch((e: Error) => errors.push(e.message));
    expect(posts.length).toBe(1); // once, then the fresh verify waits another day
    expect(errors.at(-1)).toContain("adaptivesound.com, three.com");
  });
});

describe("P31-08 a follow RivalIQ never answers", () => {
  it("is checked by reading the landscape after a day, and sent again when the companies are not there", async () => {
    const db = fakeDb(tables());
    const plan = await setupPlan(db, "set");
    db.tables.rivaliq_setup_jobs.push({ set_id: "set", client_id: "c", plan, fingerprint: await planFingerprint(plan), phase: "following", landscape_id: "L1", operation_token: "forgotten", updated_at: twoDaysAgo(), lease_id: null, lease_until: null });
    const posts: string[] = [];
    const api = async (path: string, method = "GET") => {
      if (method === "POST" && path.endsWith("/companies/byUrl")) { posts.push(path); return { token: "fresh" }; }
      if (path === "/pendingOperations/forgotten") throw new Error("RivalIQ returned HTTP 404. Check API permissions or account capacity, then check setup status. No automatic POST retry was sent.");
      if (path === "/pendingOperations/fresh") return { status: 1 };
      if (path === "/landscapes/L1/companies") return { companies: [] };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const out = await advanceSetupOnServer(db, "set", api);
    expect(posts.length).toBe(1);
    expect(out).toMatchObject({ state: "pending", phase: "following" });
  });
});
