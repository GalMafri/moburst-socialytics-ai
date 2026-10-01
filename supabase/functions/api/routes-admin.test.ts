import { describe, it, expect } from "vitest";
import { adminRoutes, type KeyStore, type StoredKey } from "./routes-admin";
import { handleRequest, type CoreDeps } from "../_shared/api/core";

function memoryKeys() {
  const rows: StoredKey[] = [];
  const store: KeyStore = {
    async insert(k) { const row = { ...k, id: `key-${rows.length + 1}`, created_at: "2026-09-30T12:00:00.000Z", last_used_at: null, revoked_at: null } as StoredKey; rows.push(row); return row; },
    async list() { return rows; },
    async revoke(id) { const r = rows.find((x) => x.id === id); if (!r) return false; r.revoked_at = "2026-09-30T13:00:00.000Z"; return true; },
  };
  return { rows, store };
}

async function app() {
  const { rows, store } = memoryKeys();
  const routes = adminRoutes({ keys: store, tool: "soc" });
  const deps: CoreDeps = { tool: "advisor", version: "1", routes, touchKey: async () => null, clientsForScope: async () => [], verifyAdminJwt: async (t) => (t === "admin-jwt" ? { userId: "u-admin" } : null), cronSecret: "cron-s", serviceKey: null, audit: async () => {}, requestId: () => "r" };
  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const res = await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { call, rows };
}

describe("admin key routes", () => {
  it("creates a key, returns the plaintext once, and stores only its hash", async () => {
    const { call, rows } = await app();
    const r = await call("POST", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" }, { name: "gOS", scopes: ["read", "demo"], company_slugs: ["bader-law"], rate_limit_per_minute: 60 });
    expect(r.status).toBe(201);
    expect(r.body.data.key).toMatch(/^soc_[A-Za-z0-9_-]{43}$/);
    expect(r.body.data).toMatchObject({ id: "key-1", name: "gOS", scopes: ["read", "demo"], company_slugs: ["bader-law"], rate_limit_per_minute: 60, key_prefix: r.body.data.key.slice(0, 12) });
    expect(r.body.data.warning).toMatch(/not shown again/);
    expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r.body)).not.toContain(rows[0].key_hash);
  });
  it("records the admin who created it from the session", async () => {
    const { call, rows } = await app();
    await call("POST", "/v1/admin/keys", { Authorization: "Bearer admin-jwt" }, { name: "x", scopes: ["read"] });
    expect(rows[0].created_by).toBe("u-admin");
  });
  it("validates the body", async () => {
    const { call } = await app();
    expect((await call("POST", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" }, { scopes: ["read"] })).body.error.message).toMatch(/name/);
    expect((await call("POST", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" }, { name: "x", scopes: ["root"] })).body.error.message).toMatch(/scopes/);
    expect((await call("POST", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" }, { name: "x", scopes: ["read"], expires_at: "soon" })).body.error.message).toMatch(/expires_at/);
  });
  it("lists keys without secrets and revokes one", async () => {
    const { call } = await app();
    await call("POST", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" }, { name: "a", scopes: ["read"] });
    const l = await call("GET", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" });
    expect(l.body.data).toHaveLength(1);
    expect(JSON.stringify(l.body)).not.toMatch(/key_hash|"key"/);
    expect((await call("DELETE", "/v1/admin/keys/key-1", { "X-Cron-Secret": "cron-s" })).status).toBe(204);
    expect((await call("GET", "/v1/admin/keys", { "X-Cron-Secret": "cron-s" })).body.data[0].revoked_at).not.toBeNull();
    expect((await call("DELETE", "/v1/admin/keys/nope", { "X-Cron-Secret": "cron-s" })).status).toBe(404);
  });
  it("refuses everyone else", async () => {
    const { call } = await app();
    expect((await call("GET", "/v1/admin/keys", {})).status).toBe(401);
    expect((await call("GET", "/v1/admin/keys", { Authorization: "Bearer user-jwt" })).status).toBe(401);
  });
});
