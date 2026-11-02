/**
 * The read routes: everything Socialytics holds, scoped to the key's
 * clients, paginated, in the shapes of serializers.ts.
 */
import { pageOf, parseLimit } from "../_shared/api/cursor.ts";
import { ApiError, invalid, notFound } from "../_shared/api/errors.ts";
import type { Route, RouteContext } from "../_shared/api/router.ts";
import { alertOut, analyticsOut, clientOut, competitiveReportOut, competitorSetOut, designSystemOut, mediaJobOut, postOut, reportOut, scheduledPostOut, scheduleOut, type ClientRow } from "./serializers.ts";
import { pageFrom, type Store } from "./store.ts";

export interface AnalyticsAnswer { ok: boolean; status: number; data: unknown }
export interface ReadDeps {
  store: Store;
  /** sprout-analytics through the server path; the function's own status comes back as is. */
  analytics(clientId: string, start: string, end: string): Promise<AnalyticsAnswer>;
  health(): Promise<unknown>;
}

const q = (ctx: RouteContext, name: string): string | undefined => ctx.query.get(name)?.trim() || undefined;
const page = (ctx: RouteContext) => pageFrom(parseLimit(ctx.query.get("limit")), ctx.query.get("cursor"));
const ok = (data: unknown) => ({ status: 200, body: { data } });
const listBody = <T extends { created_at: string; id: string }>(rowsIn: T[], limit: number, map: (r: T) => unknown) => {
  const p = pageOf(rowsIn, limit);
  return { status: 200, body: { data: p.data.map(map), next_cursor: p.next_cursor } };
};
const flag = (ctx: RouteContext, name: string): boolean | undefined => {
  const v = q(ctx, name);
  if (v == null) return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw invalid(`${name} must be true or false`);
};
function isoDate(raw: string | undefined, name: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw invalid(`${name} must be an ISO date`);
  return d.toISOString();
}
const day = (d: Date) => d.toISOString().slice(0, 10);
function dayRange(ctx: RouteContext): { start: string; end: string } {
  const endRaw = q(ctx, "end"), startRaw = q(ctx, "start");
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if ((endRaw && !re.test(endRaw)) || (startRaw && !re.test(startRaw))) throw invalid("start and end must be yyyy-mm-dd");
  const end = endRaw ?? day(new Date());
  const start = startRaw ?? day(new Date(new Date(end).getTime() - 29 * 86_400_000));
  if (start > end) throw invalid("start must be on or before end");
  return { start, end };
}

export function readRoutes(deps: ReadDeps): Route[] {
  const { store } = deps;
  const clientRows = async (rowsIn: ClientRow[], detail: boolean) => {
    const extras = await store.clientExtras(rowsIn.map((c) => c.id));
    return Promise.all(rowsIn.map(async (c) => clientOut(c, { ...extras[c.id], schedules: detail ? await store.schedulesOf(c.id) : undefined, detail })));
  };
  const loadClient = async (ctx: RouteContext) => {
    const c = await store.getClient(ctx.params.id, ctx.auth.clients);
    if (!c) throw notFound("Client");
    return c;
  };
  return [
    {
      method: "GET", path: "/v1/clients", auth: "key", scope: "read",
      doc: { summary: "List clients", tag: "Clients", query: { q: { type: "string", description: "Part of the client name." }, company_slug: { type: "string" }, include_archived: { type: "boolean" } }, response: "ClientList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        const cut = pageOf(await store.listClients(ctx.auth.clients, { q: q(ctx, "q"), company_slug: q(ctx, "company_slug"), include_archived: flag(ctx, "include_archived") }, p), p.limit);
        return { status: 200, body: { data: await clientRows(cut.data, false), next_cursor: cut.next_cursor } };
      },
    },
    {
      method: "GET", path: "/v1/clients/:id", auth: "key", scope: "read", doc: { summary: "One client with its profiles, competitor sets and schedules", tag: "Clients", response: "Client" },
      handler: async (ctx) => ok((await clientRows([await loadClient(ctx)], true))[0]),
    },
    {
      method: "GET", path: "/v1/clients/:id/setup", auth: "key", scope: "read", doc: { summary: "Readiness of a client (brand, pillars, keywords, Sprout, competitors, design, schedule)", tag: "Clients", response: "Setup" },
      handler: async (ctx) => ok((await clientRows([await loadClient(ctx)], false))[0].setup),
    },
    {
      method: "GET", path: "/v1/clients/:id/analytics", auth: "key", scope: "read",
      doc: { summary: "Sprout performance for a client over a window (default: the last 30 days)", tag: "Clients", query: { start: { type: "string", description: "yyyy-mm-dd" }, end: { type: "string", description: "yyyy-mm-dd" } }, response: "Analytics" },
      handler: async (ctx) => {
        const c = await loadClient(ctx);
        const { start, end } = dayRange(ctx);
        const a = await deps.analytics(c.id, start, end);
        if (a.ok && a.data && typeof a.data === "object") return ok(analyticsOut(a.data as Record<string, unknown>));
        const message = (a.data as { error?: string } | null)?.error ?? `The analytics service answered ${a.status}.`;
        if (a.status === 422) throw new ApiError(422, "unprocessable", message, { reason: "no_sprout_profiles" });
        if (a.status === 400) throw invalid(message);
        throw new ApiError(502, "upstream_failed", message);
      },
    },
    {
      method: "GET", path: "/v1/reports", auth: "key", scope: "read",
      doc: { summary: "List social reports", tag: "Reports", query: { client_id: { type: "string" }, status: { type: "string", enum: ["running", "completed", "failed"] }, from: { type: "string" }, to: { type: "string" } }, response: "ReportList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listReports(ctx.auth.clients, { client_id: q(ctx, "client_id"), status: q(ctx, "status"), from: isoDate(q(ctx, "from"), "from"), to: isoDate(q(ctx, "to"), "to") }, p), p.limit, (r) => reportOut(r));
      },
    },
    {
      method: "GET", path: "/v1/reports/:id", auth: "key", scope: "read", doc: { summary: "One social report with its analysis, calendar, performance and trends", tag: "Reports", response: "Report" },
      handler: async (ctx) => {
        const r = await store.getReport(ctx.params.id, ctx.auth.clients);
        if (!r) throw notFound("Report");
        return ok(reportOut(r, { detail: true }));
      },
    },
    {
      method: "GET", path: "/v1/competitive-reports", auth: "key", scope: "read",
      doc: { summary: "List competitive reports", tag: "Competitive", query: { client_id: { type: "string" }, status: { type: "string", enum: ["running", "complete", "failed"] } }, response: "CompetitiveReportList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listCompetitiveReports(ctx.auth.clients, { client_id: q(ctx, "client_id"), status: q(ctx, "status") }, p), p.limit, (r) => competitiveReportOut(r));
      },
    },
    {
      method: "GET", path: "/v1/competitive-reports/:id", auth: "key", scope: "read", doc: { summary: "One competitive report with its analysis and per-company aggregates", tag: "Competitive", response: "CompetitiveReport" },
      handler: async (ctx) => {
        const r = await store.getCompetitiveReport(ctx.params.id, ctx.auth.clients);
        if (!r) throw notFound("Competitive report");
        return ok(competitiveReportOut(r, { detail: true }));
      },
    },
    {
      method: "GET", path: "/v1/competitor-sets", auth: "key", scope: "read",
      doc: { summary: "List competitor sets with their competitors and handles", tag: "Competitive", query: { client_id: { type: "string" }, status: { type: "string", enum: ["draft", "confirmed", "analyzing", "complete", "failed"] } }, response: "CompetitorSetList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listSets(ctx.auth.clients, { client_id: q(ctx, "client_id"), status: q(ctx, "status") }, p), p.limit, competitorSetOut);
      },
    },
    {
      method: "GET", path: "/v1/competitor-sets/:id", auth: "key", scope: "read", doc: { summary: "One competitor set", tag: "Competitive", response: "CompetitorSet" },
      handler: async (ctx) => {
        const s = await store.getSet(ctx.params.id, ctx.auth.clients);
        if (!s) throw notFound("Competitor set");
        return ok(competitorSetOut(s));
      },
    },
    {
      method: "GET", path: "/v1/posts", auth: "key", scope: "read",
      doc: { summary: "List generated posts", tag: "Posts", query: { client_id: { type: "string" }, report_id: { type: "string" }, source: { type: "string", enum: ["calendar", "ad_hoc", "recommendation"] }, approved: { type: "boolean" }, include_archived: { type: "boolean" } }, response: "PostList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listPosts(ctx.auth.clients, { client_id: q(ctx, "client_id"), report_id: q(ctx, "report_id"), source: q(ctx, "source"), approved: flag(ctx, "approved"), include_archived: flag(ctx, "include_archived") }, p), p.limit, postOut);
      },
    },
    {
      method: "GET", path: "/v1/posts/:id", auth: "key", scope: "read", doc: { summary: "One generated post", tag: "Posts", response: "Post" },
      handler: async (ctx) => {
        const r = await store.getPost(ctx.params.id, ctx.auth.clients);
        if (!r) throw notFound("Post");
        return ok(postOut(r));
      },
    },
    {
      method: "GET", path: "/v1/media-jobs", auth: "key", scope: "read", doc: { summary: "List media generation jobs", tag: "Posts", query: { client_id: { type: "string" }, status: { type: "string" } }, response: "MediaJobList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listMediaJobs(ctx.auth.clients, { client_id: q(ctx, "client_id"), status: q(ctx, "status") }, p), p.limit, mediaJobOut);
      },
    },
    {
      method: "GET", path: "/v1/schedules", auth: "key", scope: "read", doc: { summary: "List report schedules", tag: "Schedules", query: { client_id: { type: "string" } }, response: "ScheduleList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listSchedules(ctx.auth.clients, { client_id: q(ctx, "client_id") }, p), p.limit, scheduleOut);
      },
    },
    {
      method: "GET", path: "/v1/scheduled-posts", auth: "key", scope: "read", doc: { summary: "List posts scheduled to Sprout", tag: "Schedules", query: { client_id: { type: "string" }, status: { type: "string" } }, response: "ScheduledPostList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listScheduledPosts(ctx.auth.clients, { client_id: q(ctx, "client_id"), status: q(ctx, "status") }, p), p.limit, scheduledPostOut);
      },
    },
    {
      method: "GET", path: "/v1/alerts", auth: "key", scope: "read", doc: { summary: "List competitive alerts", tag: "Competitive", query: { client_id: { type: "string" }, status: { type: "string" } }, response: "AlertList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listAlerts(ctx.auth.clients, { client_id: q(ctx, "client_id"), status: q(ctx, "status") }, p), p.limit, alertOut);
      },
    },
    {
      method: "GET", path: "/v1/design-systems", auth: "key", scope: "read", doc: { summary: "List design systems", tag: "Design", query: { client_id: { type: "string" } }, response: "DesignSystemList", list: true },
      handler: async (ctx) => {
        const p = page(ctx);
        return listBody(await store.listDesignSystems(ctx.auth.clients, { client_id: q(ctx, "client_id") }, p), p.limit, designSystemOut);
      },
    },
    {
      method: "GET", path: "/v1/status", auth: "key", scope: "read", doc: { summary: "Pipeline health and demo job status (a company-scoped key sees its own clients' findings only)", tag: "System", response: "Status" },
      handler: async (ctx) => {
        const h = (await deps.health()) as Record<string, unknown> & { findings?: Array<{ client_id?: string | null }> };
        if (ctx.auth.clients.all) return ok(h);
        const { demo_jobs: _demo, counts: _counts, ...rest } = h;
        return ok({ ...rest, findings: (h.findings ?? []).filter((f) => f.client_id && ctx.auth.clients.allows(f.client_id)) });
      },
    },
  ];
}
