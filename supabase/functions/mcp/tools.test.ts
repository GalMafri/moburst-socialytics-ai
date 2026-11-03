// @vitest-environment node
// Each tool runs the same route handler as the matching GET /v1/... of the
// Socialytics API, in process, with the person's client scope where a key's
// reach would be. Its output is the API's, capped; its errors are one plain
// sentence; it reaches nothing outside the person's clients.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handleRequest, type CoreDeps } from "../_shared/api/core";
import { scopeOf } from "../_shared/api/keys";
import { hashKey } from "../_shared/api/keys";
import { CLIENT, COMPETITIVE_REPORT, COMPETITOR, COMPETITOR_SET, HANDLE, REPORT, SCHEDULE, SPROUT_PROFILE } from "../_shared/socialytics-api/fixtures";
import { readRoutes } from "../_shared/socialytics-api/routes-read";
import { emptyData, makeFakeStore } from "../_shared/socialytics-api/store.fake";
import type { ReportRow } from "../_shared/socialytics-api/serializers";
import type { Person } from "./access";
import { runTool, TOOLS, type ToolDeps } from "./tools";

const here = dirname(fileURLToPath(import.meta.url));
const MOBURST_SEPTEMBER = (JSON.parse(readFileSync(join(here, "..", "..", "fixtures", "pipelines", "social-moburst-2026-09.json"), "utf8")) as { stored_report: ReportRow }).stored_report;

const CALM = { ...CLIENT, id: "c-calm", name: "Calm", company_slug: "calm", website_url: "https://calm.com", created_at: "2026-09-01T00:00:00.000Z" };
const DEMO = { ...CLIENT, id: "c-demo", name: "Brooklinen", company_slug: "demo-brooklinen", website_url: "https://brooklinen.com", created_at: "2026-10-01T00:00:00.000Z", demo_job_id: "job-1" };
const MOBURST = { ...CLIENT, id: MOBURST_SEPTEMBER.client_id, name: "Moburst", company_slug: "moburst", created_at: "2026-04-01T00:00:00.000Z" };
const DATA = emptyData({
  clients: [CLIENT, CALM, DEMO, MOBURST], sproutProfiles: [SPROUT_PROFILE], sets: [COMPETITOR_SET], competitors: [COMPETITOR], handles: [HANDLE], schedules: [SCHEDULE],
  reports: [REPORT, { ...REPORT, id: "rep-calm", client_id: "c-calm", created_at: "2026-09-20T00:00:00.000Z" }, { ...REPORT, id: "rep-demo", client_id: "c-demo", created_at: "2026-10-02T00:00:00.000Z" }, MOBURST_SEPTEMBER],
  competitiveReports: [COMPETITIVE_REPORT, { ...COMPETITIVE_REPORT, id: "crep-calm", client_id: "c-calm" }],
});

const person = (ids: string[], role: Person["role"] = "moburst_user"): Person => ({ userId: "00000000-0000-4000-8000-0000000000aa", email: "sinead@moburst.com", oauthClientId: "oc-1", role, scope: scopeOf(ids) });
const ADMIN = person(["c-bader", "c-calm", "c-demo", MOBURST.id], "admin");
const BADER_STAFF = person(["c-bader"]);
const BADER_CLIENT = person(["c-bader"], "client");

const THEMES = { collected: true, themes: [{ id: "th-1", week_start: "2026-10-26", title: "Rideshare injuries", happening: "h", why_it_matters: "w", angle: "a", platforms: ["tiktok"], posts: [{ platform: "tiktok", url: "https://tiktok.com/@x/1", text: "t", engagement: null }] }] };

function deps(over: Partial<ToolDeps> = {}) {
  const analyticsCalls: string[][] = [];
  const themeCalls: string[][] = [];
  const d: ToolDeps = {
    store: makeFakeStore(DATA),
    analytics: async (id, start, end) => { analyticsCalls.push([id, start, end]); return { ok: true, status: 200, data: { client: { id, name: "Bader Law" }, range: { start, end, days: 30 }, profiles: [{ id: "123456", name: "Bader Law", network: "instagram" }], totals: { impressions: 10 }, by_profile: [], top_posts: [] } }; },
    trendThemes: async (id, from, to) => { themeCalls.push([id, from, to]); return THEMES; },
    apiUrl: "https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api",
    ...over,
  };
  return { d, analyticsCalls, themeCalls };
}
const call = async (name: string, args: Record<string, unknown>, who: Person = ADMIN, over: Partial<ToolDeps> = {}) => runTool(name, args, who, deps(over).d, "req-1");
const body = (r: Awaited<ReturnType<typeof runTool>>) => (r.ok ? (r.body as Record<string, any>) : null);

/** The REST API over the same store, with an unscoped key, for comparison. */
async function api(path: string) {
  const KEY = "soc_all";
  const h = await hashKey(KEY);
  const d = deps().d;
  const core: CoreDeps = {
    tool: "socialytics", version: "1", routes: readRoutes({ store: d.store, analytics: d.analytics, health: async () => ({}) }),
    touchKey: async (x) => (x === h ? { id: "k", name: "k", key_prefix: "soc_all", scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 } : null),
    clientsForScope: async () => [], verifyAdminJwt: async () => null, cronSecret: null, serviceKey: null, audit: async () => {}, requestId: () => "r",
  };
  return (await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { headers: { Authorization: `Bearer ${KEY}` } }), core)).json();
}

describe("the tools", () => {
  it("are the eight read-only tools, named as in the API's tool manifest", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "socialytics_clients_list", "socialytics_client_get", "socialytics_reports_list", "socialytics_report_get",
      "socialytics_competitive_reports_list", "socialytics_competitive_report_get", "socialytics_client_analytics", "socialytics_trend_themes",
    ]);
    const manifest = JSON.parse(readFileSync(join(here, "..", "..", "..", "api", "mcp", "socialytics-tools.json"), "utf8")) as { tools: Array<{ name: string }> };
    const shared = new Set(manifest.tools.map((t) => t.name));
    for (const t of TOOLS.filter((x) => x.name !== "socialytics_trend_themes")) expect(shared.has(t.name), t.name).toBe(true);
    for (const t of TOOLS) {
      expect(t.annotations.readOnlyHint, t.name).toBe(true);
      expect(t.description.length, t.name).toBeGreaterThan(60);
    }
    expect(TOOLS.find((t) => t.name === "socialytics_report_get")!.description).toContain("socialytics_clients_list");
  });

  it("answer as the REST API does for the same data", async () => {
    expect(body(await call("socialytics_clients_list", { limit: 50 }))).toEqual(await api("/v1/clients?limit=50"));
    expect(body(await call("socialytics_client_get", { client_id: "c-bader" }))).toEqual(await api("/v1/clients/c-bader"));
    expect(body(await call("socialytics_reports_list", { client_id: "c-bader", status: "completed" }))).toEqual(await api("/v1/reports?client_id=c-bader&status=completed&limit=20"));
    expect(body(await call("socialytics_competitive_reports_list", {}))).toEqual(await api("/v1/competitive-reports?limit=20"));
    expect(body(await call("socialytics_competitive_report_get", { report_id: "crep-1" }))).toEqual(await api("/v1/competitive-reports/crep-1"));
    expect(body(await call("socialytics_client_analytics", { client_id: "c-bader", start: "2026-09-01", end: "2026-09-30" }))).toEqual(await api("/v1/clients/c-bader/analytics?start=2026-09-01&end=2026-09-30"));
    const report = body(await call("socialytics_report_get", { report_id: "rep-1" }));
    expect(report).toEqual(await api("/v1/reports/rep-1"));
  });

  it("find a client by part of its name and page through the rest", async () => {
    expect(body(await call("socialytics_clients_list", { q: "bader" }))!.data.map((c: { name: string }) => c.name)).toEqual(["Bader Law"]);
    const p1 = body(await call("socialytics_clients_list", { limit: 2 }))!;
    expect(p1.data).toHaveLength(2);
    const p2 = body(await call("socialytics_clients_list", { limit: 2, cursor: p1.next_cursor }))!;
    expect(p2.data.map((c: { id: string }) => c.id)).not.toContain(p1.data[0].id);
    expect(body(await call("socialytics_clients_list", { limit: 500 }))!.data).toHaveLength(4);
  });

  it("return Moburst's September report whole, without the calendar a second time inside the analysis", async () => {
    const r = await call("socialytics_report_get", { report_id: MOBURST_SEPTEMBER.id });
    const out = body(r)!;
    expect(out.omitted_sections).toBeUndefined();
    expect(out.data.calendar.length).toBeGreaterThan(0);
    expect(out.data.analysis.content_calendar).toBeUndefined();
    expect(out.data.analysis.sprout_performance_analysis).toBeDefined();
    expect(JSON.stringify(out).length).toBeLessThan(100_000);
    expect(r.ok && r.text).toBe(JSON.stringify(out));
    const just = body(await call("socialytics_report_get", { report_id: MOBURST_SEPTEMBER.id, sections: ["calendar"] }))!;
    expect(Object.keys(just.data)).toContain("calendar");
    expect(just.data.analysis).toBeUndefined();
    expect(just.data.performance).toBeUndefined();
  });

  it("split a report that would pass the cap into the sections that fit and the ones to ask for", async () => {
    const huge = { ...REPORT, id: "rep-huge", report_data: { ...(REPORT.report_data as object), sprout_performance: { overall_totals: { note: "n".repeat(70_000) } }, content_calendar: [{ day: "Monday", posts: [{ copy: "c".repeat(40_000) }] }] } };
    const out = body(await call("socialytics_report_get", { report_id: "rep-huge" }, ADMIN, { store: makeFakeStore({ ...DATA, reports: [huge] }) }))!;
    expect(out.omitted_sections).toEqual(["performance"]);
    expect(out.data.calendar).toBeDefined();
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(100_000);
  });

  it("serve the trend themes as the person, for a client they can see, over the last 30 days by default", async () => {
    const { d, themeCalls } = deps();
    const r = await runTool("socialytics_trend_themes", { client_id: "c-bader", from: "2026-10-01", to: "2026-10-31" }, BADER_CLIENT, d, "req-1");
    expect(body(r)).toEqual({ data: THEMES });
    await runTool("socialytics_trend_themes", { client_id: "c-bader" }, BADER_CLIENT, d, "req-1");
    expect(themeCalls[0]).toEqual(["c-bader", "2026-10-01", "2026-10-31"]);
    const [, from, to] = themeCalls[1];
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(29);
  });
});

describe("scoping by person", () => {
  it("lists only the person's clients and reports", async () => {
    const names = async (who: Person) => body(await call("socialytics_clients_list", {}, who))!.data.map((c: { name: string }) => c.name).sort();
    expect(await names(ADMIN)).toEqual(["Bader Law", "Brooklinen", "Calm", "Moburst"]);
    expect(await names(BADER_STAFF)).toEqual(["Bader Law"]);
    expect(await names(BADER_CLIENT)).toEqual(["Bader Law"]);
    expect(body(await call("socialytics_reports_list", {}, BADER_CLIENT))!.data.map((r: { id: string }) => r.id)).toEqual(["rep-1"]);
    expect(body(await call("socialytics_reports_list", { client_id: "c-calm" }, BADER_STAFF))!.data).toEqual([]);
    expect(body(await call("socialytics_competitive_reports_list", {}, BADER_STAFF))!.data.map((r: { id: string }) => r.id)).toEqual(["crep-1"]);
  });

  it("reads anything outside the person's clients as not found, in one plain sentence", async () => {
    const out = [
      [await call("socialytics_client_get", { client_id: "c-calm" }, BADER_CLIENT), "No client with that id among the clients you can see."],
      [await call("socialytics_client_get", { client_id: "c-nope" }, ADMIN), "No client with that id among the clients you can see."],
      [await call("socialytics_report_get", { report_id: "rep-calm" }, BADER_STAFF), "No report with that id among the clients you can see."],
      [await call("socialytics_report_get", { report_id: "rep-demo" }, BADER_CLIENT), "No report with that id among the clients you can see."],
      [await call("socialytics_competitive_report_get", { report_id: "crep-calm" }, BADER_CLIENT), "No competitive report with that id among the clients you can see."],
      [await call("socialytics_trend_themes", { client_id: "c-demo" }, BADER_STAFF), "No client with that id among the clients you can see."],
    ] as const;
    for (const [r, text] of out) expect(r).toEqual({ ok: false, status: 404, code: "not_found", text });
  });

  it("never calls Sprout Social or the trends function for a client outside the scope", async () => {
    const { d, analyticsCalls, themeCalls } = deps();
    expect((await runTool("socialytics_client_analytics", { client_id: "c-calm" }, BADER_STAFF, d, "r")).ok).toBe(false);
    expect((await runTool("socialytics_trend_themes", { client_id: "c-calm" }, BADER_STAFF, d, "r")).ok).toBe(false);
    expect(analyticsCalls).toEqual([]);
    expect(themeCalls).toEqual([]);
  });
});

describe("errors", () => {
  it("are plain sentences, never raw errors", async () => {
    const none = await call("socialytics_client_analytics", { client_id: "c-calm" }, ADMIN, { analytics: async () => ({ ok: false, status: 422, data: { error: "No Sprout profiles are assigned to this client." } }) });
    expect(none).toEqual({ ok: false, status: 422, code: "unprocessable", text: "This client has no Sprout Social profile, so Socialytics has no performance analytics for it." });
    const down = await call("socialytics_client_analytics", { client_id: "c-bader" }, ADMIN, { analytics: async () => ({ ok: false, status: 500, data: { error: "Sprout token expired at https://identity.sproutsocial.com" } }) });
    expect(down).toEqual({ ok: false, status: 502, code: "upstream_failed", text: "Sprout Social did not answer for this client just now." });
    expect(await call("socialytics_client_analytics", { client_id: "c-bader", start: "1/2/2026" })).toEqual({ ok: false, status: 400, code: "invalid_request", text: "Start and end must be yyyy-mm-dd." });
    expect(await call("socialytics_trend_themes", { client_id: "c-bader", from: "2026-10-31", to: "2026-10-01" })).toEqual({ ok: false, status: 400, code: "invalid_request", text: "From must be on or before to." });
    const broken = await call("socialytics_clients_list", {}, ADMIN, { store: { ...makeFakeStore(DATA), listClients: async () => { throw new Error('relation "clients" does not exist (req 7f3a)'); } } });
    expect(broken).toEqual({ ok: false, status: 500, code: "internal", text: "Socialytics could not answer this request." });
    expect(await call("socialytics_nothing", {})).toEqual({ ok: false, status: 404, code: "not_found", text: "There is no such Socialytics tool." });
  });
});
