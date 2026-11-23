import { describe, it, expect } from "vitest";
import { actionRoutes, type ActionClaim, type ActionRunRecord, type ActionRunStore } from "../../functions/_shared/api/actions";
import { handleRequest, type CoreDeps } from "../../functions/_shared/api/core";
import { hashKey } from "../../functions/_shared/api/keys";
import type { CallResult } from "../../functions/_shared/invoke";
import { CLIENT } from "../_shared/socialytics-api/fixtures";
import { emptyData, makeFakeStore } from "../_shared/socialytics-api/store.fake";
import { socialyticsActions, type CalendarPostRow } from "../../functions/_shared/socialytics-api/actions";

/**
 * The public actions through the API's own request path: key, run scope,
 * client reach, idempotency, and each adapter's call to the internal function
 * as the screens make it, acting for the key's owner.
 */
const RUN_KEY = "soc_run_key", SCOPED = "soc_scoped_key", READ_ONLY = "soc_read_key", NO_OWNER = "soc_orphan_key";
const OWNER = "00000000-0000-4000-8000-0000000000aa";

function memoryRuns(): ActionRunStore {
  const rows = new Map<string, ActionRunRecord>();
  const k = (c: ActionClaim) => `${c.owner}|${c.action}|${c.idempotency_key}`;
  return {
    async claim(c) { const e = rows.get(k(c)); if (e) return { claimed: false, existing: e }; rows.set(k(c), { status: "running", request_hash: c.request_hash, response_status: null, response: null }); return { claimed: true }; },
    async finish(c, res) { rows.set(k(c), { status: "done", request_hash: c.request_hash, response_status: res.status, response: res.body }); },
    async release(c) { rows.delete(k(c)); },
  };
}

const POST_ROW: CalendarPostRow = { client_id: "c-bader", post_key: "post:p-1", report_id: "rep-1", platform: "Instagram", format: "Image", pillar: "Know your rights", copy: "Hurt in a crash? Call first.", cta: "Call us", visual_direction: "Lawyer at desk", rationale: "Rights explainer" };

type Answer = { status: number; data?: unknown };

async function app(answers: Record<string, Answer> = {}) {
  const calls: Array<{ name: string; body: Record<string, unknown>; actAs: string }> = [];
  const store = makeFakeStore(emptyData({ clients: [CLIENT, { ...CLIENT, id: "c-other", name: "Other", company_slug: "other" }] }));
  const defs = socialyticsActions({
    store,
    call: async (name, body, actAs): Promise<CallResult> => {
      calls.push({ name, body: body as Record<string, unknown>, actAs });
      const a = answers[name] ?? { status: 200, data: {} };
      return { ok: a.status < 300, status: a.status, data: a.data ?? null, text: JSON.stringify(a.data ?? null) };
    },
    actingUser: async (auth) => (auth.keyId === "k-orphan" ? null : OWNER),
    calendarPost: async (clientId, key) => (clientId === POST_ROW.client_id && key === POST_ROW.post_key ? POST_ROW : null),
  });
  const routes = actionRoutes(defs, { runs: memoryRuns() });
  const [run, scoped, read, orphan] = await Promise.all([hashKey(RUN_KEY), hashKey(SCOPED), hashKey(READ_ONLY), hashKey(NO_OWNER)]);
  const row = (id: string, scopes: string[], client_ids: string[] | null) => ({ id, name: id, key_prefix: id, scopes, company_slugs: null, client_ids, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 });
  const deps: CoreDeps = {
    tool: "socialytics", version: "1", routes,
    touchKey: async (h) => (h === run ? row("k-run", ["run"], null) : h === scoped ? row("k-sc", ["run"], ["c-other"]) : h === read ? row("k-read", ["read"], null) : h === orphan ? row("k-orphan", ["run"], null) : null) as never,
    clientsForScope: async () => [], verifyAdminJwt: async () => null, cronSecret: null, serviceKey: null, audit: async () => {}, requestId: () => "r",
  };
  const post = async (path: string, body: unknown = {}, key = RUN_KEY) => {
    const res = await handleRequest(new Request(`https://x.supabase.co/functions/v1/api${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }), deps);
    return { status: res.status, body: await res.json(), replayed: res.headers.get("Idempotent-Replayed") };
  };
  return { post, calls, defs };
}

describe("starting reports", () => {
  it("queues a social report through run-report, acting for the key's owner", async () => {
    const { post, calls } = await app({ "run-report": { status: 200, data: { job_id: "j1", kind: "social", range: { start: "2026-10-01", end: "2026-10-30" }, requested_at: "2026-11-23T10:00:00Z", queued: true } } });
    const r = await post("/v1/clients/c-bader/reports", { start: "2026-10-01", end: "2026-10-30" });
    expect(r.status).toBe(202);
    expect(calls).toEqual([{ name: "run-report", body: { client_id: "c-bader", kind: "social", date_range_start: "2026-10-01", date_range_end: "2026-10-30" }, actAs: OWNER }]);
    expect(r.body.data).toMatchObject({ client_id: "c-bader", kind: "social", status: "queued", resumed: false, report_id: null, range: { start: "2026-10-01", end: "2026-10-30" }, links: { reports: "/v1/reports?client_id=c-bader", report: null } });
  });

  it("answers the competitive run already running, and says when it waits for tracking", async () => {
    const { post, calls } = await app({ "run-report": { status: 200, data: { report_id: "crep-9", kind: "competitive", created_at: "2026-11-23T09:00:00Z", range: { start: "2026-10-24", end: "2026-11-22" }, resumed: true, waiting_for: "tracking" } } });
    const r = await post("/v1/clients/c-bader/competitive-reports");
    expect(calls[0].body).toEqual({ client_id: "c-bader", kind: "competitive" });
    expect(r.body.data).toMatchObject({ kind: "competitive", status: "running", resumed: true, report_id: "crep-9", waiting_for: "tracking", links: { report: "/v1/competitive-reports/crep-9" } });
  });

  it("checks the period before anything is called", async () => {
    const { post, calls } = await app();
    expect((await post("/v1/clients/c-bader/reports", { start: "2026-10-01" })).status).toBe(400);
    expect((await post("/v1/clients/c-bader/reports", { start: "1 Oct", end: "2026-10-30" })).status).toBe(400);
    expect((await post("/v1/clients/c-bader/reports", { start: "2026-10-30", end: "2026-10-01" })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("passes a refusal through with the function's words", async () => {
    const { post } = await app({ "run-report": { status: 422, data: { error: "Bader Law has no confirmed competitors yet." } } });
    const r = await post("/v1/clients/c-bader/competitive-reports");
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "unprocessable", message: "Bader Law has no confirmed competitors yet." });
  });

  it("answers an upstream failure without its internals", async () => {
    const { post } = await app({ "run-report": { status: 500, data: { error: "relation scheduled_jobs does not exist" } } });
    const r = await post("/v1/clients/c-bader/reports");
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("scheduled_jobs");
  });
});

describe("the action routes", () => {
  it("need the run scope and a client within the key's reach", async () => {
    const { post, calls } = await app();
    expect((await post("/v1/clients/c-bader/reports", {}, READ_ONLY)).status).toBe(403);
    expect((await post("/v1/clients/c-bader/reports", {}, SCOPED)).status).toBe(404);
    expect((await post("/v1/clients/c-missing/reports")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("refuse a key with no Socialytics user to act for", async () => {
    const { post, calls } = await app();
    const r = await post("/v1/clients/c-bader/reports", {}, NO_OWNER);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/no Socialytics user to act for/);
    expect(calls).toEqual([]);
  });

  it("start paid work once per idempotency key, and refuse the key for another request", async () => {
    const { post, calls } = await app({ "generate-ad-hoc-post": { status: 200, data: { post: { platform: "Instagram", format: "Image", caption_angle: "Know your rights.", CTA: "Call us", hashtags: ["#law"] } } } });
    const body = { platform: "Instagram", topic: "Rights after a crash", idempotency_key: "agentburst-1" };
    const a = await post("/v1/clients/c-bader/post-drafts", body);
    const b = await post("/v1/clients/c-bader/post-drafts", body);
    expect(a.status).toBe(200);
    expect(b).toEqual({ ...a, replayed: "true" });
    expect(calls.map((c) => c.name)).toEqual(["generate-ad-hoc-post"]);
    expect((await post("/v1/clients/c-bader/post-drafts", { ...body, topic: "Another" })).status).toBe(409);
  });
});

describe("posts and the calendar", () => {
  it("drafts a post from a topic and saves nothing", async () => {
    const { post, calls } = await app({ "generate-ad-hoc-post": { status: 200, data: { post: { platform: "Instagram", format: "Story", pillar: "Know your rights", hook: "Hurt?", concept: "c", visual_direction: "v", caption_angle: "Call first.", CTA: "Call us", hashtags: [] } } } });
    const r = await post("/v1/clients/c-bader/post-drafts", { platform: "Instagram", topic: "Rights", format: "Story" });
    expect(calls[0].body).toEqual({ client_id: "c-bader", platform: "Instagram", topic: "Rights", creative_type: "Story" });
    expect(r.body.data).toEqual({ client_id: "c-bader", saved: false, post: { platform: "Instagram", format: "Story", pillar: "Know your rights", hook: "Hurt?", concept: "c", visual_direction: "v", copy: "Call first.", cta: "Call us", hashtags: [] } });
    expect((await post("/v1/clients/c-bader/post-drafts", { platform: "Instagram" })).status).toBe(400);
  });

  it("writes a calendar post's copy again from the post itself, with the note", async () => {
    const { post, calls } = await app({ "regenerate-post-copy": { status: 200, data: { post: { caption_angle: "New copy.", CTA: "Book a call", hashtags: ["#injury"] } } } });
    const r = await post("/v1/clients/c-bader/copy-drafts", { post_key: "post:p-1", note: "Shorter" });
    expect(calls[0].body).toEqual({ client_id: "c-bader", platform: "Instagram", concept: "Rights explainer", pillar: "Know your rights", current_copy: "Hurt in a crash? Call first.", current_cta: "Call us", format: "Image", note: "Shorter" });
    expect(r.body.data).toEqual({ client_id: "c-bader", post_key: "post:p-1", saved: false, copy: "New copy.", cta: "Book a call", hashtags: ["#injury"] });
    expect((await post("/v1/clients/c-bader/copy-drafts", { post_key: "post:nope" })).status).toBe(404);
    expect((await post("/v1/clients/c-bader/copy-drafts", {})).status).toBe(400);
  });

  it("starts a calendar post's designs, and says when the client's designs are not set up", async () => {
    const { post, calls } = await app({ "design-request": { status: 200, data: { request: { id: "dr-1", status: "preparing", created_at: "2026-11-23T10:00:00Z", calendar_post_key: "post:p-1" } } } });
    const r = await post("/v1/clients/c-bader/post-designs", { post_key: "post:p-1" });
    expect(r.status).toBe(202);
    expect(calls[0].body).toEqual({ action: "create", client_id: "c-bader", report_id: "rep-1", calendar_post_key: "post:p-1", platform: "Instagram", format: "Image", post_copy: "Hurt in a crash? Call first.", visual_direction: "Lawyer at desk" });
    expect(r.body.data).toEqual({ client_id: "c-bader", post_key: "post:p-1", status: "preparing", filmed_by: null, design: { id: "dr-1", status: "preparing", created_at: "2026-11-23T10:00:00Z" } });

    const notSet = await app({ "design-request": { status: 200, data: { code: "not_set_up" } } });
    const n = await notSet.post("/v1/clients/c-bader/post-designs", { post_key: "post:p-1" });
    expect(n.status).toBe(422);
    expect(n.body.error.message).toMatch(/not set up/);
  });

  it("plans a calendar week, only a Monday when one is named", async () => {
    const { post, calls } = await app({ "calendar-posts": { status: 202, data: { plan: { id: "pl-1", week_start: "2026-11-30", status: "queued", evidence: {} }, week: "2026-11-30" } } });
    expect((await post("/v1/clients/c-bader/calendar-weeks", { week: "2026-12-01" })).status).toBe(400);
    const r = await post("/v1/clients/c-bader/calendar-weeks", { week: "2026-11-30" });
    expect(r.status).toBe(202);
    expect(calls).toEqual([{ name: "calendar-posts", body: { action: "plan_next_week", client_id: "c-bader", week: "2026-11-30" }, actAs: OWNER }]);
    expect(r.body.data).toEqual({ client_id: "c-bader", week: "2026-11-30", plan: { id: "pl-1", week_start: "2026-11-30", status: "queued" } });
  });
});

describe("competitors", () => {
  it("proposes a draft set, naming no internal identifier", async () => {
    const { post } = await app({ "identify-competitors": { status: 200, data: { set_id: "set-9", competitors: [{ id: "k1", name: "Morgan", website_url: "https://m.com", rationale: "r", similarity_score: 0.9, rivaliq_company_id: "RC" }], rejected: [{ name: "X", website_url: "x", reason: "dead" }] } } });
    const r = await post("/v1/clients/c-bader/competitor-proposals");
    expect(r.body.data).toEqual({ client_id: "c-bader", set_id: "set-9", status: "draft", competitors: [{ id: "k1", name: "Morgan", website: "https://m.com", rationale: "r", similarity_score: 0.9 }], rejected: 1, links: { set: "/v1/competitor-sets/set-9" } });
  });

  it("refreshes the competitor feed over a window of 1 to 30 days", async () => {
    const { post, calls } = await app({ "refresh-competitor-feed": { status: 200, data: { client_id: "c-bader", landscape_id: "L1", window: { start: "2026-11-17", end: "2026-11-23" }, posts: 40, alerts: 2, linkedin_not_collected: true } } });
    expect((await post("/v1/clients/c-bader/competitor-feed", { days: 90 })).status).toBe(400);
    const r = await post("/v1/clients/c-bader/competitor-feed", { days: 7 });
    expect(calls[0].body).toEqual({ client_id: "c-bader", days: 7 });
    expect(r.body.data).toEqual({ client_id: "c-bader", window: { start: "2026-11-17", end: "2026-11-23" }, posts: 40, alerts: 2, linkedin_pending: true, topics_pending: false, links: { alerts: "/v1/alerts?client_id=c-bader" } });
  });
});
