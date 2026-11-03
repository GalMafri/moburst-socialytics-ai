/**
 * The connector's eight read-only tools. Names follow
 * api/mcp/socialytics-tools.json, so a skill written for either works with
 * both. Each tool runs the route handler the matching GET /v1/... of the
 * Socialytics API runs (_shared/socialytics-api/routes-read.ts), in process, with the person's
 * client scope where a key's reach would be: the same queries, serializers
 * and fields, capped by limits.ts. The trend themes come from
 * trend_themes_in_range, called as the person, the function the Analytics
 * screen reads. A failure is one plain sentence; out of scope and missing
 * read the same.
 */
import { z } from "npm:zod@4.6.7";
import { ApiError } from "../_shared/api/errors.ts";
import type { Route, RouteContext } from "../_shared/api/router.ts";
import { readRoutes, type ReadDeps } from "../_shared/socialytics-api/routes-read.ts";
import type { Store } from "../_shared/socialytics-api/store.ts";
import type { Person } from "./access.ts";
import { capItems, capPage, listLimit, pickSections } from "./limits.ts";

export interface ToolDeps {
  /** The API's store over the person's own client, so RLS applies a second time. */
  store: Store;
  /** sprout-analytics through the server path, acting for the person. */
  analytics: ReadDeps["analytics"];
  /** trend_themes_in_range(p_client, p_from, p_to), called as the person. */
  trendThemes(clientId: string, from: string, to: string): Promise<unknown>;
  /** The API's base URL, for the route context. */
  apiUrl: string;
}

/** A tool's answer. A write that wrote something names it in target (a note id, a post key, a section key, a deck id) for the audit row. */
export type ToolResult = { ok: true; status: 200; body: unknown; text: string; target?: string } | { ok: false; status: number; code: string; text: string };

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: { readOnlyHint: true; openWorldHint: false };
  run(args: Record<string, unknown>, at: ToolAt): Promise<unknown>;
}

interface ToolAt { person: Person; deps: ToolDeps; routes: Route[]; requestId: string }

const REPORT_SECTIONS = ["analysis", "calendar", "performance", "trends"] as const;
const COMPETITIVE_SECTIONS = ["analysis", "aggregates"] as const;
const NOT_FOUND = { client: "No client with that id among the clients you can see.", report: "No report with that id among the clients you can see.", competitive: "No competitive report with that id among the clients you can see." };
const FIND_CLIENT = "Call socialytics_clients_list first to find the client id.";

const id = (what: string) => z.string().describe(what);
const limit = z.number().int().optional().describe("How many to return, 1 to 50 (default 20).");
const cursor = z.string().optional().describe("The next_cursor of the previous page, for the next page.");
const day = (what: string) => z.string().optional().describe(`${what} (yyyy-mm-dd).`);

/** Runs a GET route of the API with the person's scope, as the API would for a key reaching the same clients. */
async function get(at: ToolAt, path: string, params: Record<string, string>, query: Record<string, unknown> = {}): Promise<{ data: unknown; next_cursor?: string | null }> {
  const route = at.routes.find((r) => r.method === "GET" && r.path === path);
  if (!route) throw new Error(`no route ${path}`);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const ctx: RouteContext = {
    params, query: q, body: null, requestId: at.requestId, url: new URL(`${at.deps.apiUrl}${path}`),
    auth: { kind: "key", keyId: null, keyHash: null, scopes: ["read"], clients: at.person.scope, userId: at.person.userId },
  };
  return (await route.handler(ctx)).body as { data: unknown; next_cursor?: string | null };
}

const page = (body: { data: unknown; next_cursor?: string | null }) => capPage(body as { data: Array<{ id: string; created_at: string }>; next_cursor: string | null });
const sections = (s: unknown): string[] | undefined => (Array.isArray(s) && s.length ? s.map(String) : undefined);

function notFoundAs(text: string) {
  return (e: unknown) => {
    if (e instanceof ApiError && e.status === 404) throw new ApiError(404, "not_found", text);
    throw e;
  };
}

const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** The trends window, as the API's analytics window: yyyy-mm-dd days, the last 30 by default. */
function trendWindow(from: unknown, to: unknown): { from: string; to: string } {
  const f = typeof from === "string" && from ? from : undefined, t = typeof to === "string" && to ? to : undefined;
  if ((f && !dayRe.test(f)) || (t && !dayRe.test(t))) throw new ApiError(400, "invalid_request", "from and to must be yyyy-mm-dd");
  const end = t ?? dayOf(new Date());
  const start = f ?? dayOf(new Date(Date.parse(end) - 29 * 86_400_000));
  if (start > end) throw new ApiError(400, "invalid_request", "from must be on or before to");
  return { from: start, to: end };
}

export const TOOLS: ToolSpec[] = [
  {
    name: "socialytics_clients_list", title: "List Socialytics clients",
    description: "List the Socialytics clients you can see, newest first, with their brand, readiness (setup) and last report. Call this first to turn a client's name into its id: pass part of the name as q, for example q \"Bader\". Returns { data, next_cursor }; pass next_cursor back as cursor for more.",
    inputSchema: z.object({ q: z.string().optional().describe("Part of the client name."), limit, cursor }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => page(await get(at, "/v1/clients", {}, { q: a.q, limit: listLimit(a.limit as number | undefined), cursor: a.cursor })),
  },
  {
    name: "socialytics_client_get", title: "Get a Socialytics client",
    description: `One client with its Sprout Social profile names, competitor sets with their social handles, and report schedules. ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: id("The client id.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => get(at, "/v1/clients/:id", { id: String(a.client_id) }).catch(notFoundAs(NOT_FOUND.client)),
  },
  {
    name: "socialytics_reports_list", title: "List social reports",
    description: `Social reports, newest first: period, status, deck link, counts and metric changes. To find a client's report for a month, list with its client_id and pick the one whose period covers that month, then call socialytics_report_get. ${FIND_CLIENT}`,
    inputSchema: z.object({
      client_id: z.string().optional().describe("Only this client's reports."), status: z.enum(["running", "completed", "failed"]).optional(),
      from: z.string().optional().describe("Created on or after this date (yyyy-mm-dd)."), to: z.string().optional().describe("Created on or before this date (yyyy-mm-dd)."), limit, cursor,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => page(await get(at, "/v1/reports", {}, { client_id: a.client_id, status: a.status, from: a.from, to: a.to, limit: listLimit(a.limit as number | undefined), cursor: a.cursor })),
  },
  {
    name: "socialytics_report_get", title: "Get a social report",
    description: `One social report: its header (period, status, deck link, counts, metric changes) and the sections analysis, calendar (the content calendar), performance (Sprout Social) and trends. Every section comes by default; a report too large for one answer lists the rest in omitted_sections, to ask for with sections. Call socialytics_clients_list and socialytics_reports_list first to find the report id.`,
    inputSchema: z.object({ report_id: id("The report id."), sections: z.array(z.enum(REPORT_SECTIONS)).optional().describe("Only these sections (default all).") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => {
      const body = await get(at, "/v1/reports/:id", { id: String(a.report_id) }).catch(notFoundAs(NOT_FOUND.report));
      const report = { ...(body.data as Record<string, unknown>) };
      // The stored analysis repeats the content calendar, which `calendar` already carries.
      if (report.analysis && typeof report.analysis === "object") {
        const { content_calendar: _repeat, ...analysis } = report.analysis as Record<string, unknown>;
        report.analysis = analysis;
      }
      return pickSections(report, REPORT_SECTIONS, sections(a.sections));
    },
  },
  {
    name: "socialytics_competitive_reports_list", title: "List competitive reports",
    description: `Competitive reports, newest first: period, status, deck link, totals and quality check. Then call socialytics_competitive_report_get. ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: z.string().optional().describe("Only this client's reports."), status: z.enum(["running", "complete", "failed"]).optional(), limit, cursor }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => page(await get(at, "/v1/competitive-reports", {}, { client_id: a.client_id, status: a.status, limit: listLimit(a.limit as number | undefined), cursor: a.cursor })),
  },
  {
    name: "socialytics_competitive_report_get", title: "Get a competitive report",
    description: "One competitive report: its header and the sections analysis (executive summary, scorecard, gaps, winner teardown, competitor breakdowns) and aggregates (per company). Every section comes by default; a report too large for one answer lists the rest in omitted_sections, to ask for with sections. Call socialytics_competitive_reports_list first to find the report id.",
    inputSchema: z.object({ report_id: id("The competitive report id."), sections: z.array(z.enum(COMPETITIVE_SECTIONS)).optional().describe("Only these sections (default all).") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => {
      const body = await get(at, "/v1/competitive-reports/:id", { id: String(a.report_id) }).catch(notFoundAs(NOT_FOUND.competitive));
      return pickSections(body.data as Record<string, unknown>, COMPETITIVE_SECTIONS, sections(a.sections));
    },
  },
  {
    name: "socialytics_client_analytics", title: "Get a client's Sprout Social performance",
    description: `Sprout Social performance for a client over a window (default the last 30 days): totals, the previous window, changes, per profile and top posts. ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: id("The client id."), start: day("First day"), end: day("Last day") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => get(at, "/v1/clients/:id/analytics", { id: String(a.client_id) }, { start: a.start, end: a.end }).catch(notFoundAs(NOT_FOUND.client)),
  },
  {
    name: "socialytics_trend_themes", title: "Get a client's weekly trend themes",
    description: `The client's weekly trend themes for the weeks with any day between from and to (default the last 30 days), newest week first, each with what is happening, why it matters, the angle for the client and the posts it is built on. If omitted_themes is present, ask again with an earlier to date for the older themes. ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: id("The client id."), from: day("First day"), to: day("Last day") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, at) => {
      const clientId = String(a.client_id);
      if (!at.person.scope.allows(clientId)) throw new ApiError(404, "not_found", NOT_FOUND.client);
      const w = trendWindow(a.from, a.to);
      const answer = (await at.deps.trendThemes(clientId, w.from, w.to)) as { collected?: unknown; themes?: unknown } | null;
      const all = { collected: answer?.collected === true, themes: Array.isArray(answer?.themes) ? answer!.themes as unknown[] : [] };
      const { kept, omitted } = capItems(all.themes, (themes) => ({ data: { ...all, themes }, omitted_themes: all.themes.length }));
      return omitted ? { data: { ...all, themes: kept }, omitted_themes: omitted } : { data: all };
    },
  },
];

export const sentence = (m: string) => {
  const t = m.trim().replace(/[.\s]+$/, "");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "Socialytics could not answer this request.";
};

/** What a failure says: one plain sentence, nothing internal. */
export function failure(e: unknown, tool: string, requestId: string): ToolResult {
  if (e instanceof ApiError) {
    if (e.status === 404) return { ok: false, status: 404, code: "not_found", text: sentence(e.message) };
    if (e.status === 400) return { ok: false, status: 400, code: "invalid_request", text: sentence(e.message) };
    if (e.status === 422) return { ok: false, status: 422, code: "unprocessable", text: "This client has no Sprout Social profile, so Socialytics has no performance analytics for it." };
    if (e.status === 502) return { ok: false, status: 502, code: "upstream_failed", text: "Sprout Social did not answer for this client just now." };
  }
  console.error(`mcp ${tool} failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
  return { ok: false, status: 500, code: "internal", text: "Socialytics could not answer this request." };
}

/** Runs one tool for a person. The arguments were checked against the tool's schema by the SDK. */
export async function runTool(name: string, args: Record<string, unknown>, person: Person, deps: ToolDeps, requestId: string): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, status: 404, code: "not_found", text: "There is no such Socialytics tool." };
  const routes = readRoutes({ store: deps.store, analytics: deps.analytics, health: async () => { throw new Error("health is not served to the connector"); } });
  try {
    const body = await tool.run(args, { person, deps, routes, requestId });
    return { ok: true, status: 200, body, text: JSON.stringify(body) };
  } catch (e) {
    return failure(e, name, requestId);
  }
}
