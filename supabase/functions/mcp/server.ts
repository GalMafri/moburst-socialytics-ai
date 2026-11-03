/**
 * The connector over HTTP. Supabase's withOAuthProtectedResource() serves
 * the protected resource metadata at /functions/v1/mcp/oauth-protected-resource
 * and adds the WWW-Authenticate pointer to every 401; it reads no API key.
 * The function then verifies the bearer token itself (verify.ts: jose
 * against the project's JWKS, ES256 only, issuer and audience), runs the
 * connector's gate (access.ts), and hands the request to the MCP SDK's
 * createMcpHandler, which serves a fresh stateless server per request over
 * Streamable HTTP. Each tool call counts toward the person's minute and
 * writes one audit row. A person sees the API's eight reads and the
 * calendar; Moburst staff also see the strategy and notes reads and the
 * five saves (reads.ts, writes.ts). The lookups come in through
 * ConnectorDeps, so the whole path runs in tests with fakes and a test key
 * set.
 */
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.3.1";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource } from "npm:@supabase/server@1.9.2/oauth-protected-resource";
import { bearerToken } from "../_shared/auth/authz.ts";
import { admit, type AccessReads, type Person } from "./access.ts";
import { auditRow, rateCheck, type McpAuditRow } from "./audit.ts";
import { READ_TOOLS, runRead, type Annotations, type PersonReads } from "./reads.ts";
import { runTool, TOOLS, type ToolDeps, type ToolResult } from "./tools.ts";
import { runWrite, WRITE_TOOLS, type WriteDeps } from "./writes.ts";
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
  /** The calendar, strategy and notes reads, through the person's own client. */
  personReads(caller: Caller): PersonReads;
  /** What the saves need: the person's own checks through their client, and the service writer (writes.ts). */
  writes(caller: Caller): WriteDeps;
  /** This minute's count of the person's tool calls, this one included (mcp_rate_touch, service role). */
  touch(userId: string): Promise<number>;
  /** One api_requests row (service role). */
  audit(row: McpAuditRow): Promise<void>;
  waitUntil?(p: Promise<unknown>): void;
  now?(): Date;
}

export const SERVER_INFO = { name: "socialytics", version: "1.0.0" };
const INSTRUCTIONS = "Socialytics is Moburst's organic social tool. Find a client with socialytics_clients_list, then read its social and competitive reports, Sprout Social performance, weekly trend themes and content calendar, and, for Moburst staff, its content strategy and client notes. Moburst staff can also save to Socialytics: client notes (socialytics_note_save), approved calendar copy (socialytics_post_copy_save), strategy sections (socialytics_strategy_section_save) and finished decks on a report (socialytics_report_deck_upload, then socialytics_report_deck_save). Every save names the client by id and name, and reaches only the clients the signed-in person can change in Socialytics. Reads reach only the clients they can see.";
const SIGN_IN = "Connect Socialytics from Claude to use this connector.";

/** A tool as a person is offered it, bound to them. */
interface Offered {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolSpecSchema;
  annotations: Annotations;
  call(args: Record<string, unknown>, requestId: string): Promise<ToolResult>;
}
type ToolSpecSchema = (typeof TOOLS)[number]["inputSchema"];

const isStaff = (person: Person) => person.role === "admin" || person.role === "moburst_user";

/**
 * The tools one person is offered, in order: the API's eight reads and the
 * calendar for everyone; the strategy and notes reads and the five saves for
 * admins and Moburst staff only, so a client user's Claude never sees them.
 */
export function toolsFor(caller: Caller, person: Person, deps: ConnectorDeps): Offered[] {
  const now = deps.now ?? (() => new Date());
  const staff = isStaff(person);
  const spec = (t: { name: string; title: string; description: string; inputSchema: ToolSpecSchema; annotations: Annotations }) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });
  return [
    ...TOOLS.map((t) => ({ ...spec(t), call: (args: Record<string, unknown>, id: string) => runTool(t.name, args, person, deps.tools(caller, person), id) })),
    ...READ_TOOLS.filter((t) => staff || !t.staffOnly).map((t) => ({ ...spec(t), call: (args: Record<string, unknown>, id: string) => runRead(t.name, args, person, deps.personReads(caller), id, now()) })),
    ...(staff ? WRITE_TOOLS : []).map((t) => ({
      ...spec(t),
      call: (args: Record<string, unknown>, id: string) => runWrite(t.name, args, person, { now, waitUntil: deps.waitUntil, ...deps.writes(caller) }, id),
    })),
  ];
}

/** One server for one request, with the person's tools bound to them. */
function serverFor(req: Request, caller: Caller, person: Person, deps: ConnectorDeps): McpServer {
  const now = deps.now ?? (() => new Date());
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of toolsFor(caller, person, deps)) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }, async (args: Record<string, unknown>) => {
      const t0 = now().getTime();
      const requestId = crypto.randomUUID();
      let result: ToolResult;
      try {
        const verdict = rateCheck(await deps.touch(person.userId), now());
        result = verdict.ok ? await tool.call(args, requestId) : { ok: false, status: 429, code: "rate_limited", text: verdict.text };
      } catch (e) {
        console.error(`mcp ${tool.name} rate check failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
        result = { ok: false, status: 500, code: "internal", text: "Socialytics could not answer this request." };
      }
      const row = auditRow({ tool: tool.name, status: result.status, durationMs: now().getTime() - t0, clientId: args.client_id, errorCode: result.ok ? null : result.code, userId: person.userId, oauthClientId: person.oauthClientId, ip, target: result.ok ? result.target : null });
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
