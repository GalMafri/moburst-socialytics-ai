/**
 * The connector over HTTP, built the way Supabase documents an MCP server
 * behind Supabase Auth: withOAuthProtectedResource() (the protected resource
 * metadata at /functions/v1/mcp/oauth-protected-resource and the
 * WWW-Authenticate pointer on every 401), then withSupabase({ auth: 'user' })
 * (the token verified against the project's JWKS, a client bound to the
 * person), then the connector's own gate (access.ts), then the MCP SDK's
 * createMcpHandler serving a fresh stateless server per request over
 * Streamable HTTP. Each tool call counts toward the person's minute and
 * writes one audit row. The lookups come in through ConnectorDeps, so the
 * whole path runs in tests with a fake store and a test JWKS.
 */
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.3.1";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource, withSupabase, type SupabaseContext, type WithSupabaseConfig } from "npm:@supabase/server@1.9.2";
import { admit, type AccessReads, type Person } from "./access.ts";
import { auditRow, rateCheck, type McpAuditRow } from "./audit.ts";
import { runTool, TOOLS, type ToolDeps, type ToolResult } from "./tools.ts";

export interface ConnectorDeps {
  /** The gate's reads, through the person's own client. */
  reads(ctx: SupabaseContext): AccessReads;
  /** What the tools read for a person: the store over their client, Sprout acting for them, trends as them. */
  tools(ctx: SupabaseContext, person: Person): ToolDeps;
  /** This minute's count of the person's tool calls, this one included (mcp_rate_touch, service role). */
  touch(ctx: SupabaseContext, userId: string): Promise<number>;
  /** One api_requests row (service role). */
  audit(ctx: SupabaseContext, row: McpAuditRow): Promise<void>;
  waitUntil?(p: Promise<unknown>): void;
  now?(): Date;
}

export const SERVER_INFO = { name: "socialytics", version: "1.0.0" };
const INSTRUCTIONS = "Socialytics is Moburst's organic social tool. Find a client with socialytics_clients_list, then read its social and competitive reports, Sprout Social performance and weekly trend themes. Everything is read-only and limited to the clients the signed-in person can see in Socialytics.";

/** One server for one request, with the eight tools bound to the person. */
function serverFor(req: Request, ctx: SupabaseContext, person: Person, deps: ConnectorDeps): McpServer {
  const now = deps.now ?? (() => new Date());
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }, async (args: Record<string, unknown>) => {
      const t0 = now().getTime();
      const requestId = crypto.randomUUID();
      let result: ToolResult;
      try {
        const verdict = rateCheck(await deps.touch(ctx, person.userId), now());
        result = verdict.ok ? await runTool(tool.name, args, person, deps.tools(ctx, person), requestId) : { ok: false, status: 429, code: "rate_limited", text: verdict.text };
      } catch (e) {
        console.error(`mcp ${tool.name} rate check failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
        result = { ok: false, status: 500, code: "internal", text: "Socialytics could not answer this request." };
      }
      const row = auditRow({ tool: tool.name, status: result.status, durationMs: now().getTime() - t0, clientId: args.client_id, errorCode: result.ok ? null : result.code, userId: person.userId, oauthClientId: person.oauthClientId, ip });
      const written = deps.audit(ctx, row).catch((e) => console.error("mcp audit failed:", e instanceof Error ? e.message : String(e)));
      if (deps.waitUntil) deps.waitUntil(written);
      else await written;
      return result.ok ? { content: [{ type: "text" as const, text: result.text }] } : { content: [{ type: "text" as const, text: result.text }], isError: true };
    });
  }
  return server;
}

/** The function's whole request path. `env` overrides what withSupabase reads from the runtime (tests only). */
export function connectorFetch(deps: ConnectorDeps, opts: { env?: WithSupabaseConfig["env"] } = {}): (req: Request) => Promise<Response> {
  return pipeline([withOAuthProtectedResource(), withSupabase({ auth: "user", env: opts.env })], async (req, ctx) => {
    let admission;
    try {
      admission = await admit(ctx.jwtClaims as Record<string, unknown> | null, deps.reads(ctx));
    } catch (e) {
      console.error("mcp access check failed:", e instanceof Error ? e.message : String(e));
      return Response.json({ error: "Socialytics could not check this sign-in." }, { status: 500 });
    }
    if (!admission.ok) return Response.json({ error: admission.message }, { status: admission.status });
    const person = admission.person;
    const handler = createMcpHandler(() => serverFor(req, ctx, person, deps), { onerror: (e: Error) => console.error("mcp request failed:", e.message) });
    return handler.fetch(req);
  });
}
