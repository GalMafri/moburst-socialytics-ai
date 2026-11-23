import { describe, expect, it } from "vitest";
import { diffOpenApi, renderChangeEntry, renderReference, stableJson, unacknowledged } from "./docs";

const doc = (over: { paths?: Record<string, unknown>; schemas?: Record<string, unknown> } = {}) => ({
  info: { title: "T API", version: "1", description: "d" },
  paths: over.paths ?? {
    "/v1/costs": {
      get: {
        summary: "Costs", tags: ["Costs"], "x-scope": "costs",
        parameters: [{ name: "from", in: "query", schema: { type: "string" } }],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Sum" } } } } },
      },
    },
    "/v1/keys": {
      post: {
        summary: "Create", tags: ["Admin"],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/KeyIn" } } } },
        responses: { "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Sum" } } } } },
      },
    },
  },
  components: {
    schemas: over.schemas ?? {
      Sum: { type: "object", properties: { total: { type: "number" }, bucket: { type: "string", enum: ["client", "dev_qa"] } }, required: ["total"] },
      KeyIn: { type: "object", properties: { name: { type: "string" }, scopes: { type: "array", items: { type: "string", enum: ["read", "costs"] } } }, required: ["name"] },
    },
  },
});

describe("API docs", () => {
  it("writes the same JSON for the same document whatever the key order", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("finds no change between a document and itself", () => {
    expect(diffOpenApi(doc(), doc())).toEqual({ added: [], removed: [], breaking: [], notes: [] });
    expect(renderChangeEntry(diffOpenApi(doc(), doc()), "2026-11-23")).toBeNull();
  });

  it("calls adding a route or a response field safe", () => {
    const after = doc();
    (after.paths as Record<string, unknown>)["/v1/new"] = { get: { summary: "New", tags: ["X"], responses: {} } };
    ((after.components.schemas as Record<string, { properties: Record<string, unknown> }>).Sum.properties).extra = { type: "string" };
    const d = diffOpenApi(doc(), after);
    expect(d.breaking).toEqual([]);
    expect(d.added).toEqual(["GET /v1/new"]);
    expect(d.notes).toContain("GET /v1/costs: response field extra added");
  });

  it("calls removing a route, a query parameter or a response field breaking", () => {
    const after = doc();
    delete (after.paths as Record<string, unknown>)["/v1/keys"];
    ((after.paths as Record<string, { get: { parameters: unknown[] } }>)["/v1/costs"].get).parameters = [];
    delete ((after.components.schemas as Record<string, { properties: Record<string, unknown> }>).Sum.properties).bucket;
    expect(diffOpenApi(doc(), after).breaking).toEqual([
      "GET /v1/costs: query parameter from removed",
      "GET /v1/costs: response field bucket removed",
      "POST /v1/keys: operation removed",
    ]);
  });

  it("calls a newly required request field, or a request value no longer accepted, breaking", () => {
    const after = doc();
    const keyIn = (after.components.schemas as Record<string, { required: string[]; properties: { scopes: { items: { enum: string[] } } } }>).KeyIn;
    keyIn.required = ["name", "scopes"];
    keyIn.properties.scopes.items.enum = ["read"];
    expect(diffOpenApi(doc(), after).breaking).toEqual([
      "POST /v1/keys: request field scopes is now required",
      'POST /v1/keys: request field scopes no longer accepts "costs"',
    ]);
  });

  it("lets a breaking change through only once BREAKING.md lists it", () => {
    const after = doc();
    delete (after.paths as Record<string, unknown>)["/v1/keys"];
    const d = diffOpenApi(doc(), after);
    expect(unacknowledged(d, "")).toEqual(["POST /v1/keys: operation removed"]);
    expect(unacknowledged(d, "# Breaking\n\n- POST /v1/keys: operation removed (2026-12-01, replaced by POST /v1/admin/keys)\n")).toEqual([]);
  });

  it("renders each operation with its scope, parameters and schemas", () => {
    const md = renderReference(doc(), { tool: "t", regenerate: "npm run api:gen" });
    expect(md).toContain("#### `GET /v1/costs`");
    expect(md).toContain("Scope: `costs`");
    expect(md).toContain("| `from` | string |");
    expect(md).toContain("| `bucket` |  | `client`, `dev_qa` |");
    expect(md).toContain("Do not edit by hand");
  });
});
