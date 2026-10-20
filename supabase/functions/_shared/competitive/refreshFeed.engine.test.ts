// @vitest-environment node
// The competitor feed refresh under the LinkedIn source's engine switch. With
// the switch on n8n (or no switch table at all) the refresh calls the n8n
// LinkedIn workflow exactly as before and saves the same snapshot; with
// shadow for this client it does all of that too, and queues an in-app run
// that keeps what n8n answered. RivalIQ, the LinkedIn workflow and Sprout
// are stand-ins here: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../lifecycle/fakeDb";

const SOURCES = [{ company_id: "2", name: "Peer", profile_url: "https://www.linkedin.com/company/peer" }];
const LINKEDIN_ANSWER = { socialPosts: [{ companyId: "2", companyName: "Peer", message: "Hiring", postLink: "https://www.linkedin.com/posts/peer-1", publishedAt: "2026-11-03" }], additional_metrics: { "2": { coverage: "complete" } } };
const collect = vi.fn(async () => LINKEDIN_ANSWER);

vi.mock("./landscapeCheck", async (original) => ({
  ...(await original<typeof import("./landscapeCheck")>()),
  checkClientLandscape: vi.fn(async () => ({ ok: true, linked: true, summary: { id: "ls-1", client_company_id: "1", companies: [{ id: 1, name: "Moburst" }, { id: 2, name: "Peer" }] } })),
  recordTrackingCheck: vi.fn(async () => {}),
}));
vi.mock("./rivaliqFetch", () => ({
  rivalIqFetch: vi.fn(async () => new Response(JSON.stringify({ socialPosts: [{ companyId: "2", companyName: "Peer", message: "Fall promo", postLink: "https://instagram.com/p/1", publishedAt: "2026-11-02" }] }))),
}));
vi.mock("./linkedinSource", async (original) => ({
  ...(await original<typeof import("./linkedinSource")>()),
  selectedFeedSources: vi.fn(() => ({ sources: SOURCES, companyIds: ["1", "2"] })),
  collectLinkedInSource: (...args: unknown[]) => collect(...(args as [])),
}));
vi.mock("./ownedSource", () => ({
  collectOwnedCompetitive: vi.fn(async () => ({ profiles: [], coverage: {}, metrics: {} })),
  mergeOwnedCompetitivePosts: vi.fn((posts: unknown[]) => posts),
}));

const { refreshCompetitorFeed } = await import("./refreshFeed");

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

beforeEach(() => collect.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("refreshCompetitorFeed and the LinkedIn source switch", () => {
  it("on n8n, or with no switch table, calls the n8n workflow as before and queues nothing", async () => {
    const results = [];
    for (const engines of [DEFAULTS, null]) {
      collect.mockClear();
      const db = admin(engines);
      await refreshCompetitorFeed(db, MOBURST, ENV);
      expect(collect).toHaveBeenCalledTimes(1);
      expect(collect.mock.calls[0]).toEqual([SOURCES, expect.objectContaining({ start: expect.any(String), end: expect.any(String) }), "fixture-secret", "https://moburst.app.n8n.cloud/webhook/socialytics-linkedin-source"]);
      expect(db.rpcCalls).toEqual([]);
      expect(db.uploads.size).toBe(0);
      results.push(snapshot(db));
    }
    expect(results[1]).toEqual(results[0]);
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
    const result = await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(collect).not.toHaveBeenCalled();
    expect(apify.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual(["/v2/acts/WI0tj4Ieb5Kq458gB/runs", "/v2/actor-runs/r1", "/v2/datasets/d1/items"]);
    const saved = db.tables.rivaliq_snapshots[0].payload as { socialPosts: Array<{ postId: string }>; additional_metrics: Record<string, { coverage: string }> };
    expect(saved.socialPosts.map((p) => p.postId)).toContain("linkedin:2:p1");
    expect(saved.additional_metrics["2"]).toMatchObject({ coverage: "complete", period: result.window });
    expect(db.tables.report_pipeline_runs[0]).toMatchObject({ kind: "linkedin_source", mode: "app", status: "done" });
    expect(db.rpcCalls).toEqual([]);
  });

  it("on app while the Apify token is not set, n8n answers the feed as before", async () => {
    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: MOBURST, engine: "app" }]);
    await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(db.tables.report_pipeline_runs ?? []).toEqual([]);
  });

  it("queues nothing for another client while Moburst is on shadow", async () => {
    const db = admin([...DEFAULTS, { kind: "linkedin_source", client_id: "11111111-1111-1111-1111-111111111111", engine: "shadow" }]);
    await refreshCompetitorFeed(db, MOBURST, ENV);
    expect(db.rpcCalls).toEqual([]);
  });
});
