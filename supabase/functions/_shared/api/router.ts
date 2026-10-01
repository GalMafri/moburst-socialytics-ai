/**
 * The route table is the one description of the API: the matcher routes
 * requests from it and the OpenAPI document is generated from it, so a
 * route cannot exist without documentation.
 */
export type Method = "GET" | "POST" | "DELETE";
export type AuthKind = "none" | "key" | "admin" | "internal";
export type Scope = "read" | "demo" | "admin";

export interface QueryDoc {
  type: string;
  description?: string;
  enum?: string[];
}

export interface RouteDoc {
  summary: string;
  tag: string;
  query?: Record<string, QueryDoc>;
  body?: string;
  response: string;
  status?: number;
  /** True when the route returns a list envelope, which adds limit and cursor parameters. */
  list?: boolean;
}

export interface ClientScope {
  all: boolean;
  ids: Set<string>;
  allows(id: string | null | undefined): boolean;
}

export interface AuthContext {
  kind: "key" | "admin" | "internal" | "none";
  keyId: string | null;
  keyHash: string | null;
  scopes: Scope[];
  clients: ClientScope;
  userId?: string | null;
}

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  auth: AuthContext;
  requestId: string;
  url: URL;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Route {
  method: Method;
  path: string;
  auth: AuthKind;
  scope?: Scope;
  doc: RouteDoc;
  handler(ctx: RouteContext): Promise<ApiResponse>;
}

export type Match =
  | { route: Route; params: Record<string, string> }
  | { error: "not_found" }
  | { error: "method_not_allowed"; allowed: Method[] };

function compile(path: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const src = path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        names.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { re: new RegExp(`^${src}$`), names };
}

export function matchRoute(routes: Route[], method: string, pathname: string): Match {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const allowed: Method[] = [];
  for (const route of routes) {
    const { re, names } = compile(route.path);
    const m = re.exec(path);
    if (!m) continue;
    if (route.method !== method) {
      allowed.push(route.method);
      continue;
    }
    const params: Record<string, string> = {};
    names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return { route, params };
  }
  return allowed.length ? { error: "method_not_allowed", allowed } : { error: "not_found" };
}

/** The path after the function's own segment: /functions/v1/api/v1/clients -> /v1/clients. */
export function apiPath(url: URL): string {
  const i = url.pathname.indexOf("/api");
  const rest = i >= 0 ? url.pathname.slice(i + 4) : url.pathname;
  return rest || "/";
}

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
      required: ["code", "message"],
    },
  },
  required: ["error"],
};

export function buildOpenApi(
  routes: Route[],
  info: { title: string; version: string; serverUrl: string; description: string },
  schemas: Record<string, unknown>,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    if (r.auth === "internal") continue;
    const oaPath = r.path.replace(/:([a-zA-Z_]+)/g, "{$1}");
    const params: unknown[] = [];
    for (const m of r.path.matchAll(/:([a-zA-Z_]+)/g)) params.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
    for (const [name, q] of Object.entries(r.doc.query ?? {})) {
      const schema: Record<string, unknown> = { type: q.type };
      if (q.enum) schema.enum = q.enum;
      params.push({ name, in: "query", required: false, schema, description: q.description });
    }
    if (r.doc.list) {
      params.push({ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } });
      params.push({ name: "cursor", in: "query", required: false, schema: { type: "string" }, description: "The next_cursor of the previous page." });
    }
    const status = String(r.doc.status ?? 200);
    const op: Record<string, unknown> = {
      summary: r.doc.summary,
      tags: [r.doc.tag],
      parameters: params,
      responses: {
        [status]: { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${r.doc.response}` } } } },
        "4XX": { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
    if (r.doc.body) op.requestBody = { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${r.doc.body}` } } } };
    if (r.auth !== "none") op.security = [{ ApiKey: [] }];
    if (r.scope) op["x-scope"] = r.scope;
    if (r.auth === "admin") op["x-auth"] = "admin";
    paths[oaPath] = { ...(paths[oaPath] ?? {}), [r.method.toLowerCase()]: op };
  }
  return {
    openapi: "3.1.0",
    info: { title: info.title, version: info.version, description: info.description },
    servers: [{ url: info.serverUrl }],
    paths,
    components: {
      securitySchemes: { ApiKey: { type: "http", scheme: "bearer" } },
      schemas: { Error: ERROR_SCHEMA, ...schemas },
    },
  };
}
