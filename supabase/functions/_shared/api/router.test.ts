import { describe, it, expect } from "vitest";
import { apiPath, buildOpenApi, matchRoute, type Route } from "./router";

const ok = async () => ({ status: 200, body: {} });
const routes: Route[] = [
  { method: "GET", path: "/v1/runs", auth: "key", scope: "read", doc: { summary: "List runs", tag: "Runs", query: { client_id: { type: "string" } }, response: "RunList", list: true }, handler: ok },
  { method: "GET", path: "/v1/runs/:id/ads", auth: "key", scope: "read", doc: { summary: "Ads of a run", tag: "Ads", response: "AdList" }, handler: ok },
  { method: "POST", path: "/v1/demo-jobs", auth: "key", scope: "demo", doc: { summary: "Start a demo", tag: "Demo", body: "DemoInput", response: "DemoJob", status: 202 }, handler: ok },
  { method: "POST", path: "/internal/worker", auth: "internal", doc: { summary: "Worker", tag: "Internal", response: "Empty" }, handler: ok },
];

describe("matchRoute", () => {
  it("captures path parameters", () => {
    const m = matchRoute(routes, "GET", "/v1/runs/abc/ads");
    expect("route" in m && m.params).toEqual({ id: "abc" });
  });
  it("answers not_found for an unknown path", () => {
    expect(matchRoute(routes, "GET", "/v1/nothing")).toEqual({ error: "not_found" });
  });
  it("answers method_not_allowed with the allowed methods", () => {
    expect(matchRoute(routes, "DELETE", "/v1/runs")).toEqual({ error: "method_not_allowed", allowed: ["GET"] });
  });
  it("ignores a trailing slash", () => {
    const m = matchRoute(routes, "GET", "/v1/runs/");
    expect("route" in m).toBe(true);
  });
});

describe("apiPath", () => {
  it("strips the function prefix", () => {
    expect(apiPath(new URL("https://x.supabase.co/functions/v1/api/v1/clients?x=1"))).toBe("/v1/clients");
    expect(apiPath(new URL("http://localhost:54321/functions/v1/api/internal/worker"))).toBe("/internal/worker");
    expect(apiPath(new URL("https://x.supabase.co/functions/v1/api"))).toBe("/");
  });
});

describe("buildOpenApi", () => {
  const doc = buildOpenApi(routes, { title: "AdVisor API", version: "1", serverUrl: "https://x.supabase.co/functions/v1/api", description: "d" }, { RunList: { type: "object" }, AdList: { type: "object" }, DemoInput: { type: "object" }, DemoJob: { type: "object" } });
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
  it("emits one path item per public route with OpenAPI parameter syntax", () => {
    expect(Object.keys(paths).sort()).toEqual(["/v1/demo-jobs", "/v1/runs", "/v1/runs/{id}/ads"]);
    expect(paths["/v1/runs/{id}/ads"].get.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
    expect(paths["/v1/runs"].get.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "client_id", in: "query" }), expect.objectContaining({ name: "limit" }), expect.objectContaining({ name: "cursor" })]));
  });
  it("records the scope, the body and the response status", () => {
    expect(paths["/v1/demo-jobs"].post["x-scope"]).toBe("demo");
    expect(paths["/v1/demo-jobs"].post.requestBody).toEqual({ required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DemoInput" } } } });
    expect(Object.keys(paths["/v1/demo-jobs"].post.responses as object)).toContain("202");
  });
  it("declares the bearer key scheme and the shared error schema", () => {
    const c = doc.components as { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    expect(c.securitySchemes.ApiKey).toEqual({ type: "http", scheme: "bearer" });
    expect(c.schemas.Error).toBeDefined();
    expect(c.schemas.RunList).toEqual({ type: "object" });
    expect(doc.openapi).toBe("3.1.0");
  });
});
