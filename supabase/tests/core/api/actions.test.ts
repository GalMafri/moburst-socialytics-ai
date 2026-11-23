import { describe, it, expect } from "vitest";
import { actionRoutes, ownerOf, requestHash, type ActionClaim, type ActionDef, type ActionRunRecord, type ActionRunStore } from "../../../functions/_shared/api/actions.ts";
import { handleRequest, type CoreDeps } from "../../../functions/_shared/api/core.ts";
import { ApiError } from "../../../functions/_shared/api/errors.ts";
import { hashKey, scopeAll } from "../../../functions/_shared/api/keys.ts";

function memoryRuns() {
  const rows = new Map<string, ActionRunRecord>();
  const k = (c: ActionClaim) => `${c.owner}|${c.action}|${c.idempotency_key}`;
  const store: ActionRunStore = {
    async claim(c) {
      const existing = rows.get(k(c));
      if (existing) return { claimed: false, existing };
      rows.set(k(c), { status: "running", request_hash: c.request_hash, response_status: null, response: null });
      return { claimed: true };
    },
    async finish(c, res) { rows.set(k(c), { status: "done", request_hash: c.request_hash, response_status: res.status, response: res.body }); },
    async release(c) { rows.delete(k(c)); },
  };
  return { store, rows };
}

const RUN_KEY = "adv_run_key", READ_KEY = "adv_read_key", SCOPED_KEY = "adv_scoped_key";

async function app(opts: { fail?: boolean; hold?: Promise<void> } = {}) {
  const runs = memoryRuns();
  let started = 0;
  const def: ActionDef = {
    name: "start_thing", summary: "Start a thing", tag: "Actions", method: "POST", path: "/v1/clients/:id/things", body: "ThingInput", response: "ThingStarted", status: 202,
    maps: ["start-thing"],
    clientOf: (_b, p) => (p.id === "missing" ? null : p.id),
    run: async (ctx, body) => {
      started++;
      if (opts.hold) await opts.hold;
      if (opts.fail) throw new ApiError(502, "upstream_failed", "The thing could not be started");
      return { data: { started, client_id: ctx.clientId, size: body.size ?? null } };
    },
  };
  const routes = actionRoutes([def], { runs: runs.store });
  const [run, read, scoped] = await Promise.all([hashKey(RUN_KEY), hashKey(READ_KEY), hashKey(SCOPED_KEY)]);
  const row = (id: string, scopes: string[], client_ids: string[] | null = null) => ({ id, name: id, key_prefix: id, scopes, company_slugs: null, client_ids, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 });
  const deps: CoreDeps = {
    tool: "t", version: "1", routes,
    touchKey: async (h) => (h === run ? row("k-run", ["run"]) : h === read ? row("k-read", ["read"]) : h === scoped ? row("k-sc", ["run"], ["c-1"]) : null),
    clientsForScope: async () => [], verifyAdminJwt: async () => null, cronSecret: null, serviceKey: null, audit: async () => {}, requestId: () => "req",
  };
  const post = async (path: string, body: unknown, key = RUN_KEY) => {
    const res = await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), deps);
    return { status: res.status, body: await res.json(), replayed: res.headers.get("Idempotent-Replayed") };
  };
  return { post, routes, runs, started: () => started };
}

describe("action routes", () => {
  it("need the run scope and document the action", async () => {
    const { post, routes } = await app();
    expect(routes[0]).toMatchObject({ auth: "key", scope: "run", doc: { body: "ThingInput", response: "ThingStarted", status: 202 } });
    expect((await post("/v1/clients/c-1/things", {}, READ_KEY)).status).toBe(403);
    const ok = await post("/v1/clients/c-1/things", { size: 2 });
    expect(ok).toMatchObject({ status: 202, body: { data: { started: 1, client_id: "c-1", size: 2 } } });
  });

  it("answer not found for a client out of the key's reach or one that does not exist", async () => {
    const { post, started } = await app();
    expect((await post("/v1/clients/c-2/things", {}, SCOPED_KEY)).status).toBe(404);
    expect((await post("/v1/clients/missing/things", {})).status).toBe(404);
    expect((await post("/v1/clients/c-1/things", {}, SCOPED_KEY)).status).toBe(202);
    expect(started()).toBe(1);
  });

  it("return the first answer for a repeated idempotency_key instead of starting the work twice", async () => {
    const { post, started } = await app();
    const first = await post("/v1/clients/c-1/things", { size: 1, idempotency_key: "abc" });
    const again = await post("/v1/clients/c-1/things", { size: 1, idempotency_key: "abc" });
    expect(started()).toBe(1);
    expect(again).toMatchObject({ status: 202, body: first.body, replayed: "true" });
    // Another key starts its own.
    await post("/v1/clients/c-1/things", { size: 1, idempotency_key: "def" });
    expect(started()).toBe(2);
  });

  it("refuse the same idempotency_key for a different request, and one still running", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { post } = await app({ hold });
    const first = post("/v1/clients/c-1/things", { size: 1, idempotency_key: "k" });
    const during = await post("/v1/clients/c-1/things", { size: 1, idempotency_key: "k" });
    expect(during).toMatchObject({ status: 409, body: { error: { code: "conflict" } } });
    release();
    expect((await first).status).toBe(202);
    const other = await post("/v1/clients/c-1/things", { size: 9, idempotency_key: "k" });
    expect(other).toMatchObject({ status: 409, body: { error: { message: expect.stringMatching(/different request/) } } });
  });

  it("free the key when the work fails, so a retry can start it", async () => {
    const { post, runs, started } = await app({ fail: true });
    expect((await post("/v1/clients/c-1/things", { idempotency_key: "x" })).status).toBe(502);
    expect(runs.rows.size).toBe(0);
    expect((await post("/v1/clients/c-1/things", { idempotency_key: "x" })).status).toBe(502);
    expect(started()).toBe(2);
  });

  it("check the idempotency key and the body shape", async () => {
    const { post } = await app();
    expect((await post("/v1/clients/c-1/things", { idempotency_key: "x".repeat(201) })).status).toBe(400);
    expect((await post("/v1/clients/c-1/things", { idempotency_key: 5 })).status).toBe(400);
    expect((await post("/v1/clients/c-1/things", [1, 2])).status).toBe(400);
  });
});

describe("idempotency helpers", () => {
  it("key the owner by API key, then person, then caller kind", () => {
    expect(ownerOf({ kind: "key", keyId: "k1", keyHash: null, scopes: [], clients: scopeAll() })).toBe("key:k1");
    expect(ownerOf({ kind: "key", keyId: null, keyHash: null, scopes: [], clients: scopeAll(), userId: "u1" })).toBe("user:u1");
    expect(ownerOf({ kind: "internal", keyId: null, keyHash: null, scopes: [], clients: scopeAll() })).toBe("internal");
  });
  it("hash the request without the idempotency key and regardless of field order", async () => {
    const a = await requestHash("a", { id: "1" }, { x: 1, y: 2, idempotency_key: "k1" });
    expect(a).toBe(await requestHash("a", { id: "1" }, { y: 2, x: 1, idempotency_key: "k2" }));
    expect(a).not.toBe(await requestHash("a", { id: "1" }, { x: 1, y: 3 }));
  });
});
