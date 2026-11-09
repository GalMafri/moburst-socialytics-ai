// @vitest-environment node
// The competitor feed refresh under the LinkedIn source's engine switch. With
// the switch on n8n (set by hand) the refresh calls the n8n LinkedIn workflow
// exactly as before and saves the same snapshot; with shadow for this client
// it does all of that too, and queues an in-app run that keeps what n8n
// answered. Anything else is app: the in-app pipeline, and when its
// collection stops or cannot run, the feed is saved with the RivalIQ posts
// and no LinkedIn posts, the refresh says so, and the feed job tries again in
// 10 minutes; n8n is never called. A person's refresh does not fail, and
// queues that same feed job. RivalIQ, the LinkedIn workflow, Apify and Sprout
// are stand-ins here: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const SOURCES = [{ company_id: "2", name: "Peer", profile_url: "https://www.linkedin.com/company/peer" }];
const LINKEDIN_ANSWER = { socialPosts: [{ companyId: "2", companyName: "Peer", message: "Hiring", postLink: "https://www.linkedin.com/posts/peer-1", publishedAt: "2026-11-03" }], additional_metrics: { "2": { coverage: "complete" } } };
const collect = vi.fn(async () => LINKEDIN_ANSWER);

vi.mock("../../../functions/_shared/competitive/landscapeCheck", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/competitive/landscapeCheck")>()),
  checkClientLandscape: vi.fn(async () => ({ ok: true, linked: true, summary: { id: "ls-1", client_company_id: "1", companies: [{ id: 1, name: "Moburst" }, { id: 2, name: "Peer" }] } })),
  recordTrackingCheck: vi.fn(async () => {}),
}));
vi.mock("../../../functions/_shared/competitive/rivaliqFetch", () => ({
  rivalIqFetch: vi.fn(async () => new Response(JSON.stringify({ socialPosts: [{ companyId: "2", companyName: "Peer", message: "Fall promo", postLink: "https://instagram.com/p/1", publishedAt: "2026-11-02" }] }))),
}));
vi.mock("../../../functions/_shared/competitive/linkedinSource", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/competitive/linkedinSource")>()),
  selectedFeedSources: vi.fn(() => ({ sources: SOURCES, companyIds: ["1", "2"] })),
  collectLinkedInSource: (...args: unknown[]) => collect(...(args as [])),
}));
vi.mock("../../../functions/_shared/competitive/ownedSource", () => ({
  collectOwnedCompetitive: vi.fn(async () => ({ profiles: [], coverage: {}, metrics: {} })),
  mergeOwnedCompetitivePosts: vi.fn((posts: unknown[]) => posts),
}));

const { refreshCompetitorFeed, refreshCompetitorFeedOnDemand } = await import("../../../functions/_shared/competitive/refreshFeed");
const { checkClientLandscape } = await import("../../../functions/_shared/competitive/landscapeCheck");
const { runFeedJob, FEED_RETRY_MINUTES, LINKEDIN_NOT_COLLECTED } = await import("../../../functions/run-scheduled-jobs/feed");
import type { ScheduledJob } from "../../../functions/_shared/scheduled-jobs/types";

const MOBURST = "d00ce604-2bcc-455a-9826-f80250db75cf";
const DEFAULTS = [
  { kind: "social", client_id: null, engine: "n8n" },
  { kind: "competitive", client_id: null, engine: "n8n" },
  { kind: "linkedin_source", client_id: null, engine: "n8n" },
];

function admin(engines: Array<Record<string, unknown>> | null) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    clients: [{ id: MOBURST, name: "Moburst", website_url: "https://moburst.com", harvested_design_references: [] }],
    competitor_sets: [{ id: "set-1", client_id: MOBURST, status: "complete", rivaliq_landscape_id: "ls-1", confirmed_at: "2026-10-01T00:00:00Z" }],
    competitors: [],
    app_settings: [{ key: "competitive_linkedin_webhook_url", value: "https://moburst.app.n8n.cloud/webhook/socialytics-linkedin-source" }],
    rivaliq_snapshots: [],
    competitive_alerts: [],
  };
  if (engines) tables.report_engines = engines;
  return fakeDb(tables, { report_pipeline_start: (args) => ({ run_id: "run-1", started: true, args }) });
}

/** The snapshot as saved, without the times it was fetched and stored. */
const snapshot = (db: ReturnType<typeof admin>) => {
  const { created_at: _c, ...row } = db.tables.rivaliq_snapshots[0] as { created_at?: string; payload: Record<string, unknown> };
  const { fetched_at: _f, ...rest } = row.payload;
  return { ...row, payload: rest };
};

const ENV = { rivaliqKey: "rq", anthropicKey: undefined, secret: "fixture-secret" };
/** The in-app LinkedIn run with no pause between its looks at Apify. */
const NO_PAUSE = { ...ENV, linkedinInline: { sleep: async () => {} } };
const APP = [...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "app" }];
const withToken = () => vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "APIFY_API_TOKEN" ? "apify-token" : undefined) } });

/** Apify: refuses the start while down; otherwise one run that succeeds with one post on the reviewed page. */
function apify(state: { up: boolean }) {
  const day = new Date(Date.now() - 2 * 86400000).toISOString();
  const row = { type: "post", id: "p1", query: { targetUrl: SOURCES[0].profile_url }, author: { type: "company", linkedinUrl: SOURCES[0].profile_url }, postedAt: { date: day }, linkedinUrl: "https://www.linkedin.com/posts/peer-p1", content: "Launch #news", engagement: { likes: 3, comments: 1, shares: 0 } };
  const f = vi.fn(async (url: string) => {
    if (url.includes("/acts/")) return state.up ? new Response(JSON.stringify({ data: { id: "r1", status: "RUNNING", defaultDatasetId: "d1" } })) : new Response(JSON.stringify({ error: { message: "invalid input" } }), { status: 400 });
    if (url.includes("/actor-runs/")) return new Response(JSON.stringify({ data: { id: "r1", status: "SUCCEEDED", defaultDatasetId: "d1" } }));
    if (url.includes("/datasets/d1/items")) return new Response(JSON.stringify([row]));
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const T = new Date("2026-11-08T07:00:00Z");
const feedJob = (attempts: number): ScheduledJob => ({
  id: "feed-1", kind: "feed_refresh", client_id: MOBURST, schedule_id: null, occurrence: null, priority: 10, stagger_seconds: 0,
  status: "running", phase: null, report_id: null, attempts, max_attempts: 3, available_at: T.toISOString(), lease_until: null,
  reason: null, result: null, created_at: T.toISOString(), started_at: T.toISOString(), finished_at: null,
});
const postLinks = (db: ReturnType<typeof admin>, i: number) => (db.tables.rivaliq_snapshots[i].payload as { socialPosts: Array<{ postLink?: string; postId?: string }> }).socialPosts.map((p) => p.postId ?? p.postLink);

/** The refresh logs why LinkedIn was not collected; the tests read it here instead of the console. */
let warn: MockInstance<typeof console.warn>;
const warned = () => warn.mock.calls.map((c) => c.join(" ")).join("\n");
beforeEach(() => {
  collect.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

describe("refreshCompetitorFeed and the LinkedIn source switch", () => {
  it("on n8n, calls the n8n workflow as before and queues nothing", async () => {
    const db = admin(DEFAULTS);
    const result = await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(result).not.toHaveProperty("linkedin_not_collected");
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect.mock.calls[0]).toEqual([SOURCES, expect.objectContaining({ start: expect.any(String), end: expect.any(String) }), "fixture-secret", "https://moburst.app.n8n.cloud/webhook/socialytics-linkedin-source"]);
    expect(db.rpcCalls).toEqual([]);
    expect(db.uploads.size).toBe(0);
    const saved = db.tables.rivaliq_snapshots[0].payload as { socialPosts: Array<{ postLink: string }> };
    expect(saved.socialPosts.map((p) => p.postLink)).toEqual(["https://instagram.com/p/1", "https://www.linkedin.com/posts/peer-1"]);
  });

  it("on n8n, a LinkedIn workflow that fails still fails the refresh, as before, and saves nothing", async () => {
    collect.mockImplementationOnce(async () => { throw new Error("LinkedIn source workflow failed [500]"); });
    const db = admin(DEFAULTS);
    await expect(refreshCompetitorFeed(db, MOBURST, ENV)).rejects.toThrow("LinkedIn source workflow failed");
    expect(db.tables.rivaliq_snapshots).toEqual([]);
  });

  it("on shadow for this client, also queues an in-app run that keeps what n8n answered", async () => {
    const n8nOnly = admin(DEFAULTS);
    await refreshCompetitorFeed(n8nOnly, MOBURST, ENV);
    collect.mockClear();

    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "shadow" }]);
    await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(snapshot(db)).toEqual(snapshot(n8nOnly));
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["report_pipeline_start"]);
    // The in-app LinkedIn source pipeline, chosen while APIFY_API_TOKEN is not set yet: its step waits for the token quietly.
    expect(db.rpcCalls[0].args).toMatchObject({ p_kind: "linkedin_source", p_mode: "shadow", p_pipeline: "linkedin_source_v1", p_app_capable: true, p_client: MOBURST, p_real_table: "rivaliq_snapshots", p_input: { sources: SOURCES } });
    const kept = db.uploads.get("pipeline-payloads/runs/run-1/real.output.json") as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(kept))).toEqual(LINKEDIN_ANSWER);
  });

  it("on app for this client, the in-app pipeline answers the feed in the refresh and n8n is not called", async () => {
    // The function's environment has the Apify token; Apify answers with one post on the reviewed page.
    vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "APIFY_API_TOKEN" ? "apify-token" : undefined) } });
    const day = new Date(Date.now() - 2 * 86400000).toISOString();
    const row = { type: "post", id: "p1", query: { targetUrl: SOURCES[0].profile_url }, author: { type: "company", linkedinUrl: SOURCES[0].profile_url }, postedAt: { date: day }, linkedinUrl: "https://www.linkedin.com/posts/peer-p1", content: "Launch #news", engagement: { likes: 3, comments: 1, shares: 0 } };
    const apify = vi.fn(async (url: string) => {
      if (url.includes("/acts/")) return new Response(JSON.stringify({ data: { id: "r1", status: "RUNNING", defaultDatasetId: "d1" } }));
      if (url.includes("/actor-runs/")) return new Response(JSON.stringify({ data: { id: "r1", status: "SUCCEEDED", defaultDatasetId: "d1" } }));
      if (url.includes("/datasets/d1/items")) return new Response(JSON.stringify([row]));
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", apify);
    // The database allows app only after a finished shadow run; this stands for that state.
    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "app" }]);
    const result = await refreshCompetitorFeed(db, MOBURST, NO_PAUSE);
    expect(result).not.toHaveProperty("linkedin_not_collected");
    expect(warn).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
    expect(apify.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual(["/v2/acts/WI0tj4Ieb5Kq458gB/runs", "/v2/actor-runs/r1", "/v2/datasets/d1/items"]);
    const saved = db.tables.rivaliq_snapshots[0].payload as { socialPosts: Array<{ postId: string }>; additional_metrics: Record<string, { coverage: string }> };
    expect(saved.socialPosts.map((p) => p.postId)).toContain("linkedin:2:p1");
    expect(saved.additional_metrics["2"]).toMatchObject({ coverage: "complete", period: result.window });
    expect(db.tables.report_pipeline_runs[0]).toMatchObject({ kind: "linkedin_source", mode: "app", status: "done" });
    expect(db.rpcCalls).toEqual([]);
  });

  it("on app while the Apify token is not set, or with no switch table, saves the feed with the RivalIQ posts and no LinkedIn posts, and n8n is not called", async () => {
    for (const engines of [[...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "app" }], null]) {
      collect.mockClear();
      const db = admin(engines);
      const result = await refreshCompetitorFeed(db, MOBURST, ENV);
      expect(collect).not.toHaveBeenCalled();
      expect(db.tables.report_pipeline_runs ?? []).toEqual([]);
      const saved = db.tables.rivaliq_snapshots[0].payload as { socialPosts: Array<{ postLink: string }>; additional_metrics: Record<string, unknown> };
      expect(saved.socialPosts.map((p) => p.postLink)).toEqual(["https://instagram.com/p/1"]);
      expect(saved.additional_metrics).toEqual({});
      expect(result.posts).toBe(1);
      expect(result.linkedin_not_collected).toBe(true);
      expect(warned()).toContain("No app-capable linkedin_source pipeline");
      warn.mockClear();
    }
  });

  it("on app, a LinkedIn collection that stops saves the feed with the RivalIQ posts, and n8n is not called", async () => {
    vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "APIFY_API_TOKEN" ? "apify-token" : undefined) } });
    // Apify refuses the start: the in-app run stops at once.
    const apify = vi.fn(async (url: string) => {
      if (url.includes("/acts/")) return new Response(JSON.stringify({ error: { message: "invalid input" } }), { status: 400 });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", apify);
    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "app" }]);
    // A person's refresh does not fail: it answers with the feed it saved.
    const result = await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(result.linkedin_not_collected).toBe(true);
    expect(warned()).toContain("run stopped");
    expect(collect).not.toHaveBeenCalled();
    expect(db.tables.report_pipeline_runs[0]).toMatchObject({ kind: "linkedin_source", mode: "app", status: "stopped" });
    expect(db.tables.rivaliq_snapshots).toHaveLength(1);
    const saved = db.tables.rivaliq_snapshots[0].payload as { socialPosts: Array<{ postLink: string }>; additional_metrics: Record<string, unknown> };
    expect(saved.socialPosts.map((p) => p.postLink)).toEqual(["https://instagram.com/p/1"]);
    expect(saved.additional_metrics).toEqual({});
  });

  it("on app, a LinkedIn collection that throws for any other reason saves the feed with the RivalIQ posts", async () => {
    vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "APIFY_API_TOKEN" ? "apify-token" : undefined) } });
    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "app" }]);
    // The run's row cannot be made.
    const from = db.from.bind(db);
    db.from = (t: string) => {
      if (t !== "report_pipeline_runs") return from(t);
      const q = from(t);
      q.insert = () => { throw new Error("report_pipeline_runs is read-only"); };
      return q;
    };
    const result = await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(result.linkedin_not_collected).toBe(true);
    expect(warned()).toContain("read-only");
    expect(collect).not.toHaveBeenCalled();
    const saved = db.tables.rivaliq_snapshots[0].payload as { socialPosts: Array<{ postLink: string }> };
    expect(saved.socialPosts.map((p) => p.postLink)).toEqual(["https://instagram.com/p/1"]);
  });

  it("the feed job: a stopped LinkedIn run on app saves the RivalIQ posts and is queued 10 minutes later; the retry that gets the LinkedIn posts saves them", async () => {
    withToken();
    const state = { up: false };
    const f = apify(state);
    const db = admin(APP);
    const refreshFeed = (clientId: string) => refreshCompetitorFeed(db, clientId, NO_PAUSE);
    const first = await runFeedJob(feedJob(1), { now: () => T, refreshFeed });
    expect(first).toMatchObject({ status: "queued", reason: LINKEDIN_NOT_COLLECTED, available_at: new Date(T.getTime() + FEED_RETRY_MINUTES * 60_000).toISOString() });
    expect(postLinks(db, 0)).toEqual(["https://instagram.com/p/1"]);
    state.up = true;
    const retry = await runFeedJob(feedJob(2), { now: () => T, refreshFeed });
    expect(retry.status).toBe("done");
    expect(db.tables.rivaliq_snapshots).toHaveLength(2);
    expect(postLinks(db, 1)).toEqual(expect.arrayContaining(["https://instagram.com/p/1", "linkedin:2:p1"]));
    expect(db.tables.report_pipeline_runs.map((r) => r.status)).toEqual(["stopped", "done"]);
    expect(f.mock.calls.filter((c) => String(c[0]).includes("/acts/"))).toHaveLength(2);
    expect(collect).not.toHaveBeenCalled();
  });

  it("the feed job: an unreadable switch saves the RivalIQ posts and queues a retry, never n8n", async () => {
    withToken();
    const db = admin(APP);
    const from = db.from.bind(db);
    db.from = (t: string) => { if (t === "report_engines") throw new Error("relation does not exist"); return from(t); };
    const outcome = await runFeedJob(feedJob(1), { now: () => T, refreshFeed: (id) => refreshCompetitorFeed(db, id, ENV) });
    expect(outcome.status).toBe("queued");
    expect((outcome.result as { linkedin_not_collected: boolean }).linkedin_not_collected).toBe(true);
    expect(warned()).toContain("could not be read");
    expect(postLinks(db, 0)).toEqual(["https://instagram.com/p/1"]);
    expect(collect).not.toHaveBeenCalled();
  });

  it("the feed job: the last attempt ends failed with the feed already saved with the RivalIQ posts", async () => {
    withToken();
    apify({ up: false });
    const db = admin(APP);
    const outcome = await runFeedJob(feedJob(3), { now: () => T, refreshFeed: (id) => refreshCompetitorFeed(db, id, ENV) });
    expect(outcome).toMatchObject({ status: "failed", reason: LINKEDIN_NOT_COLLECTED });
    expect(db.tables.rivaliq_snapshots).toHaveLength(1);
    expect(postLinks(db, 0)).toEqual(["https://instagram.com/p/1"]);
    expect(collect).not.toHaveBeenCalled();
  });

  it("a person's refresh that misses LinkedIn on app answers with the saved feed and queues one feed refresh 10 minutes out, never a second", async () => {
    withToken();
    const state = { up: false };
    apify(state);
    const db = admin(APP);
    db.tables.scheduled_jobs = [];
    const before = Date.now();
    const answer = await refreshCompetitorFeedOnDemand(db, MOBURST, NO_PAUSE);
    expect(answer).toMatchObject({ posts: 1, linkedin_not_collected: true });
    expect(JSON.stringify(answer)).not.toMatch(/Apify|linkedin_source|pipeline/);
    expect(postLinks(db, 0)).toEqual(["https://instagram.com/p/1"]);
    expect(db.tables.scheduled_jobs).toHaveLength(1);
    const queued = db.tables.scheduled_jobs[0] as { kind: string; client_id: string; priority: number; available_at: string; max_attempts?: number };
    expect(queued).toMatchObject({ kind: "feed_refresh", client_id: MOBURST, priority: 10 });
    expect(queued.max_attempts).toBeUndefined();
    const wait = Date.parse(queued.available_at) - before;
    expect(wait).toBeGreaterThanOrEqual(FEED_RETRY_MINUTES * 60_000);
    expect(wait).toBeLessThan(FEED_RETRY_MINUTES * 60_000 + 60_000);
    // A second click while it is queued adds no second job.
    queued.status = "queued";
    await refreshCompetitorFeedOnDemand(db, MOBURST, NO_PAUSE);
    expect(db.tables.scheduled_jobs).toHaveLength(1);
    // The queued job is the feed job: it collects LinkedIn when Apify answers.
    state.up = true;
    const outcome = await runFeedJob({ ...feedJob(1), id: "retry" }, { now: () => T, refreshFeed: (id) => refreshCompetitorFeed(db, id, NO_PAUSE) });
    expect(outcome.status).toBe("done");
    expect(postLinks(db, db.tables.rivaliq_snapshots.length - 1)).toEqual(expect.arrayContaining(["https://instagram.com/p/1", "linkedin:2:p1"]));
    expect(collect).not.toHaveBeenCalled();
  });

  it("a person's refresh that collects LinkedIn, or runs on n8n, queues nothing", async () => {
    withToken();
    apify({ up: true });
    const app = admin(APP);
    app.tables.scheduled_jobs = [];
    expect(await refreshCompetitorFeedOnDemand(app, MOBURST, NO_PAUSE)).not.toHaveProperty("linkedin_not_collected");
    expect(app.tables.scheduled_jobs).toEqual([]);
    const n8n = admin(DEFAULTS);
    n8n.tables.scheduled_jobs = [];
    await refreshCompetitorFeedOnDemand(n8n, MOBURST, NO_PAUSE);
    expect(n8n.tables.scheduled_jobs).toEqual([]);
  });

  it("asks the landscape check by name only for a client whose website is a page on another client's site", async () => {
    const check = vi.mocked(checkClientLandscape);
    check.mockClear();
    const db = admin(DEFAULTS);
    db.tables.clients.push({ id: "kit", name: "Kitcaster by Moburst", website_url: "https://www.moburst.com/services/organic/podcast-booking/", archived_at: null, demo_job_id: null });
    check.mockImplementationOnce(async () => ({ ok: false, code: "RIVALIQ_CLIENT_NOT_TRACKED", landscapeId: null, message: "No RivalIQ landscape tracks Kitcaster by Moburst." }) as never);
    await expect(refreshCompetitorFeed(db, "kit", ENV)).rejects.toMatchObject({ status: 422 });
    expect(check.mock.calls[0].slice(0, 2)).toEqual(["rq", { name: "Kitcaster by Moburst", website_url: null }]);
    // A plain-domain client is asked with its website, as before.
    await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(check.mock.calls[1].slice(0, 2)).toEqual(["rq", { name: "Moburst", website_url: "https://moburst.com" }]);
  });

  it("queues nothing for another client while Moburst is on shadow", async () => {
    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: "11111111-1111-1111-1111-111111111111", engine: "shadow" }]);
    await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(db.rpcCalls).toEqual([]);
  });
});
