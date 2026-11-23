/**
 * The connector's work and self-describing tools, beside the reads, the
 * person's reads and the saves (tools.ts, reads.ts, writes.ts; the one list
 * of all of them is catalog.ts):
 *
 *   - task tools start the work people start in the app, through the API's
 *     own public actions (_shared/socialytics-api/actions.ts) run in process:
 *     the same inputs, reach checks, idempotency and internal calls the REST
 *     API makes. Every one is two-step: called without confirm_token it
 *     returns what it would do, an estimate from the cost ledger and a
 *     confirm_token, and starts nothing; called again with the same
 *     arguments and that token (within ten minutes) it starts the work. A
 *     token is signed for one caller, one tool and those exact arguments, and
 *     a confirmed call sent twice answers the first answer instead of
 *     starting the work again (the action's idempotency key comes from it).
 *   - socialytics_api_schema lists every read endpoint of the API with its
 *     parameters, read from the route table the OpenAPI document is built
 *     from, so it is current with the code; socialytics_api calls any of them,
 *     in process, with the caller's own reach.
 *   - socialytics_cost_summary reads what Socialytics' paid providers cost,
 *     through the API's /v1/costs route (the costs scope).
 *
 * A person signed in through Claude starts work only when they are Moburst
 * staff who can change the client (is_moburst_staff and can_write_client,
 * asked as them, as the saves ask); an API key needs the run scope and
 * reaches its own clients.
 */
import { z } from "npm:zod@4.6.7";
import { actionRoutes, type ActionRunStore } from "../_shared/api/actions.ts";
import { stableJson } from "../_shared/api/docs.ts";
import { ApiError } from "../_shared/api/errors.ts";
import { matchRoute, type AuthContext, type Route, type RouteContext, type Scope } from "../_shared/api/router.ts";
import { PRICES } from "../_shared/cost/pricing.ts";
import { costRoutes, type CostStore } from "../_shared/cost/routes.ts";
import { socialyticsActions, type ActionAdapterDeps } from "../_shared/socialytics-api/actions.ts";
import { readRoutes } from "../_shared/socialytics-api/routes-read.ts";
import type { Store } from "../_shared/socialytics-api/store.ts";
import type { Role } from "./access.ts";
import { capPage, RESULT_CAP } from "./limits.ts";
import type { Annotations } from "./reads.ts";
import { sentence, type ToolDeps, type ToolResult } from "./tools.ts";
import type { PersonChecks } from "./writes.ts";

/** Who a tool runs for. */
export interface Who {
  /** The caller as the API sees it: scopes, client reach, the person or the key. */
  auth: AuthContext;
  /** user:<id> or key:<id>: whom a confirm_token is signed for. */
  id: string;
  /** A person signed in through Claude: their role, and their own checks before any work starts. */
  person?: { role: Role; checks: PersonChecks };
}

/** What the work tools need, over the service role (index.ts), beside the caller's reads. */
export interface WorkDeps {
  /** The actions' internal calls and their idempotency keys; the store reads with no reach of its own (the routes apply the caller's). */
  actions: Omit<ActionAdapterDeps, "store"> & { store: Store; runs: ActionRunStore };
  /** The cost ledger, for estimates and the cost summary. */
  costs: CostStore;
  /** HMAC-SHA256 of the text with the server's secret, hex. Throws when the connector has no secret. */
  sign(text: string): Promise<string>;
}

export interface TaskDeps {
  /** The read routes' dependencies for this caller (tools.ts ToolDeps). */
  reads: ToolDeps;
  /** Null when this connector is not wired for work (a test, or a function with no service wiring). */
  work: WorkDeps | null;
  now(): Date;
}

export interface TaskSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: Annotations;
  /** What it runs: "action:<name>" for a public action, "GET /v1/..." for a route. */
  uses: string[];
}

interface WorkSpec extends TaskSpec {
  /** The public action these arguments start. */
  action(args: Record<string, unknown>): string;
  /** The action's body. */
  body(args: Record<string, unknown>): Record<string, unknown>;
  /** What the work is, in one sentence, for the estimate. */
  does(args: Record<string, unknown>): string;
  /** The cost features (cost_events.feature) one run of it records, for the estimate. */
  features(args: Record<string, unknown>): string[];
}

export const CONFIRM_MINUTES = 10;
const NO_CLIENT = "No client with that id among the clients you can see.";
const STAFF_ONLY = "Starting work from Claude is for Moburst staff, on clients they can change in Socialytics.";
const FIND_CLIENT = "Call socialytics_clients_list first to find the client id.";
const TWO_STEP = "It costs money, charged to the client: call it first without confirm_token to get what it will do, an estimate and a confirm_token, show those to the person, and call it again with the same arguments and the confirm_token only once they agree.";

const clientId = z.string().describe("The client id.");
const confirm = z.string().optional().describe("The confirm_token from the first call. Leave it out to get the estimate first; nothing starts without it.");
const idem = z.string().max(200).optional().describe("Optional. The same value on a retry never starts the work twice.");
const WORK: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const READ: Annotations = { readOnlyHint: true, openWorldHint: false };
const pick = (a: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== null && a[k] !== "").map((k) => [k, a[k]]));

export const WORK_TOOLS: WorkSpec[] = [
  {
    name: "socialytics_report_start", title: "Start a social or competitive report",
    description: `Start a client's monthly social report (kind social) or competitive report on its confirmed competitors (kind competitive) for a period, by default the last 30 days. A run already open or running for the client is answered instead of starting a second. Follow it with socialytics_reports_list or socialytics_competitive_reports_list; a report takes about an hour. ${TWO_STEP} ${FIND_CLIENT}`,
    inputSchema: z.object({
      client_id: clientId, kind: z.enum(["social", "competitive"]).describe("social (default) or competitive."),
      start: z.string().optional().describe("First day (yyyy-mm-dd); send with end, or neither."), end: z.string().optional().describe("Last day (yyyy-mm-dd)."),
      confirm_token: confirm, idempotency_key: idem,
    }),
    annotations: WORK, uses: ["action:start_social_report", "action:start_competitive_report"],
    action: (a) => (a.kind === "competitive" ? "start_competitive_report" : "start_social_report"),
    body: (a) => pick(a, ["start", "end"]),
    does: (a) => `Starts a ${a.kind === "competitive" ? "competitive" : "social"} report for the client${a.start ? ` for ${a.start} to ${a.end}` : " for the last 30 days"}.`,
    features: (a) => (a.kind === "competitive" ? ["report.competitive.analysis", "report.competitive.linkedin"] : ["report.social.synthesis", "report.social.brief"]),
  },
  {
    name: "socialytics_post_draft", title: "Draft a post",
    description: `Draft one social post for a client from a topic, in the client's voice, pillars and competitive picture: platform, format, hook, concept, visual direction, copy, CTA and hashtags. Nothing is saved; add it to the calendar in Socialytics. ${TWO_STEP} ${FIND_CLIENT}`,
    inputSchema: z.object({
      client_id: clientId, platform: z.string().describe("Instagram, Facebook, TikTok, LinkedIn, X and so on."), topic: z.string().max(2000).describe("What the post is about."),
      format: z.string().optional().describe("Image, Carousel, Video, Reel, or Story (Instagram and Facebook only). Default: chosen for the topic."), confirm_token: confirm, idempotency_key: idem,
    }),
    annotations: WORK, uses: ["action:draft_post"],
    action: () => "draft_post", body: (a) => pick(a, ["platform", "topic", "format"]),
    does: (a) => `Drafts one ${String(a.platform)} post about: ${String(a.topic).slice(0, 120)}.`, features: () => ["post.ad_hoc"],
  },
  {
    name: "socialytics_post_design_start", title: "Start a calendar post's designs",
    description: `Start the design options for one of a client's calendar posts, as its Create design button does, optionally following a note. The options appear on the post in Socialytics when they are ready. The post_key comes from socialytics_calendar_posts. ${TWO_STEP}`,
    inputSchema: z.object({ client_id: clientId, post_key: z.string().describe("The calendar post's post_key."), note: z.string().max(2000).optional().describe("What every option should follow."), confirm_token: confirm, idempotency_key: idem }),
    annotations: WORK, uses: ["action:design_post"],
    action: () => "design_post", body: (a) => pick(a, ["post_key", "note"]),
    does: (a) => `Starts the design options for calendar post ${String(a.post_key)}.`, features: () => [],
  },
  {
    name: "socialytics_competitors_identify", title: "Propose competitors",
    description: `Propose a new draft set of 8 to 12 competitors for a client, each with a rationale and a similarity score, for the team to review and confirm on the Competitors screen. Earlier sets are kept. ${TWO_STEP} ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: clientId, confirm_token: confirm, idempotency_key: idem }),
    annotations: WORK, uses: ["action:identify_competitors"],
    action: () => "identify_competitors", body: () => ({}), does: () => "Proposes a new draft set of competitors for the client.", features: () => ["competitors.identify"],
  },
  {
    name: "socialytics_competitor_feed_refresh", title: "Refresh the competitor feed",
    description: `Collect the client's competitors' recent posts again (the last 7 days, or days 1 to 30) and detect the topics several of them share, which become competitive alerts. ${TWO_STEP} ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: clientId, days: z.number().int().min(1).max(30).optional().describe("The window in days (default 7)."), confirm_token: confirm, idempotency_key: idem }),
    annotations: WORK, uses: ["action:refresh_competitor_feed"],
    action: () => "refresh_competitor_feed", body: (a) => pick(a, ["days"]),
    does: (a) => `Collects the competitors' posts of the last ${a.days ?? 7} days and detects shared topics.`, features: () => ["competitors.feed_refresh"],
  },
  {
    name: "socialytics_calendar_week_plan", title: "Plan a calendar week",
    description: `Plan a week of a client's content calendar, as its Plan next week button does: the week named by its Monday, or the earliest week without a plan, up to four weeks ahead. The posts appear in the calendar when the plan is written. ${TWO_STEP} ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: clientId, week: z.string().optional().describe("The Monday of the week (yyyy-mm-dd)."), confirm_token: confirm, idempotency_key: idem }),
    annotations: WORK, uses: ["action:plan_calendar_week"],
    action: () => "plan_calendar_week", body: (a) => pick(a, ["week"]),
    does: (a) => (a.week ? `Plans the client's calendar week of ${a.week}.` : "Plans the client's earliest calendar week without a plan."), features: () => ["calendar.week_copy", "calendar.moments"],
  },
];

export const API_TOOLS: TaskSpec[] = [
  {
    name: "socialytics_api_schema", title: "List the Socialytics API's read endpoints",
    description: "Every read endpoint of the Socialytics API this connection may call, from the live route table: path, what it returns, its path parameters and its query parameters. Use it to find data the other tools do not cover, then call socialytics_api with the path.",
    inputSchema: z.object({}), annotations: READ, uses: ["GET /v1/*"],
  },
  {
    name: "socialytics_api", title: "Call a Socialytics API read endpoint",
    description: "Call any read endpoint socialytics_api_schema lists, with this connection's own reach: path like /v1/clients/<id>/setup, and query as an object of parameters. Answers what the REST API answers. Lists return { data, next_cursor }; pass next_cursor back as cursor for more.",
    inputSchema: z.object({ path: z.string().describe("The endpoint path, starting /v1/."), query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Query parameters, for example { \"client_id\": \"...\", \"limit\": 20 }.") }),
    annotations: READ, uses: ["GET /v1/*"],
  },
];

export const COST_TOOL: TaskSpec = {
  name: "socialytics_cost_summary", title: "Get Socialytics' costs",
  description: "What Socialytics' paid AI and data services cost over a period, in USD: the total and rows grouped by provider and client by default (or by day, feature, resource and so on). Default: the last 30 days.",
  inputSchema: z.object({
    from: z.string().optional().describe("Start, inclusive (yyyy-mm-dd). Default: 30 days before to."), to: z.string().optional().describe("End, exclusive (yyyy-mm-dd). Default: now."),
    group_by: z.string().optional().describe("Comma list of day, week, month, client, provider, resource, feature, bucket, env. Default provider,client."), client_id: z.string().optional().describe("Only this client's costs."),
  }),
  annotations: READ, uses: ["GET /v1/costs"],
};

/** Public actions no tool starts, and why. */
export const API_ONLY: Record<string, string> = {
  rewrite_post_copy: "Claude writes copy itself and saves it with socialytics_post_copy_save; the API keeps the app's own rewrite for scripts.",
};

// ── Confirm tokens ──

async function tokenFor(tool: string, args: Record<string, unknown>, who: Who, exp: number, sign: WorkDeps["sign"]): Promise<string> {
  const { confirm_token: _t, ...rest } = args;
  return `${exp}.${await sign(stableJson({ tool, args: rest, who: who.id, exp }))}`;
}

async function tokenOk(token: string, tool: string, args: Record<string, unknown>, who: Who, now: Date, sign: WorkDeps["sign"]): Promise<boolean> {
  const exp = Number(token.split(".")[0]);
  if (!Number.isInteger(exp) || exp < now.getTime()) return false;
  const expected = await tokenFor(tool, args, who, exp, sign);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** What the features cost per recorded call over the last 30 days, all clients, from the ledger. */
async function estimate(features: string[], costs: CostStore, now: Date): Promise<{ usd: number | null; basis: string }> {
  if (!features.length) return { usd: null, basis: "No recorded figure for this work yet; it is charged to the client as it runs." };
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = await costs.summary(from, to, ["feature"], {});
  let usd = 0, seen = 0;
  for (const f of features) {
    const r = rows.find((x) => x.feature === f);
    if (r && r.events > 0) { usd += r.cost_usd / r.events; seen++; }
  }
  if (!seen) return { usd: null, basis: "No recorded runs of this work in the last 30 days, so no figure yet." };
  return { usd: Math.round(usd * 10_000) / 10_000, basis: `The average recorded cost per call of ${features.join(", ")} over the last 30 days, across clients. Data collection billed by the run is not included.` };
}

// ── Running ──

const refused = (status: number, code: string, text: string): ToolResult => ({ ok: false, status, code, text: sentence(text) });
const answered = (body: unknown): ToolResult => ({ ok: true, status: 200, body, text: JSON.stringify(body) });

function failed(e: unknown, tool: string, requestId: string): ToolResult {
  if (e instanceof ApiError) return refused(e.status, e.code, e.message);
  console.error(`mcp ${tool} failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
  return refused(500, "internal", "Socialytics could not answer this request");
}

async function runAction(name: string, clientId: string, body: Record<string, unknown>, who: Who, work: WorkDeps, requestId: string): Promise<unknown> {
  const defs = socialyticsActions({ ...work.actions });
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`no action ${name}`);
  const route = actionRoutes([def], { runs: work.actions.runs })[0];
  const path = route.path.replace(":id", encodeURIComponent(clientId));
  const ctx: RouteContext = { params: { id: clientId }, query: new URLSearchParams(), body, auth: who.auth, requestId, url: new URL(`https://connector.invalid/functions/v1/api${path}`) };
  const res = await route.handler(ctx);
  return (res.body as { data?: unknown } | null)?.data ?? null;
}

/** Runs one work tool: the estimate and a confirm_token first, the work only with the token. */
export async function runWork(name: string, args: Record<string, unknown>, who: Who, deps: TaskDeps, requestId: string): Promise<ToolResult> {
  const tool = WORK_TOOLS.find((t) => t.name === name);
  if (!tool) return refused(404, "not_found", "There is no such Socialytics tool");
  const work = deps.work;
  if (!work) return refused(503, "unavailable", "Starting work is not available on this connection");
  try {
    const client = String(args.client_id ?? "");
    if (!who.auth.scopes.includes("run")) return refused(403, "forbidden", "This connection may read Socialytics but not start work");
    if (!client || !who.auth.clients.allows(client)) return refused(404, "not_found", NO_CLIENT);
    if (who.person) {
      const staff = who.person.role === "admin" || who.person.role === "moburst_user";
      if (!staff || !(await who.person.checks.isStaff()) || !(await who.person.checks.canWrite(client))) return refused(403, "forbidden", STAFF_ONLY);
    }
    const now = deps.now();
    const token = typeof args.confirm_token === "string" ? args.confirm_token.trim() : "";
    if (!token) {
      const exp = now.getTime() + CONFIRM_MINUTES * 60_000;
      return answered({
        status: "needs_confirmation", action: tool.action(args), client_id: client, will: tool.does(args), estimate: await estimate(tool.features(args), work.costs, now),
        confirm_token: await tokenFor(name, args, who, exp, work.sign), expires_at: new Date(exp).toISOString(),
        next: `Nothing has started. Show the person what it will do and the estimate; if they agree, call ${name} again with the same arguments and this confirm_token.`,
      });
    }
    if (!(await tokenOk(token, name, args, who, now, work.sign))) return refused(400, "invalid_request", `This confirm_token has expired or was given for other arguments. Call ${name} without confirm_token for a new estimate`);
    const idempotency = typeof args.idempotency_key === "string" && args.idempotency_key.trim() ? args.idempotency_key.trim() : `mcp-${token.split(".")[1].slice(0, 48)}`;
    const data = await runAction(tool.action(args), client, { ...tool.body(args), idempotency_key: idempotency }, who, work, requestId);
    return answered({ status: "started", action: tool.action(args), result: data });
  } catch (e) {
    return failed(e, name, requestId);
  }
}

/** The read routes this caller may call: the API's reads, and the cost routes with the costs scope. */
function readable(who: Who, deps: TaskDeps): Route[] {
  const reads = readRoutes({ store: deps.reads.store, analytics: deps.reads.analytics, health: async () => { throw new Error("health is not served to the connector"); } });
  const costs = deps.work && who.auth.scopes.includes("costs") ? costRoutes({ tool: "socialytics", store: deps.work.costs, prices: PRICES }) : [];
  return [...reads, ...costs].filter((r) => r.method === "GET" && r.auth === "key" && r.path !== "/v1/status" && (!r.scope || who.auth.scopes.includes(r.scope as Scope)));
}

function endpoint(r: Route) {
  const query: Record<string, { type: string; description?: string; enum?: string[] }> = { ...(r.doc.query ?? {}) };
  if (r.doc.list) {
    query.limit = { type: "integer", description: "1 to 200 (default 50)." };
    query.cursor = { type: "string", description: "The next_cursor of the previous page." };
  }
  return { path: r.path.replace(/:([a-zA-Z_]+)/g, "{$1}"), summary: r.doc.summary, tag: r.doc.tag, scope: r.scope ?? null, path_params: [...r.path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1]), query, list: r.doc.list === true };
}

/** socialytics_api_schema, socialytics_api and socialytics_cost_summary. */
export async function runApiTool(name: string, args: Record<string, unknown>, who: Who, deps: TaskDeps, requestId: string): Promise<ToolResult> {
  try {
    if (name === "socialytics_api_schema") {
      return answered({ base: "/v1", note: "Call an endpoint with socialytics_api. Path parameters go in the path; ids come from the list endpoints.", endpoints: readable(who, deps).map(endpoint) });
    }
    if (name === "socialytics_api") {
      const raw = String(args.path ?? "").trim();
      let url: URL;
      try { url = new URL(raw, "https://connector.invalid"); } catch { return refused(400, "invalid_request", "path must be an API path such as /v1/clients"); }
      if (!url.pathname.startsWith("/v1/")) return refused(400, "invalid_request", "path must start with /v1/");
      const match = matchRoute(readable(who, deps), "GET", url.pathname);
      if ("error" in match) return refused(404, "not_found", "No read endpoint this connection may call at that path. Call socialytics_api_schema for the list");
      const q = new URLSearchParams(url.search);
      for (const [k, v] of Object.entries((args.query ?? {}) as Record<string, unknown>)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
      const ctx: RouteContext = { params: match.params, query: q, body: null, auth: who.auth, requestId, url: new URL(`https://connector.invalid/functions/v1/api${url.pathname}`) };
      const body = (await match.route.handler(ctx)).body as { data?: unknown; next_cursor?: string | null };
      const out = Array.isArray(body?.data) && "next_cursor" in (body ?? {}) ? capPage(body as { data: Array<{ id: string; created_at: string }>; next_cursor: string | null }) : body;
      const text = JSON.stringify(out);
      if (text.length > RESULT_CAP) return refused(413, "too_large", "The answer is too large for one reply. Ask for fewer items (limit) or a narrower filter");
      return { ok: true, status: 200, body: out, text };
    }
    if (name === "socialytics_cost_summary") {
      if (!deps.work || !who.auth.scopes.includes("costs")) return refused(403, "forbidden", "Costs need the costs permission, which this connection does not have");
      const route = costRoutes({ tool: "socialytics", store: deps.work.costs, prices: PRICES }).find((r) => r.method === "GET" && r.path === "/v1/costs")!;
      const q = new URLSearchParams();
      for (const k of ["from", "to", "client_id"]) if (typeof args[k] === "string" && args[k]) q.set(k, String(args[k]));
      q.set("group_by", typeof args.group_by === "string" && args.group_by.trim() ? args.group_by.trim() : "provider,client");
      const ctx: RouteContext = { params: {}, query: q, body: null, auth: who.auth, requestId, url: new URL("https://connector.invalid/functions/v1/api/v1/costs") };
      const body = (await route.handler(ctx)).body as { data?: unknown };
      return answered(body?.data ?? body);
    }
    return refused(404, "not_found", "There is no such Socialytics tool");
  } catch (e) {
    return failed(e, name, requestId);
  }
}
