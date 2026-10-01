import { describe, it, expect } from "vitest";
import { demoRoutes, parseDemoInput, type JobStore } from "./routes-demo";
import { handleRequest, type CoreDeps } from "../_shared/api/core";
import { hashKey } from "../_shared/api/keys";
import type { JobRecord } from "../_shared/api/jobs";
import { invalid } from "../_shared/api/errors";

describe("parseDemoInput", () => {
  it("normalises the website to its host and keeps the rest", () => {
    const i = parseDemoInput({ client_name: " Brooklinen ", website: "https://www.Brooklinen.com/", industry: "Shopping", competitors: [{ name: "Parachute", website: "parachutehome.com" }], idempotency_key: "k", callback_url: "https://moburst.ai/hook", regions: ["us"], force_run: true, requester: { email: "a@moburst.com" } });
    expect(i).toEqual({ client_name: "Brooklinen", website: "brooklinen.com", industry: "Shopping", competitors: [{ name: "Parachute", website: "parachutehome.com" }], idempotency_key: "k", callback_url: "https://moburst.ai/hook", regions: ["US"], force_run: true, requester: { email: "a@moburst.com" } });
  });
  it("names the offending field", () => {
    expect(() => parseDemoInput({ website: "x.com" })).toThrow(/client_name/);
    expect(() => parseDemoInput({ client_name: "X", website: "nope" })).toThrow(/website/);
    expect(() => parseDemoInput({ client_name: "X", website: "x.com", callback_url: "http://insecure" })).toThrow(/callback_url/);
    expect(() => parseDemoInput({ client_name: "X", website: "x.com", competitors: Array.from({ length: 13 }, () => ({ name: "a" })) })).toThrow(/competitors/);
    expect(() => parseDemoInput({ client_name: "X", website: "x.com", regions: ["usa"] })).toThrow(/regions/);
    expect(() => parseDemoInput(null)).toThrow(invalid("").constructor);
  });
});

function memoryJobs(seed: JobRecord[] = []) {
  const jobs = new Map(seed.map((j) => [j.id, j]));
  let n = 0;
  const store: JobStore = {
    async create(job) { const id = `job-${++n}`; const rec = { ...job, id, created_at: `2026-09-30T12:0${n}:00.000Z`, updated_at: `2026-09-30T12:0${n}:00.000Z` } as JobRecord; jobs.set(id, rec); return rec; },
    async byIdempotency(keyId, key) { return [...jobs.values()].find((j) => j.key_id === keyId && j.idempotency_key === key) ?? null; },
    async get(id, scope, _keyId) { const j = jobs.get(id) ?? null; return j && (scope.all || (j.client_id ? scope.allows(j.client_id) : false)) ? j : null; },
    async list(f, scope, page, _keyId) { return [...jobs.values()].filter((j) => (!f.client_id || j.client_id === f.client_id) && (!f.status || j.status === f.status) && (scope.all || (j.client_id ? scope.allows(j.client_id) : false))).slice(0, page.limit + 1); },
    async update(id, patch) { const j = jobs.get(id)!; Object.assign(j, patch); return j; },
    async runningCount() { return [...jobs.values()].filter((j) => j.status === "queued" || j.status === "running").length; },
  };
  return { store, jobs };
}

async function app(seed: JobRecord[] = []) {
  const { store, jobs } = memoryJobs(seed);
  const kicks: number[] = [];
  const discards: string[] = [];
  const routes = demoRoutes({ jobs: store, kickWorker: async () => { kicks.push(1); }, discard: async (job) => { discards.push(job.id); return { removed: { client: true, competitor_sets: 1, reports: 1, competitive_reports: 1, posts: 1, media_jobs: 1 } }; }, capacity: 3, stepNames: ["resolve_client", "collect"] });
  const key = "soc_demo_key";
  const h = await hashKey(key);
  const deps: CoreDeps = {
    tool: "socialytics", version: "1", routes,
    touchKey: async (x) => (x === h ? { id: "k-demo", name: "gOS", key_prefix: "soc_demo_key", scopes: ["read", "demo"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 } : null),
    clientsForScope: async () => [], verifyAdminJwt: async () => null, cronSecret: null, serviceKey: null, audit: async () => {}, requestId: () => "r",
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { method, headers: { Authorization: `Bearer ${key}` }, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
    return { status: res.status, body: await res.json() };
  };
  return { call, jobs, kicks, discards };
}

const input = { client_name: "Brooklinen", website: "brooklinen.com", idempotency_key: "idem-1" };

describe("demo routes", () => {
  it("creates a queued job with initial steps, kicks the worker and answers 202", async () => {
    const { call, jobs, kicks } = await app();
    const r = await call("POST", "/v1/demo-jobs", input);
    expect(r.status).toBe(202);
    expect(r.body.data).toMatchObject({ status: "queued", tool: "socialytics", input: { client_name: "Brooklinen", website: "brooklinen.com" }, steps: [{ name: "resolve_client", status: "pending" }, { name: "collect", status: "pending" }], links: { self: "/v1/demo-jobs/job-1", client: null } });
    expect(jobs.get("job-1")?.key_id).toBe("k-demo");
    expect(kicks).toHaveLength(1);
  });
  it("returns the same job on an idempotent replay, even after it finished", async () => {
    const { call, jobs } = await app();
    const first = await call("POST", "/v1/demo-jobs", input);
    jobs.get(first.body.data.id)!.status = "completed";
    const again = await call("POST", "/v1/demo-jobs", input);
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.data.status).toBe("completed");
  });
  it("refuses a fourth running job", async () => {
    const { call } = await app();
    for (let i = 0; i < 3; i++) expect((await call("POST", "/v1/demo-jobs", { ...input, idempotency_key: `k${i}` })).status).toBe(202);
    const r = await call("POST", "/v1/demo-jobs", { ...input, idempotency_key: "k9" });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("demo_capacity");
  });
  it("lists and reads jobs, cancels a running one and refuses to cancel or discard wrongly", async () => {
    const { call, jobs, discards } = await app();
    const r = await call("POST", "/v1/demo-jobs", input);
    const id = r.body.data.id;
    expect((await call("GET", "/v1/demo-jobs")).body.data.map((j: { id: string }) => j.id)).toEqual([id]);
    expect((await call("GET", `/v1/demo-jobs/${id}`)).body.data.id).toBe(id);
    expect((await call("GET", "/v1/demo-jobs/nope")).status).toBe(404);
    expect((await call("POST", `/v1/demo-jobs/${id}/discard`, {})).body.error.code).toBe("job_running");
    expect((await call("POST", `/v1/demo-jobs/${id}/cancel`, {})).body.data.status).toBe("cancelled");
    expect((await call("POST", `/v1/demo-jobs/${id}/cancel`, {})).status).toBe(409);
    jobs.get(id)!.status = "completed";
    const d = await call("POST", `/v1/demo-jobs/${id}/discard`, {});
    expect(d.body.data).toEqual({ job_id: id, removed: { client: true, competitor_sets: 1, reports: 1, competitive_reports: 1, posts: 1, media_jobs: 1 } });
    expect(discards).toEqual([id]);
  });
  it("rejects bad input with the field name", async () => {
    const { call } = await app();
    const r = await call("POST", "/v1/demo-jobs", { website: "x.com" });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/client_name/);
  });
});
