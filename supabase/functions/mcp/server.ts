/**
 * The connector over HTTP. Supabase's withOAuthProtectedResource() serves
 * the protected resource metadata at /functions/v1/mcp/oauth-protected-resource
 * and adds the WWW-Authenticate pointer to every 401; it reads no API key.
 * The function then verifies the bearer token itself (verify.ts: jose
 * against the project's JWKS, ES256 only, issuer and audience), runs the
 * connector's gate (access.ts), and hands the request to the MCP SDK's
 * createMcpHandler, which serves a fresh stateless server per request over
 * Streamable HTTP. Each tool call counts toward the person's minute and
 * writes one audit row. The lookups come in through ConnectorDeps, so the
 * whole path runs in tests with a fake store and a test key set.
 */
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.3.1";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource } from "npm:@supabase/server@1.9.2/oauth-protected-resource";
import { bearerToken } from "../_shared/auth/authz.ts";
import { admit, type AccessReads, type Person } from "./access.ts";
import { auditRow, rateCheck, type McpAuditRow } from "./audit.ts";
import { runTool, TOOLS, type ToolDeps, type ToolResult } from "./tools.ts";
import { issuerOf, type Claims } from "./verify.ts";

/** A request whose token verified: the token itself and its claims. */
export interface Caller {
  token: string;
  claims: Claims;
}

export interface ConnectorDeps {
  /** https://<ref>.supabase.co: the connector is <projectUrl>/functions/v1/mcp, the issuer <projectUrl>/auth/v1. */
  projectUrl: string;
  /** The token's claims when the project signed it (verify.ts), null when it cannot be trusted; throws when the key set cannot be read. */
  verify(token: string): Promise<Claims | null>;
  /** The gate's reads, through the person's own client. */
  reads(caller: Caller): AccessReads;
  /** What the tools read for a person: the store over their client, Sprout acting for them, trends as them. */
  tools(caller: Caller, person: Person): ToolDeps;
  /** This minute's count of the person's tool calls, this one included (mcp_rate_touch, service role). */
  touch(userId: string): Promise<number>;
  /** One api_requests row (service role). */
  audit(row: McpAuditRow): Promise<void>;
  waitUntil?(p: Promise<unknown>): void;
  now?(): Date;
}

export const SERVER_INFO = { name: "socialytics", version: "1.0.0" };
const INSTRUCTIONS = "Socialytics is Moburst's organic social tool. Find a client with socialytics_clients_list, then read its social and competitive reports, Sprout Social performance and weekly trend themes. Everything is read-only and limited to the clients the signed-in person can see in Socialytics.";
const SIGN_IN = "Connect Socialytics from Claude to use this connector.";

/** One server for one request, with the eight tools bound to the person. */
function serverFor(req: Request, caller: Caller, person: Person, deps: ConnectorDeps): McpServer {
  const now = deps.now ?? (() => new Date());
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }, async (args: Record<string, unknown>) => {
      const t0 = now().getTime();
      const requestId = crypto.randomUUID();
      let result: ToolResult;
      try {
        const verdict = rateCheck(await deps.touch(person.userId), now());
        result = verdict.ok ? await runTool(tool.name, args, person, deps.tools(caller, person), requestId) : { ok: false, status: 429, code: "rate_limited", text: verdict.text };
      } catch (e) {
        console.error(`mcp ${tool.name} rate check failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
        result = { ok: false, status: 500, code: "internal", text: "Socialytics could not answer this request." };
      }
      const row = auditRow({ tool: tool.name, status: result.status, durationMs: now().getTime() - t0, clientId: args.client_id, errorCode: result.ok ? null : result.code, userId: person.userId, oauthClientId: person.oauthClientId, ip });
      const written = deps.audit(row).catch((e) => console.error("mcp audit failed:", e instanceof Error ? e.message : String(e)));
      if (deps.waitUntil) deps.waitUntil(written);
      else await written;
      return result.ok ? { content: [{ type: "text" as const, text: result.text }] } : { content: [{ type: "text" as const, text: result.text }], isError: true };
    });
  }
  return server;
}

/** The function's whole request path. */
export function connectorFetch(deps: ConnectorDeps): (req: Request) => Promise<Response> {
  const project = deps.projectUrl.replace(/\/+$/, "");
  const discovery = withOAuthProtectedResource({ resourceServer: `${project}/functions/v1/mcp`, authorizationServer: issuerOf(project) });
  return pipeline([discovery], async (req) => {
    let caller: Caller;
    let admission;
    try {
      const token = bearerToken(req.headers.get("Authorization"));
      const claims = token ? await deps.verify(token) : null;
      if (!claims) return Response.json({ error: SIGN_IN }, { status: 401 });
      caller = { token, claims };
      admission = await admit(claims, deps.reads(caller));
    } catch (e) {
      console.error("mcp sign-in check failed:", e instanceof Error ? e.message : String(e));
      return Response.json({ error: "Socialytics could not check this sign-in." }, { status: 500 });
    }
    if (!admission.ok) return Response.json({ error: admission.message }, { status: admission.status });
    const person = admission.person;
    const handler = createMcpHandler(() => serverFor(req, caller, person, deps), { onerror: (e: Error) => console.error("mcp request failed:", e.message) });
    return handler.fetch(req);
  });
}
