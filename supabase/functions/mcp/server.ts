/**
 * The connector over HTTP. Supabase's withOAuthProtectedResource() serves
 * the protected resource metadata at /functions/v1/mcp/oauth-protected-resource
 * and adds the WWW-Authenticate pointer to every 401; it reads no API key.
 * The function then identifies the bearer token itself:
 *   - a Socialytics API key (soc_...), for machine clients such as AgentBurst
 *     and Mobi, goes through the API's own key lookup (_shared/api/core.ts
 *     authenticateKey): liveness, scopes, client reach and the key's
 *     per-minute limit;
 *   - anything else is a person's OAuth token: verify.ts checks it with jose
 *     against the project's JWKS (ES256 only, issuer and audience), and the
 *     connector's gate (access.ts) admits the person.
 * It then hands the request to the MCP SDK's createMcpHandler, which serves a
 * fresh stateless server per request over Streamable HTTP, with the tools the
 * caller is offered (catalog.ts, the one list). Each tool call writes one
 * audit row; a person's calls also count toward their minute. The lookups
 * come in through ConnectorDeps, so the whole path runs in tests with fakes
 * and a test key set.
 */
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.3.1";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource } from "npm:@supabase/server@1.9.2/oauth-protected-resource";
import { authenticateKey, type CoreDeps } from "../_shared/api/core.ts";
import { ApiError } from "../_shared/api/errors.ts";
import { scopeAll } from "../_shared/api/keys.ts";
import type { AuthContext, Scope } from "../_shared/api/router.ts";
import { bearerToken } from "../_shared/auth/authz.ts";
import { admit, type AccessReads, type Person } from "./access.ts";
import { auditRow, rateCheck, type McpAuditRow } from "./audit.ts";
import { toolsForKey, toolsForPerson, type CatalogTool } from "./catalog.ts";
import { runRead, type Annotations, type PersonReads } from "./reads.ts";
import { runApiTool, runWork, type TaskDeps, type WorkDeps, type Who } from "./tasks.ts";
import { runTool, type ToolDeps, type ToolResult } from "./tools.ts";
import { runWrite, type WriteDeps } from "./writes.ts";
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
  /** The API's key lookups (api_key_touch and the client list); without them an API key is not accepted. */
  keys?: Pick<CoreDeps, "touchKey" | "clientsForScope">;
  /** What the reads use for an API key: a store with no reach of its own (the routes apply the key's), Sprout and trends acting for the key's owner. */
  keyTools?(auth: AuthContext): ToolDeps;
  /** The work tools' and the cost summary's wiring (service role); without it they answer that work is not available. */
  work?: WorkDeps;
  waitUntil?(p: Promise<unknown>): void;
  now?(): Date;
}

/**
 * Who the connector is, as Claude shows it: the Moburst mark (the same icon the
 * Socialytics site uses) rather than the icon of the supabase.co address it runs on.
 */
export const SERVER_INFO = {
  name: "socialytics",
  title: "Socialytics by Moburst",
  version: "1.1.0",
  websiteUrl: "https://socialytics.moburst.ai",
  icons: [
    { src: "https://socialytics.moburst.ai/images/icon-192.png", mimeType: "image/png", sizes: ["192x192"] },
    { src: "https://socialytics.moburst.ai/favicon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
  ],
};
const INSTRUCTIONS = "Socialytics is Moburst's organic social tool. Find a client with socialytics_clients_list, then read its social and competitive reports, Sprout Social performance, weekly trend themes and content calendar, and, for Moburst staff, its content strategy and client notes. socialytics_api_schema lists every read endpoint of the Socialytics API and socialytics_api calls any of them. Moburst staff can also save to Socialytics: client notes (socialytics_note_save), approved calendar copy (socialytics_post_copy_save), strategy sections (socialytics_strategy_section_save) and finished decks on a report (socialytics_report_deck_upload, then socialytics_report_deck_save). They can start work too (reports, a drafted post, a post's designs, competitor proposals, a competitor feed refresh, a calendar week): each work tool first answers what it will do with an estimate and a confirm_token and starts nothing; call it again with the token only after the person agrees. Every save names the client by id and name, and reaches only the clients the signed-in person can change in Socialytics. Reads reach only the clients they can see.";
const SIGN_IN = "Connect Socialytics from Claude to use this connector.";

/** A tool as one caller is offered it, bound to them. */
interface Offered {
  name: string;
  title: string;
  description: string;
  inputSchema: CatalogTool["inputSchema"];
  annotations: Annotations;
  call(args: Record<string, unknown>, requestId: string): Promise<ToolResult>;
}

const NO_TOOL: ToolResult = { ok: false, status: 404, code: "not_found", text: "There is no such Socialytics tool." };

/** The API's view of a signed-in person: their role's scopes and the clients they see (an admin, every client). */
export function personAuth(person: Person): AuthContext {
  const scopes: Scope[] = person.role === "admin" ? ["read", "run", "costs"] : person.role === "moburst_user" ? ["read", "run"] : ["read"];
  return { kind: "key", keyId: null, keyHash: null, scopes, clients: person.role === "admin" ? scopeAll() : person.scope, userId: person.userId };
}

const spec = (t: CatalogTool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });

/**
 * The tools one person is offered, in order (catalog.ts): the API's eight
 * reads, the calendar and the two API tools for everyone; the strategy and
 * notes reads, the five saves and the work tools for admins and Moburst staff
 * only, so a client user's Claude never sees them; the cost summary for
 * admins.
 */
export function toolsFor(caller: Caller, person: Person, deps: ConnectorDeps): Offered[] {
  const now = deps.now ?? (() => new Date());
  const who = (): Who => ({ auth: personAuth(person), id: `user:${person.userId}`, person: { role: person.role, checks: deps.writes(caller).person } });
  const task = (): TaskDeps => ({ reads: deps.tools(caller, person), work: deps.work ?? null, now });
  return toolsForPerson(person.role).map((t) => ({
    ...spec(t),
    call: (args: Record<string, unknown>, id: string) => {
      switch (t.kind) {
        case "read": return runTool(t.name, args, person, deps.tools(caller, person), id);
        case "person_read": return runRead(t.name, args, person, deps.personReads(caller), id, now());
        case "save": return runWrite(t.name, args, person, { now, waitUntil: deps.waitUntil, ...deps.writes(caller) }, id);
        case "work": return runWork(t.name, args, who(), task(), id);
        case "api": case "cost": return runApiTool(t.name, args, who(), task(), id);
        default: return Promise.resolve(NO_TOOL);
      }
    },
  }));
}

/** The tools one API key is offered: those its scopes allow, with its reach. */
export function toolsForApiKey(auth: AuthContext, deps: ConnectorDeps): Offered[] {
  const now = deps.now ?? (() => new Date());
  const reads = deps.keyTools ? () => deps.keyTools!(auth) : null;
  const who: Who = { auth, id: `key:${auth.keyId}` };
  return toolsForKey(auth.scopes).filter(() => reads !== null).map((t) => ({
    ...spec(t),
    call: (args: Record<string, unknown>, id: string) => {
      const task = (): TaskDeps => ({ reads: reads!(), work: deps.work ?? null, now });
      switch (t.kind) {
        case "read": return runTool(t.name, args, { userId: auth.userId ?? "", scope: auth.clients }, reads!(), id);
        case "work": return runWork(t.name, args, who, task(), id);
        case "api": case "cost": return runApiTool(t.name, args, who, task(), id);
        default: return Promise.resolve(NO_TOOL);
      }
    },
  }));
}

type Identity = { kind: "person"; caller: Caller; person: Person } | { kind: "key"; auth: AuthContext };

/** One server for one request, with the caller's tools bound to them. */
function serverFor(req: Request, who: Identity, deps: ConnectorDeps): McpServer {
  const now = deps.now ?? (() => new Date());
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const offered = who.kind === "person" ? toolsFor(who.caller, who.person, deps) : toolsForApiKey(who.auth, deps);
  for (const tool of offered) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }, async (args: Record<string, unknown>) => {
      const t0 = now().getTime();
      const requestId = crypto.randomUUID();
      let result: ToolResult;
      try {
        // A key's minute was counted by its lookup; a person's is counted here.
        const verdict = who.kind === "person" ? rateCheck(await deps.touch(who.person.userId), now()) : { ok: true as const };
        result = verdict.ok ? await tool.call(args, requestId) : { ok: false, status: 429, code: "rate_limited", text: verdict.text };
      } catch (e) {
        console.error(`mcp ${tool.name} rate check failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
        result = { ok: false, status: 500, code: "internal", text: "Socialytics could not answer this request." };
      }
      const row = who.kind === "person"
        ? auditRow({ tool: tool.name, status: result.status, durationMs: now().getTime() - t0, clientId: args.client_id, errorCode: result.ok ? null : result.code, userId: who.person.userId, oauthClientId: who.person.oauthClientId, ip, target: result.ok ? result.target : null })
        : auditRow({ tool: tool.name, status: result.status, durationMs: now().getTime() - t0, clientId: args.client_id, errorCode: result.ok ? null : result.code, userId: null, oauthClientId: null, ip, keyId: who.auth.keyId });
      const written = deps.audit(row).catch((e) => console.error("mcp audit failed:", e instanceof Error ? e.message : String(e)));
      if (deps.waitUntil) deps.waitUntil(written);
      else await written;
      return result.ok ? { content: [{ type: "text" as const, text: result.text }] } : { content: [{ type: "text" as const, text: result.text }], isError: true };
    });
  }
  return server;
}

/** An API key presented as the bearer: the API's own lookup, or the answer that refuses it. */
async function keyIdentity(token: string, deps: ConnectorDeps, now: Date): Promise<Identity | Response> {
  if (!deps.keys || !deps.keyTools) return Response.json({ error: "API keys are not accepted on this connection." }, { status: 401 });
  try {
    return { kind: "key", auth: await authenticateKey(token, deps.keys, now) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return Response.json({ error: "This API key is not valid." }, { status: 401 });
    if (e instanceof ApiError && e.status === 429) return Response.json({ error: e.message }, { status: 429, headers: { "Retry-After": String((e as ApiError & { retryAfter?: number }).retryAfter ?? 60) } });
    throw e;
  }
}

/** The function's whole request path. */
export function connectorFetch(deps: ConnectorDeps): (req: Request) => Promise<Response> {
  const project = deps.projectUrl.replace(/\/+$/, "");
  const discovery = withOAuthProtectedResource({ resourceServer: `${project}/functions/v1/mcp`, authorizationServer: issuerOf(project) });
  return pipeline([discovery], async (req) => {
    let who: Identity;
    try {
      const token = bearerToken(req.headers.get("Authorization"));
      if (/^soc_/.test(token)) {
        const found = await keyIdentity(token, deps, (deps.now ?? (() => new Date()))());
        if (found instanceof Response) return found;
        who = found;
      } else {
        const claims = token ? await deps.verify(token) : null;
        if (!claims) return Response.json({ error: SIGN_IN }, { status: 401 });
        const caller = { token, claims };
        const admission = await admit(claims, deps.reads(caller));
        if (!admission.ok) return Response.json({ error: admission.message }, { status: admission.status });
        who = { kind: "person", caller, person: admission.person };
      }
    } catch (e) {
      console.error("mcp sign-in check failed:", e instanceof Error ? e.message : String(e));
      return Response.json({ error: "Socialytics could not check this sign-in." }, { status: 500 });
    }
    const handler = createMcpHandler(() => serverFor(req, who, deps), { onerror: (e: Error) => console.error("mcp request failed:", e.message) });
    return handler.fetch(req);
  });
}
