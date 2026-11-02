// @vitest-environment node
// The connector end to end over HTTP, with the real MCP SDK and the real
// Supabase pipeline (withOAuthProtectedResource, then withSupabase verifying
// tokens against a JWKS): the handshake, the sign-in refusals, the gate, the
// tools as each person, the rate limit and the audit rows.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT, REPORT } from "../api/fixtures";
import { emptyData, makeFakeStore } from "../api/store.fake";
import { connectorFetch, type ConnectorDeps } from "./server";
import type { McpAuditRow } from "./audit";

const PROJECT = "https://rwouwxqggjjacbpbhqsn.supabase.co";
const ENDPOINT = `${PROJECT}/mcp`; // the gateway strips /functions/v1 before the function sees the request
const ADMIN = "00000000-0000-4000-8000-00000000000a";
const BADER_USER = "00000000-0000-4000-8000-00000000000b";
const NO_ROLE = "00000000-0000-4000-8000-00000000000c";
const OAUTH_CLIENT = "9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f";
const CALM = { ...CLIENT, id: "c-calm", name: "Calm", company_slug: "calm", created_at: "2026-09-01T00:00:00.000Z" };
const PEOPLE: Record<string, { roles: string[]; clients: string[] }> = { [ADMIN]: { roles: ["admin"], clients: ["c-bader", "c-calm"] }, [BADER_USER]: { roles: ["client"], clients: ["c-bader"] }, [NO_ROLE]: { roles: [], clients: [] } };

const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === "string" ? b : new Uint8Array(b)).toString("base64url");
let keys: CryptoKeyPair;
let jwk: JsonWebKey;
async function token(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: "test-key" }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify({ iss: `${PROJECT}/auth/v1`, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600, ...claims }))}`;
  if (header.alg === "HS256") {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("legacy-jwt-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return `${input}.${b64u(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(input)))}`;
  }
  return `${input}.${b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(input)))}`;
}
const oauth = (sub: string) => token({ sub, email: "sinead@moburst.com", client_id: OAUTH_CLIENT });

let audit: McpAuditRow[] = [];
let counts = new Map<string, number>();
let fetchConnector: (req: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.SUPABASE_FUNCTION_SLUG = "mcp";
  keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "test-key", alg: "ES256", use: "sig" } as JsonWebKey;
  const store = makeFakeStore(emptyData({ clients: [CLIENT, CALM], reports: [REPORT] }));
  const deps: ConnectorDeps = {
    reads: (ctx) => {
      const p = PEOPLE[String(ctx.jwtClaims?.sub)] ?? { roles: [], clients: [] };
      return { roles: async () => p.roles, clientIds: async () => p.clients };
    },
    tools: () => ({ store, analytics: async () => ({ ok: true, status: 200, data: {} }), trendThemes: async () => ({ collected: false, themes: [] }), apiUrl: `${PROJECT}/functions/v1/api` }),
    touch: async (_ctx, userId) => { counts.set(userId, (counts.get(userId) ?? 0) + 1); return counts.get(userId)!; },
    audit: async (_ctx, row) => { audit.push(row); },
    now: () => new Date("2026-11-09T10:15:42.000Z"),
  };
  fetchConnector = connectorFetch(deps, { env: { url: PROJECT, publishableKeys: { default: "sb_publishable_test" }, secretKeys: { default: "sb_secret_test" }, jwks: { keys: [jwk] } } });
});
afterAll(() => { delete process.env.SUPABASE_FUNCTION_SLUG; });
beforeEach(() => { audit = []; counts = new Map(); });

let nextId = 1;
async function rpc(method: string, params: Record<string, unknown>, auth?: string, version = "2025-06-18"): Promise<{ status: number; headers: Headers; message: any }> {
  const res = await fetchConnector(new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": version, "X-Forwarded-For": "203.0.113.9", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  }));
  const text = await res.text();
  const data = text.split("\n").find((l) => l.startsWith("data: "));
  return { status: res.status, headers: res.headers, message: data ? JSON.parse(data.slice(6)) : text ? JSON.parse(text) : null };
}
const initialize = (auth: string, version: string) => rpc("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "claude-ai", version: "1.0" } }, auth, version);
const callTool = async (auth: string, name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args }, auth)).message.result;

describe("the handshake", () => {
  it("answers initialize in the 2025 protocol versions Claude uses", async () => {
    const auth = await oauth(ADMIN);
    for (const version of ["2025-06-18", "2025-11-25"]) {
      const r = await initialize(auth, version);
      expect(r.status).toBe(200);
      expect(r.message.result.protocolVersion).toBe(version);
      expect(r.message.result.serverInfo).toMatchObject({ name: "socialytics" });
      expect(r.message.result.capabilities.tools).toBeDefined();
    }
  });

  it("lists exactly the eight tools, read-only, with input schemas", async () => {
    const tools = (await rpc("tools/list", {}, await oauth(ADMIN))).message.result.tools as Array<{ name: string; inputSchema: { type: string; properties: object }; annotations: { readOnlyHint: boolean } }>;
    expect(tools.map((t) => t.name)).toEqual([
      "socialytics_clients_list", "socialytics_client_get", "socialytics_reports_list", "socialytics_report_get",
      "socialytics_competitive_reports_list", "socialytics_competitive_report_get", "socialytics_client_analytics", "socialytics_trend_themes",
    ]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint, t.name).toBe(true);
      expect(t.inputSchema.type, t.name).toBe("object");
    }
    expect(Object.keys(tools.find((t) => t.name === "socialytics_report_get")!.inputSchema.properties)).toEqual(["report_id", "sections"]);
  });
});

describe("sign-in", () => {
  const METADATA = `Bearer resource_metadata="${PROJECT}/functions/v1/mcp/oauth-protected-resource"`;

  it("answers a request with no token with a 401 that points at the protected resource metadata", async () => {
    const r = await rpc("tools/list", {});
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toBe(METADATA);
  });

  it("serves the metadata: this endpoint, and Supabase Auth as its authorization server", async () => {
    const res = await fetchConnector(new Request(`${ENDPOINT}/oauth-protected-resource`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resource: `${PROJECT}/functions/v1/mcp`, authorization_servers: [`${PROJECT}/auth/v1`] });
  });

  it("refuses a bad token, a legacy HS256 token and an app session token, each with the pointer", async () => {
    const appSession = await token({ sub: ADMIN, email: "lital@moburst.com", session_id: "s1" });
    const hs256 = await token({ sub: ADMIN, client_id: OAUTH_CLIENT }, { alg: "HS256", typ: "JWT" });
    const otherKey = await (async () => { const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as CryptoKeyPair; const input = `${b64u(JSON.stringify({ alg: "ES256", kid: "test-key" }))}.${b64u(JSON.stringify({ sub: ADMIN, client_id: OAUTH_CLIENT, exp: Math.floor(Date.now() / 1000) + 60 }))}`; return `${input}.${b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.privateKey, new TextEncoder().encode(input)))}`; })();
    for (const [what, auth] of [["malformed", "abc.def.ghi"], ["signed by another key", otherKey], ["HS256", hs256], ["app session", appSession]] as const) {
      const r = await rpc("tools/list", {}, auth);
      expect(r.status, what).toBe(401);
      expect(r.headers.get("WWW-Authenticate"), what).toBe(METADATA);
    }
    expect(audit).toEqual([]);
  });

  it("refuses a person with no Socialytics role", async () => {
    const r = await rpc("tools/list", {}, await oauth(NO_ROLE));
    expect(r.status).toBe(403);
    expect(r.message).toEqual({ error: "This account has no access to Socialytics." });
  });
});

describe("tool calls", () => {
  it("answer as the person, one compact JSON text block, and record one row without the arguments", async () => {
    const all = await callTool(await oauth(ADMIN), "socialytics_clients_list", { q: "a" });
    expect(all.isError).toBeUndefined();
    expect(all.content).toHaveLength(1);
    expect(JSON.parse(all.content[0].text).data.map((c: { name: string }) => c.name).sort()).toEqual(["Bader Law", "Calm"]);
    const mine = await callTool(await oauth(BADER_USER), "socialytics_clients_list", {});
    expect(JSON.parse(mine.content[0].text).data.map((c: { name: string }) => c.name)).toEqual(["Bader Law"]);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ method: "MCP", path: "mcp/socialytics_clients_list", status: 200, user_id: ADMIN, oauth_client_id: OAUTH_CLIENT, ip: "203.0.113.9", error_code: null, key_id: null });
    expect(JSON.stringify(audit)).not.toContain("\"q\"");
  });

  it("answer outside the person's clients as not found, marked as an error", async () => {
    const r = await callTool(await oauth(BADER_USER), "socialytics_client_get", { client_id: "c-calm" });
    expect(r).toEqual({ content: [{ type: "text", text: "No client with that id among the clients you can see." }], isError: true });
    expect(audit[0]).toMatchObject({ status: 404, error_code: "not_found" });
  });

  it("refuse the 121st call in a minute and say when to call again; only tool calls count", async () => {
    const auth = await oauth(ADMIN);
    counts.set(ADMIN, 120);
    const r = await callTool(auth, "socialytics_clients_list", {});
    expect(r).toEqual({ content: [{ type: "text", text: "Too many requests this minute. Try again in 18 seconds." }], isError: true });
    expect(audit[0]).toMatchObject({ status: 429, error_code: "rate_limited" });
    await rpc("tools/list", {}, auth);
    expect(counts.get(ADMIN)).toBe(121);
  });
});
