import { describe, it, expect } from "vitest";
import { ALERT, CLIENT, COMPETITIVE_REPORT, COMPETITOR, COMPETITOR_SET, DESIGN_SYSTEM, HANDLE, MEDIA_JOB, POST, REPORT, SCHEDULE, SCHEDULED_POST, SPROUT_PROFILE } from "./fixtures";
import { readRoutes } from "./routes-read";
import { makeFakeStore, emptyData } from "./store.fake";
import { handleRequest, type CoreDeps } from "../_shared/api/core";
import { hashKey } from "../_shared/api/keys";
import { decodeCursor } from "../_shared/api/cursor";

const ALL = "soc_all_key";
const SCOPED = "soc_scoped_key";
const OTHER = { ...CLIENT, id: "c-calm", name: "Calm", company_slug: "calm", website_url: "https://calm.com", created_at: "2026-09-01T00:00:00.000Z", sprout_customer_id: null };

async function app(over: { analytics?: (id: string, start: string, end: string) => { ok: boolean; status: number; data: unknown } } = {}) {
  const store = makeFakeStore(emptyData({
    clients: [CLIENT, OTHER], sproutProfiles: [SPROUT_PROFILE], sets: [COMPETITOR_SET], competitors: [COMPETITOR], handles: [HANDLE],
    reports: [REPORT, { ...REPORT, id: "rep-calm", client_id: "c-calm", status: "running", created_at: "2026-09-20T00:00:00.000Z", report_data: {} }],
    competitiveReports: [COMPETITIVE_REPORT], posts: [POST, { ...POST, id: "post-2", is_approved: false, source: "ad_hoc", created_at: "2026-09-03T10:00:00.000Z" }, { ...POST, id: "post-old", archived_at: "2026-09-04T10:00:00.000Z" }],
    mediaJobs: [MEDIA_JOB], schedules: [SCHEDULE], scheduledPosts: [SCHEDULED_POST], alerts: [ALERT], designSystems: [DESIGN_SYSTEM],
  }));
  const analyticsCalls: Array<[string, string, string]> = [];
  const routes = readRoutes({
    store,
    analytics: async (id, start, end) => { analyticsCalls.push([id, start, end]); return over.analytics ? over.analytics(id, start, end) : { ok: true, status: 200, data: { client: { id, name: "Bader Law" }, range: { start, end, days: 30 }, profiles: [{ id: "123456", name: "Bader Law", network: "instagram" }], totals: { impressions: 10 }, by_profile: [{ profile_id: "123456", name: "Bader Law", impressions: 10 }], top_posts: [{ post_id: "sp-1", text: "t", profile_id: "123456", impressions: 5 }] } }; },
    health: async () => ({ tool: "socialytics", findings: [{ kind: "report_stuck", client_id: "c-calm", client: "Calm" }, { kind: "media_failed", client_id: "c-bader", client: "Bader Law" }, { kind: "api_schema_drift", client_id: null, client: "Socialytics API" }], demo_jobs: { running: 0, stuck: 0, failed_24h: 0 }, counts: {} }),
  });
  const all = await hashKey(ALL), scoped = await hashKey(SCOPED);
  const deps: CoreDeps = {
    tool: "socialytics", version: "1", routes,
    touchKey: async (h) => (h === all ? { id: "k-all", name: "all", key_prefix: "soc_all_key", scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 }
      : h === scoped ? { id: "k-sc", name: "sc", key_prefix: "soc_scoped_k", scopes: ["read"], company_slugs: ["bader-law"], client_ids: null, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 } : null),
    clientsForScope: async () => [{ id: "c-bader", company_slug: "bader-law" }, { id: "c-calm", company_slug: "calm" }],
    verifyAdminJwt: async () => null, cronSecret: null, serviceKey: null, audit: async () => {}, requestId: () => "r",
  };
  const get = async (path: string, key = ALL) => {
    const res = await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { headers: { Authorization: `Bearer ${key}` } }), deps);
    return { status: res.status, body: await res.json() };
  };
  return { get, analyticsCalls };
}
const ids = (r: { body: { data: Array<{ id: string }> } }) => r.body.data.map((x) => x.id);

describe("read routes", () => {
  it("lists clients newest first with pagination and summaries", async () => {
    const { get } = await app();
    const p1 = await get("/v1/clients?limit=1");
    expect(p1.status).toBe(200);
    expect(ids(p1)).toEqual(["c-calm"]);
    expect(decodeCursor(p1.body.next_cursor)).toEqual({ c: OTHER.created_at, i: "c-calm" });
    const p2 = await get(`/v1/clients?limit=1&cursor=${p1.body.next_cursor}`);
    expect(ids(p2)).toEqual(["c-bader"]);
    expect(p2.body.data[0]).toMatchObject({ counts: { reports: 1, competitive_reports: 1, posts: 2, schedules: 1 }, competitors: { selected: ["Morgan & Morgan"], tracked: true }, sprout: { profiles: 1 }, last_report: { id: "rep-1" } });
    expect(p2.body.data[0].competitor_sets).toBeUndefined();
    expect(p2.body.next_cursor).toBeNull();
  });
  it("scopes every read to the key's clients and answers 404 outside it", async () => {
    const { get } = await app();
    expect(ids(await get("/v1/clients", SCOPED))).toEqual(["c-bader"]);
    expect((await get("/v1/clients/c-calm", SCOPED)).status).toBe(404);
    expect((await get("/v1/reports/rep-calm", SCOPED)).status).toBe(404);
    expect((await get("/v1/reports/rep-calm")).status).toBe(200);
    expect((await get("/v1/reports?client_id=c-calm", SCOPED)).body.data).toEqual([]);
    expect(ids(await get("/v1/posts", SCOPED))).toEqual(["post-2", "post-1"]);
  });
  it("serves the client detail with profiles, sets and schedules, and its setup", async () => {
    const { get } = await app();
    const c = await get("/v1/clients/c-bader");
    expect(c.body.data.sprout_profiles).toEqual([{ name: "Bader Law", handle: "baderlaw", network: "instagram", url: "https://instagram.com/baderlaw" }]);
    expect(c.body.data.competitor_sets[0].competitors[0].handles[0].handle).toBe("forthepeople");
    expect(c.body.data.schedules[0].kind).toBe("social");
    expect(JSON.stringify(c.body)).not.toContain("123456");
    expect((await get("/v1/clients/c-bader/setup")).body.data).toEqual({ ready: true, issues: [] });
    const bare = (await get("/v1/clients/c-calm/setup")).body.data;
    expect(bare.ready).toBe(false);
    expect(bare.issues.map((i: { kind: string }) => i.kind)).toContain("sprout_missing");
  });
  it("serves analytics through the server path with a default 30-day window and maps its refusals", async () => {
    const { get, analyticsCalls } = await app();
    const a = await get("/v1/clients/c-bader/analytics?start=2026-09-01&end=2026-09-30");
    expect(a.status).toBe(200);
    expect(analyticsCalls[0]).toEqual(["c-bader", "2026-09-01", "2026-09-30"]);
    expect(a.body.data.profiles).toEqual([{ name: "Bader Law", network: "instagram" }]);
    expect(JSON.stringify(a.body)).not.toMatch(/123456|sp-1|profile_id/);
    const d = await get("/v1/clients/c-bader/analytics");
    expect(d.status).toBe(200);
    expect(analyticsCalls[1][1] < analyticsCalls[1][2]).toBe(true);
    expect((await get("/v1/clients/c-bader/analytics?start=1/2/2026")).status).toBe(400);
    const none = await (await app({ analytics: () => ({ ok: false, status: 422, data: { error: "No Sprout profiles are assigned to this client." } }) })).get("/v1/clients/c-calm/analytics");
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("unprocessable");
    expect(none.body.error.details).toEqual({ reason: "no_sprout_profiles" });
    const down = await (await app({ analytics: () => ({ ok: false, status: 500, data: { error: "Sprout token" } }) })).get("/v1/clients/c-bader/analytics");
    expect(down.status).toBe(502);
  });
  it("serves reports, competitive reports, sets, posts, media jobs, schedules, alerts and design systems", async () => {
    const { get } = await app();
    expect(ids(await get("/v1/reports?status=completed"))).toEqual(["rep-1"]);
    const r = await get("/v1/reports/rep-1");
    expect(r.body.data.analysis.competitive_takeaways).toEqual(["Post more Reels."]);
    expect(r.body.data.calendar[0].posts[0].copy).toBe("Know your rights after a crash.");
    expect((await get("/v1/reports?client_id=c-bader")).body.data[0].analysis).toBeUndefined();
    const cr = await get("/v1/competitive-reports/crep-1");
    expect(cr.body.data.analysis.executive_summary).toBe("Competitors post daily.");
    expect(JSON.stringify(cr.body)).not.toMatch(/L123|RC1|RC0/);
    expect((await get("/v1/competitor-sets?client_id=c-bader")).body.data[0].competitors[0].name).toBe("Morgan & Morgan");
    expect((await get("/v1/competitor-sets/set-1")).body.data.tracked).toBe(true);
    expect(ids(await get("/v1/posts?client_id=c-bader&approved=true"))).toEqual(["post-1"]);
    expect(ids(await get("/v1/posts?source=ad_hoc"))).toEqual(["post-2"]);
    expect(ids(await get("/v1/posts?include_archived=true"))).toHaveLength(3);
    expect((await get("/v1/posts?approved=maybe")).status).toBe(400);
    expect((await get("/v1/posts/post-1")).body.data.copy).toBe("Know your rights after a crash.");
    const mj = await get("/v1/media-jobs?client_id=c-bader");
    expect(mj.body.data[0].post_id).toBe("post-1");
    expect(JSON.stringify(mj.body)).not.toMatch(/req-secret|model_path/);
    expect((await get("/v1/schedules?client_id=c-bader")).body.data[0].run_day_of_month).toBe(7);
    expect((await get("/v1/scheduled-posts")).body.data[0].content).toBe("Know your rights.");
    expect((await get("/v1/alerts?status=new")).body.data[0].topic).toBe("Back to school safety");
    expect((await get("/v1/design-systems?client_id=c-bader")).body.data[0].templates[0].id).toBe("t-quote");
  });
  it("serves the full status to an unscoped key and only a company's own findings to a scoped one", async () => {
    const { get } = await app();
    expect((await get("/v1/status")).body.data.findings).toHaveLength(3);
    const scoped = (await get("/v1/status", SCOPED)).body.data;
    expect(scoped.findings.map((f: { kind: string }) => f.kind)).toEqual(["media_failed"]);
    expect(scoped.demo_jobs).toBeUndefined();
  });
  it("answers 404 for an unknown id and an empty list for an unknown client filter, never a server error", async () => {
    const { get } = await app();
    expect((await get("/v1/reports/not-a-uuid")).status).toBe(404);
    expect((await get("/v1/clients/nope")).status).toBe(404);
    const r = await get("/v1/reports?client_id=abc");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});
