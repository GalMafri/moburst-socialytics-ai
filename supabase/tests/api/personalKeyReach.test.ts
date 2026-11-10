import { describe, it, expect } from "vitest";
import { CLIENT } from "../../functions/_shared/socialytics-api/fixtures";
import { readRoutes } from "../../functions/_shared/socialytics-api/routes-read";
import { makeFakeStore, emptyData } from "../../functions/_shared/socialytics-api/store.fake";
import { handleRequest, type CoreDeps } from "../../functions/_shared/api/core";
import { hashKey } from "../../functions/_shared/api/keys";

// What a personal key's row looks like from api_key_touch: the owner's reach as client_ids, worked out per call.
const SENTINEL = "00000000-0000-0000-0000-000000000000";
const NOW = Date.now();
const DAY = 86_400_000;
const CALM = { ...CLIENT, id: "c-calm", name: "Calm", company_slug: "calm", website_url: "https://calm.com", created_at: "2026-09-01T00:00:00.000Z", sprout_customer_id: null };
const DEMO = { ...CLIENT, id: "c-demo", name: "Demo Co", company_slug: "demo-co", website_url: "https://demo.example", created_at: "2026-09-02T00:00:00.000Z", sprout_customer_id: null, demo_job_id: "job-1" };

type Row = { client_ids: string[] | null; company_slugs: string[] | null; revoked_at?: string | null; expires_at?: string | null };
const KEYS: Record<string, Row> = {
  soc_moburst_user: { client_ids: ["c-bader", "c-calm"], company_slugs: null },
  soc_no_reach: { client_ids: [SENTINEL], company_slugs: null },
  soc_revoked: { client_ids: ["c-bader", "c-calm"], company_slugs: null, revoked_at: new Date(NOW - DAY).toISOString() },
  soc_expired: { client_ids: ["c-bader", "c-calm"], company_slugs: null, expires_at: new Date(NOW - 1000).toISOString() },
  soc_admin_owner: { client_ids: null, company_slugs: null },
};

async function app() {
  const store = makeFakeStore(emptyData({ clients: [CLIENT, CALM, DEMO] }));
  const byHash = new Map<string, string>();
  for (const k of Object.keys(KEYS)) byHash.set(await hashKey(k), k);
  const deps: CoreDeps = {
    tool: "socialytics", version: "1",
    routes: readRoutes({ store, analytics: async () => ({ ok: true, status: 200, data: {} }), health: async () => ({ tool: "socialytics", findings: [], demo_jobs: { running: 0, stuck: 0, failed_24h: 0 }, counts: {} }) }),
    touchKey: async (h) => {
      const k = byHash.get(h);
      if (!k) return null;
      const r = KEYS[k];
      return { id: `k-${k}`, name: k, key_prefix: k.slice(0, 12), scopes: ["read"], company_slugs: r.company_slugs, client_ids: r.client_ids, rate_limit_per_minute: 120, expires_at: r.expires_at ?? null, revoked_at: r.revoked_at ?? null, minute_count: 1 };
    },
    clientsForScope: async () => [CLIENT, CALM, DEMO].map((c) => ({ id: c.id, company_slug: c.company_slug })),
    verifyAdminJwt: async () => null, cronSecret: null, serviceKey: null, audit: async () => {}, requestId: () => "r",
  };
  return async (path: string, key: string) => {
    const res = await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { headers: { Authorization: `Bearer ${key}` } }), deps);
    return { status: res.status, body: await res.json() };
  };
}
const ids = (r: { body: { data: Array<{ id: string }> } }) => r.body.data.map((x) => x.id).sort();

describe("personal key reach through the read routes", () => {
  it("a Moburst user's key never reaches a demo client", async () => {
    const get = await app();
    expect(ids(await get("/v1/clients", "soc_moburst_user"))).toEqual(["c-bader", "c-calm"]);
    expect((await get("/v1/clients/c-bader", "soc_moburst_user")).status).toBe(200);
    expect((await get("/v1/clients/c-demo", "soc_moburst_user")).status).toBe(404);
  });
  it("the zero-uuid sentinel sees no client", async () => {
    const get = await app();
    const r = await get("/v1/clients", "soc_no_reach");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect((await get("/v1/clients/c-bader", "soc_no_reach")).status).toBe(404);
  });
  it("a revoked or expired personal key answers 401", async () => {
    const get = await app();
    expect((await get("/v1/clients", "soc_revoked")).status).toBe(401);
    expect((await get("/v1/clients", "soc_expired")).status).toBe(401);
  });
  it("an admin owner's key (no client_ids, no company_slugs) sees every client", async () => {
    const get = await app();
    expect(ids(await get("/v1/clients", "soc_admin_owner"))).toEqual(["c-bader", "c-calm", "c-demo"]);
    expect((await get("/v1/clients/c-demo", "soc_admin_owner")).status).toBe(200);
  });
});
