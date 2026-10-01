import { describe, it, expect } from "vitest";
import { handleRequest, type AuditRow, type CoreDeps } from "./core";
import { ApiError } from "./errors";
import { hashKey } from "./keys";
import type { Route } from "./router";

const GOOD = "adv_good_key";
const REVOKED = "adv_revoked_key";
const BUSY = "adv_busy_key";
const ok = async () => ({ status: 200, body: { fine: true } });
const routes: Route[] = [
  { method: "GET", path: "/v1/ping", auth: "none", doc: { summary: "ping", tag: "T", response: "X" }, handler: ok },
  { method: "GET", path: "/v1/secret", auth: "key", scope: "read", doc: { summary: "s", tag: "T", response: "X" }, handler: async (ctx) => ({ status: 200, body: { key: ctx.auth.keyId, all: ctx.auth.clients.all } }) },
  { method: "POST", path: "/v1/demo", auth: "key", scope: "demo", doc: { summary: "d", tag: "T", response: "X" }, handler: ok },
  { method: "GET", path: "/v1/admin/x", auth: "admin", doc: { summary: "a", tag: "T", response: "X" }, handler: async (ctx) => ({ status: 200, body: { kind: ctx.auth.kind } }) },
  { method: "POST", path: "/internal/w", auth: "internal", doc: { summary: "w", tag: "T", response: "X" }, handler: ok },
  { method: "GET", path: "/v1/conflict", auth: "none", doc: { summary: "c", tag: "T", response: "X" }, handler: async () => { throw new ApiError(409, "conflict", "taken"); } },
  { method: "GET", path: "/v1/boom", auth: "none", doc: { summary: "b", tag: "T", response: "X" }, handler: async () => { throw new Error("kaboom"); } },
  { method: "GET", path: "/v1/clients/:id", auth: "key", scope: "read", doc: { summary: "c", tag: "T", response: "X" }, handler: ok },
  { method: "POST", path: "/v1/echo", auth: "none", doc: { summary: "e", tag: "T", response: "X" }, handler: async (ctx) => ({ status: 200, body: ctx.body }) },
];

async function deps(over: Partial<CoreDeps> = {}): Promise<{ deps: CoreDeps; audits: AuditRow[] }> {
  const audits: AuditRow[] = [];
  const good = await hashKey(GOOD), revoked = await hashKey(REVOKED), busy = await hashKey(BUSY);
  const base: CoreDeps = {
    tool: "advisor", version: "1", routes,
    touchKey: async (h) => {
      const row = { id: "k1", name: "n", key_prefix: "adv_good_key", scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 };
      if (h === good) return row;
      if (h === revoked) return { ...row, id: "k2", revoked_at: "2026-09-01T00:00:00Z" };
      if (h === busy) return { ...row, id: "k3", minute_count: 121 };
      return null;
    },
    clientsForScope: async () => [{ id: "c1", company_slug: "a" }],
    verifyAdminJwt: async (t) => (t === "admin-jwt" ? { userId: "u1" } : null),
    cronSecret: "cron-s", serviceKey: "svc-k",
    audit: async (r) => { audits.push(r); },
    now: () => new Date("2026-09-30T12:00:30Z"),
    requestId: () => "req-1",
    ...over,
  };
  return { deps: base, audits };
}
const req = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request(`https://x.supabase.co/functions/v1/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe("handleRequest", () => {
  it("answers OPTIONS with CORS and no body", async () => {
    const d = await deps();
    const r = await handleRequest(req("OPTIONS", "/v1/ping"), d.deps);
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("serves an open route with the version and request id headers", async () => {
    const d = await deps();
    const r = await handleRequest(req("GET", "/v1/ping"), d.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ fine: true });
    expect(r.headers.get("X-Api-Version")).toBe("1");
    expect(r.headers.get("X-Request-Id")).toBe("req-1");
    expect(d.audits[0]).toMatchObject({ key_id: null, method: "GET", path: "/v1/ping", status: 200 });
  });
  it("404 and 405 as JSON", async () => {
    const d = await deps();
    expect((await handleRequest(req("GET", "/v1/none"), d.deps)).status).toBe(404);
    const r = await handleRequest(req("DELETE", "/v1/ping"), d.deps);
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("GET");
  });
  it("refuses a key route without a key, with an unknown key, or with a revoked key", async () => {
    const d = await deps();
    expect((await handleRequest(req("GET", "/v1/secret"), d.deps)).status).toBe(401);
    expect((await handleRequest(req("GET", "/v1/secret", { Authorization: "Bearer adv_nope" }), d.deps)).status).toBe(401);
    expect((await handleRequest(req("GET", "/v1/secret", { Authorization: `Bearer ${REVOKED}` }), d.deps)).status).toBe(401);
    expect(d.audits.map((a) => a.error_code)).toEqual(["unauthorized", "unauthorized", "unauthorized"]);
  });
  it("accepts a live key and records it on the audit row", async () => {
    const d = await deps();
    const r = await handleRequest(req("GET", "/v1/secret", { "X-Api-Key": GOOD }), d.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ key: "k1", all: true });
    expect(d.audits[0]).toMatchObject({ key_id: "k1", status: 200, error_code: null });
  });
  it("refuses a scope the key lacks", async () => {
    const d = await deps();
    const r = await handleRequest(req("POST", "/v1/demo", { Authorization: `Bearer ${GOOD}` }, {}), d.deps);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("forbidden");
  });
  it("rate limits with Retry-After to the next minute", async () => {
    const d = await deps();
    const r = await handleRequest(req("GET", "/v1/secret", { Authorization: `Bearer ${BUSY}` }), d.deps);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect((await r.json()).error.code).toBe("rate_limited");
  });
  it("admin routes take the cron secret, the service bearer, an admin JWT or an admin-scoped key", async () => {
    const d = await deps();
    expect(await (await handleRequest(req("GET", "/v1/admin/x", { "X-Cron-Secret": "cron-s" }), d.deps)).json()).toEqual({ kind: "internal" });
    expect(await (await handleRequest(req("GET", "/v1/admin/x", { Authorization: "Bearer svc-k" }), d.deps)).json()).toEqual({ kind: "internal" });
    expect(await (await handleRequest(req("GET", "/v1/admin/x", { Authorization: "Bearer admin-jwt" }), d.deps)).json()).toEqual({ kind: "admin" });
    expect((await handleRequest(req("GET", "/v1/admin/x", { Authorization: "Bearer user-jwt" }), d.deps)).status).toBe(401);
    expect((await handleRequest(req("GET", "/v1/admin/x", { Authorization: `Bearer ${GOOD}` }), d.deps)).status).toBe(403);
  });
  it("internal routes take only the cron secret or the service bearer", async () => {
    const d = await deps();
    expect((await handleRequest(req("POST", "/internal/w", { "X-Cron-Secret": "cron-s" }, {}), d.deps)).status).toBe(200);
    expect((await handleRequest(req("POST", "/internal/w", { Authorization: "Bearer admin-jwt" }, {}), d.deps)).status).toBe(401);
  });
  it("maps ApiError to its status and any other throw to 500 internal", async () => {
    const d = await deps();
    const c = await handleRequest(req("GET", "/v1/conflict"), d.deps);
    expect(c.status).toBe(409);
    expect((await c.json()).error.code).toBe("conflict");
    const b = await handleRequest(req("GET", "/v1/boom"), d.deps);
    expect(b.status).toBe(500);
    const body = await b.json();
    expect(body.error.code).toBe("internal");
    expect(body.error.message).toContain("req-1");
    expect(d.audits[1]).toMatchObject({ status: 500, error_code: "internal" });
  });
  it("rejects a malformed JSON body on a POST", async () => {
    const d = await deps();
    const r = await handleRequest(new Request("https://x.supabase.co/functions/v1/api/v1/echo", { method: "POST", body: "{nope" }), d.deps);
    expect(r.status).toBe(400);
  });
  it("stamps the client id on the audit row for client routes", async () => {
    const d = await deps();
    await handleRequest(req("GET", "/v1/clients/11111111-2222-4333-8444-555555555555", { Authorization: `Bearer ${GOOD}` }), d.deps);
    expect(d.audits[0].client_id).toBe("11111111-2222-4333-8444-555555555555");
    await handleRequest(req("GET", "/v1/clients/not-an-id", { Authorization: `Bearer ${GOOD}` }), d.deps);
    expect(d.audits[1].client_id).toBeNull();
  });
});
