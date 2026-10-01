import { describe, it, expect } from "vitest";
import { socialyticsOpenApi, socialyticsRoutes } from "./openapi";
import { SCHEMAS } from "./schemas";
import { emptyData, makeFakeStore } from "./store.fake";

const routes = socialyticsRoutes({
  store: makeFakeStore(emptyData()), analytics: async () => ({ ok: true, status: 200, data: {} }), health: async () => ({}),
  jobs: { create: async (j) => ({ ...j, id: "x" }), byIdempotency: async () => null, get: async () => null, list: async () => [], update: async (_i, p) => p as never, runningCount: async () => 0 },
  kickWorker: async () => {}, discard: async () => ({ removed: { client: false, competitor_sets: 0, reports: 0, competitive_reports: 0, posts: 0, media_jobs: 0 } }), capacity: 3, stepNames: [],
  keys: { insert: async (k) => ({ ...k, id: "k", created_at: "", last_used_at: null, revoked_at: null }), list: async () => [], revoke: async () => false },
  serverUrl: "https://x.supabase.co/functions/v1/api",
});
const doc = socialyticsOpenApi(routes, "https://x.supabase.co/functions/v1/api") as { openapi: string; paths: Record<string, Record<string, { responses: Record<string, unknown>; requestBody?: unknown }>>; components: { schemas: Record<string, unknown> } };

function refs(node: unknown, out: string[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => refs(n, out));
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "$ref" && typeof v === "string") out.push(v);
    else refs(v, out);
  }
}

describe("the OpenAPI document", () => {
  it("is 3.1 with every public route and no internal one", () => {
    expect(doc.openapi).toBe("3.1.0");
    for (const r of routes) {
      const p = r.path.replace(/:([a-zA-Z_]+)/g, "{$1}");
      if (r.auth === "internal") expect(doc.paths[p]).toBeUndefined();
      else expect(doc.paths[p]?.[r.method.toLowerCase()], `${r.method} ${r.path}`).toBeDefined();
    }
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(25);
  });
  it("resolves every reference and names a schema for every response and body", () => {
    const all: string[] = [];
    refs(doc, all);
    for (const ref of all) expect(doc.components.schemas[ref.replace("#/components/schemas/", "")], ref).toBeDefined();
    for (const r of routes) {
      if (r.auth === "internal") continue;
      expect(SCHEMAS[r.doc.response], `${r.path} response ${r.doc.response}`).toBeDefined();
      if (r.doc.body) expect(SCHEMAS[r.doc.body], `${r.path} body ${r.doc.body}`).toBeDefined();
    }
  });
  it("marks scopes, keeps the health and openapi routes open, and never documents an internal identifier", () => {
    expect(doc.paths["/v1/health"].get).not.toHaveProperty("security");
    expect(doc.paths["/v1/openapi.json"].get).not.toHaveProperty("security");
    expect((doc.paths["/v1/demo-jobs"].post as Record<string, unknown>)["x-scope"]).toBe("demo");
    expect((doc.paths["/v1/clients"].get as Record<string, unknown>)["x-scope"]).toBe("read");
    expect(JSON.stringify(doc)).not.toMatch(/sprout_profile_id|sprout_customer_id|landscape_id|rivaliq_company_id|request_id|model_path|key_hash|integration_tokens|app_settings/);
  });
});
