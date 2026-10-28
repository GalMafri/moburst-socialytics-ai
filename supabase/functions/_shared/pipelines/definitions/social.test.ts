// @vitest-environment node
// The in-app social pipeline end to end, through the real step runner and
// stores. The providers are stand-ins that answer with what they answered
// n8n for Moburst's September 2026 report fd501cba (execution 574962, 16 Oct
// 2026): the four Sprout reads, the brief analysis, the synthesis and Gamma's
// deck; the trend scrapers answer with the datasets of execution 583953. So
// the report must come out as the app stored fd501cba, as a screen shows it,
// and every write must land where its mode allows.
//
// The September replay is proved here: a live shadow run keeps every answer
// it read; a replay of fd501cba from those answers (no provider called) gives
// the same report, figure for figure.
import { describe, expect, it } from "vitest";
import type { ApifyClient } from "../../apify/client";
import { apidojoSearchFor, MOBURST, moburstPages, moburstRequest, TRENDS } from "../fixtures/social";
import { makeRegistry } from "../registry";
import { startReportPipeline } from "../shadow";
import { makePayloadStore } from "../store";
import { drivePipeline, pipelineDb, testClock } from "../testDriver";
import { compareSocial, compareSocialRun, startSocialReplay, startSocialShadow } from "../social/harness";
import { sproutRequests, type GammaClient, type SproutReader } from "../social/providers";
import { KEPT } from "../social/replay";
import { socialFigures } from "../../reports/reportText";
import { synthesisSystem } from "../social/prompt";
import { socialPipeline, TREND_ACTORS, type SocialDeps } from "./social";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPORT = MOBURST.stored_report;
/** The figures a screen shows for the stored report, by key (reportText.ts socialFigures). */
const SHOWN_FIGURES = new Set(socialFigures(REPORT.report_data).map((f) => f.key)).size;
const CLIENT = REPORT.client_id;
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", SPROUT_CLIENT_ID: "si", SPROUT_CLIENT_SECRET: "ss", GAMMA_API_KEY: "gk", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];

/** Sprout as it answered n8n: each read's pages, by period and kind. */
function sprout(calls: string[]): SocialDeps["sprout"] {
  const pages = moburstPages();
  return () => ({
    async pages(path, body) {
      const filter = String((body.filters as string[])[1]);
      const read = path === "profiles" ? (filter.includes("2026-09-01") ? "current" : "previous") : (filter.includes("2026-09-01") ? "posts" : "previous_posts");
      calls.push(read);
      return pages[read as keyof typeof pages];
    },
  } satisfies SproutReader);
}

/** Claude's Message Batches: each request answered with what n8n's model answered for it. */
function claude(answers: { brief: unknown; synthesis: unknown }, requests: Any[], o: { failBrief?: boolean } = {}) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const req = JSON.parse(String(init.body)).requests[0];
      requests.push(req);
      return new Response(JSON.stringify({ id: `batch-${requests.length}` }));
    }
    const n = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
    const req = requests[n - 1];
    if (url.endsWith("/results")) {
      const brief = String(req.custom_id).endsWith("source_brief");
      if (brief && o.failBrief) return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "errored", error: { type: "overloaded_error" } } }) + "\n");
      const text = JSON.stringify(brief ? answers.brief : answers.synthesis);
      return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "succeeded", message: { content: [{ type: "text", text }], stop_reason: "end_turn" } } }) + "\n");
    }
    return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${n}/results` }));
  };
}

/** Gamma as it answered n8n: the generation, then each look until it completed. */
function gamma(calls: string[], o: { refuse?: boolean } = {}): SocialDeps["gamma"] {
  const looks = MOBURST.gamma_checks.map((c: Any) => { const r = { ...c }; for (const k of ["_gamma_attempt", "_gamma_poll_again", "_gamma_timeout"]) delete r[k]; return r; });
  let i = 0;
  return () => ({
    async create(prompt) {
      calls.push(`create ${prompt.length}`);
      if (o.refuse) throw new Error("Gamma answered 402: out of credits");
      return MOBURST.gamma_create;
    },
    async read(id) { calls.push(`read ${id}`); return looks[Math.min(i++, looks.length - 1)]; },
  } satisfies GammaClient);
}

/** The two trend scrapers as they answered (execution 583953). */
function apify(calls: string[], o: { fail?: "tiktok"; emptyTikTokRuns?: number } = {}) {
  let tiktokRuns = 0;
  const runs: Record<string, string> = {};
  const client: ApifyClient = {
    async startRun(actorId, input, opts) {
      calls.push(`start ${actorId} ${JSON.stringify(input)} ${opts.timeoutSecs ?? "default"}/${opts.memoryMbytes ?? "default"}`);
      const id = `run-${actorId}-${calls.length}`;
      runs[id] = actorId;
      return { id, status: "RUNNING", defaultDatasetId: `ds-${actorId}` };
    },
    async getRun(runId) {
      const actor = runs[runId];
      const failed = o.fail === "tiktok" && actor === TREND_ACTORS.tiktok.id;
      return { id: runId, status: failed ? "FAILED" : "SUCCEEDED", defaultDatasetId: `ds-${actor}` };
    },
    async datasetPage() { return []; },
    async datasetItems(datasetId) {
      if (datasetId !== `ds-${TREND_ACTORS.tiktok.id}`) return TRENDS.instagram_items;
      tiktokRuns += 1;
      return tiktokRuns <= (o.emptyTikTokRuns ?? 0) ? [] : TRENDS.tiktok_items;
    },
  };
  return () => client;
}

function deps(o: { calls?: Record<string, string[]>; requests?: Any[]; failBrief?: boolean; refuseDeck?: boolean; failTikTok?: boolean; emptyTikTokRuns?: number } = {}): SocialDeps {
  const calls = o.calls ?? { sprout: [], gamma: [], apify: [] };
  return {
    sprout: sprout(calls.sprout),
    gamma: gamma(calls.gamma, { refuse: o.refuseDeck }),
    apify: apify(calls.apify, { fail: o.failTikTok ? "tiktok" : undefined, emptyTikTokRuns: o.emptyTikTokRuns }),
    claudeFetch: claude({ brief: MOBURST.brief_analysis.output, synthesis: MOBURST.ai.output }, o.requests ?? [], { failBrief: o.failBrief }),
  };
}

function setup(o: { reportStatus?: string; createdAt?: string } = {}) {
  const clock = testClock("2026-10-16T20:59:24.047Z");
  const db = pipelineDb({
    reports: [{ id: REPORT.id, client_id: CLIENT, status: o.reportStatus ?? "completed", created_at: o.createdAt ?? REPORT.created_at, report_data: o.reportStatus === "running" ? {} : REPORT.report_data, gamma_url: REPORT.gamma_url }],
  }, () => clock.now());
  return { clock, db };
}

async function run(o: { mode: "shadow" | "app"; request?: Any; deps?: SocialDeps; reportStatus?: string }) {
  const { clock, db } = setup({ reportStatus: o.reportStatus });
  const pipeline = socialPipeline(o.deps ?? deps());
  const registry = makeRegistry([pipeline], () => true);
  const request = o.request ?? moburstRequest();
  const { run_id } = await startReportPipeline(db, { mode: o.mode, kind: "social", pipeline, clientId: CLIENT, reportId: REPORT.id, range: { start: "2026-09-01", end: "2026-09-30" }, request });
  const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
  return { db, clock, run_id, driven, pipeline, registry, steps: driven.calls.map((c) => c.step) };
}

describe("social_v1, live, on what the providers answered n8n for fd501cba", () => {
  it("shadow: makes the report the app stored, as a screen shows it, and writes only shadow storage", async () => {
    const calls = { sprout: [] as string[], gamma: [] as string[], apify: [] as string[] };
    const requests: Any[] = [];
    const { db, run_id, driven, steps } = await run({ mode: "shadow", deps: deps({ calls, requests }) });
    expect(driven.outcome.status).toBe("done");
    expect([...new Set(steps)]).toEqual(["start", "brief", "combine", "sprout", "tiktok", "instagram", "normalize", "synthesis", "parse", "deck", "summary", "write"]);
    // The real report is untouched; the result is in the shadow table.
    expect(db.tables.reports[0].report_data).toEqual(REPORT.report_data);
    const shadow = db.tables.shadow_social_reports[0];
    expect(shadow).toMatchObject({ run_id, client_id: CLIENT, real_report_id: REPORT.id, date_range_start: "2026-09-01", date_range_end: "2026-09-30" });
    const c = compareSocial(REPORT.report_data, shadow.report_data);
    // Every figure the stored report shows (118 for fd501cba), each compared.
    expect(c.figures.compared).toBe(SHOWN_FIGURES);
    expect(c.figures).toMatchObject({ differences: [], onlyReal: [], onlyShadow: [] });
    expect(c.comparison.numbers.differences).toEqual([]);
    expect(c.comparison.text.filter((t) => !t.same)).toEqual([]);
    expect(c.comparison).toMatchObject({ typeMismatches: [], otherDifferences: [], onlyReal: [], onlyShadow: [] });
    // The providers were asked what n8n asked them.
    expect(calls.sprout).toEqual(["current", "posts", "previous", "previous_posts"]);
    expect(calls.apify).toEqual([]);
    expect(calls.gamma.filter((c) => c.startsWith("create"))).toHaveLength(1);
    expect(requests.map((r) => r.params.model)).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);
    expect(requests.map((r) => r.params.output_config)).toEqual([{ effort: "low" }, { effort: "high" }]);
    const normalized = await makePayloadStore(db, run_id).get<Any>("normalized");
    expect(requests[1].params.system).toBe(synthesisSystem(normalized));
    // Every provider answer is kept for 90 days.
    const kept = (db.tables.pipeline_payloads ?? []).filter((p: Any) => p.key.startsWith("source."));
    expect(kept.map((p: Any) => p.key).sort()).toEqual([KEPT.analysis, KEPT.brief, KEPT.gamma, ...["current", "posts", "previous", "previous_posts"].map(KEPT.sprout)].sort());
    for (const p of kept) expect(Date.parse(p.expires_at) - Date.parse(p.created_at)).toBe(90 * 86_400_000);
  });

  it("app: writes the real report through update-report's writer, for the report's attempt, while it runs", async () => {
    const { db, driven } = await run({ mode: "app", reportStatus: "running" });
    expect(driven.outcome.status).toBe("done");
    const row = db.tables.reports[0];
    expect(row).toMatchObject({ status: "completed", gamma_url: REPORT.gamma_url });
    expect(row.duration_minutes).toBeGreaterThanOrEqual(0);
    expect(compareSocial(REPORT.report_data, row.report_data).figures.differences).toEqual([]);
    expect(db.tables.shadow_social_reports ?? []).toEqual([]);
  });

  it("app: a report the dispatch has made again (a new attempt) or already finished is never written", async () => {
    const { clock, db } = setup({ reportStatus: "running" });
    const pipeline = socialPipeline(deps());
    const registry = makeRegistry([pipeline], () => true);
    const { run_id } = await startReportPipeline(db, { mode: "app", kind: "social", pipeline, clientId: CLIENT, reportId: REPORT.id, range: { start: "2026-09-01", end: "2026-09-30" }, request: moburstRequest() });
    // The dispatch takes the report away and makes it again: the same id here, a new created_at.
    db.tables.reports[0].created_at = "2026-10-16T22:00:00.000Z";
    const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
    expect(driven.outcome.status).toBe("done");
    expect(db.tables.reports[0]).toMatchObject({ status: "running", report_data: {} });
  });

  it("with trends: runs both scrapers with n8n's searches (TikTok's on apidojo) and the actors' own settings, and normalizes as n8n did", async () => {
    const calls = { sprout: [] as string[], gamma: [] as string[], apify: [] as string[] };
    const c = TRENDS.client;
    const request = { ...moburstRequest(), skip_trends: false, social_keywords: c.social_keywords, trends_keywords: c.trends_keywords, languages: c.languages, geo: c.geo };
    const { db, run_id, driven } = await run({ mode: "shadow", request, deps: deps({ calls }) });
    expect(driven.outcome.status).toBe("done");
    expect(calls.apify).toEqual([
      `start ${TREND_ACTORS.tiktok.id} ${JSON.stringify(apidojoSearchFor(TRENDS.trend_inputs.trend_inputs.tiktok, "US"))} default/default`,
      `start ${TREND_ACTORS.instagram.id} ${JSON.stringify(TRENDS.trend_inputs.trend_inputs.instagram)} default/default`,
    ]);
    const report = db.tables.shadow_social_reports[0].report_data;
    expect(report.tiktok_trends.posts).toEqual(TRENDS.tiktok_normalized);
    expect(report.instagram_trends.posts).toEqual(TRENDS.instagram_normalized);
    expect(report.data_counts).toMatchObject({ tiktok_trends: 8, instagram_trends: 15 });
    expect(report.trend_status).toEqual({ tiktok: "requested", instagram: "requested" });
    // The datasets are kept with the run.
    const store = makePayloadStore(db, run_id);
    expect(await store.get(KEPT.dataset("tiktok"))).toHaveLength(203);
    expect(await store.get(KEPT.dataset("instagram"))).toHaveLength(346);
  });

  it("starts a new scraper run when a search brings back nothing, and lets an empty last try stand", async () => {
    const c = TRENDS.client;
    const request = { ...moburstRequest(), skip_trends: false, social_keywords: c.social_keywords, trends_keywords: c.trends_keywords, languages: c.languages, geo: c.geo };
    const once = { sprout: [] as string[], gamma: [] as string[], apify: [] as string[] };
    const recovered = await run({ mode: "shadow", request, deps: deps({ calls: once, emptyTikTokRuns: 1 }) });
    expect(recovered.driven.outcome.status).toBe("done");
    expect(once.apify.filter((l) => l.startsWith(`start ${TREND_ACTORS.tiktok.id}`))).toHaveLength(2);
    expect(recovered.db.tables.shadow_social_reports[0].report_data.tiktok_trends.posts).toEqual(TRENDS.tiktok_normalized);
    const twice = { sprout: [] as string[], gamma: [] as string[], apify: [] as string[] };
    const empty = await run({ mode: "shadow", request, deps: deps({ calls: twice, emptyTikTokRuns: 2 }) });
    expect(empty.driven.outcome.status).toBe("done");
    expect(twice.apify.filter((l) => l.startsWith(`start ${TREND_ACTORS.tiktok.id}`))).toHaveLength(2);
    expect(empty.db.tables.shadow_social_reports[0].report_data.data_counts).toMatchObject({ tiktok_trends: 0, instagram_trends: 15 });
  });

  it("goes on as n8n does when a scraper fails, the brief cannot be analyzed, or Gamma refuses the deck", async () => {
    const c = TRENDS.client;
    const request = { ...moburstRequest(), skip_trends: false, social_keywords: c.social_keywords, trends_keywords: c.trends_keywords };
    const { db, driven } = await run({ mode: "shadow", request, deps: deps({ failTikTok: true, failBrief: true, refuseDeck: true }) });
    expect(driven.outcome.status).toBe("done");
    const report = db.tables.shadow_social_reports[0].report_data;
    expect(report.tiktok_trends.posts).toEqual([]);
    expect(report.instagram_trends.posts).toHaveLength(15);
    expect(report.context.brief_context.raw_brief).toBe(MOBURST.combine.brief_text);
    expect(report.gamma_url).toBeNull();
    expect(report.gamma_status).toBe("failed");
    expect(report.warnings).toEqual([
      "The analysis is available, but the presentation did not complete. No presentation link is available.",
      "The brief could not be summarized; its original text was included in the analysis.",
    ]);
    // The scraper failed twice and the deck was asked for once.
    expect(driven.calls.filter((x) => x.step === "tiktok" && x.outcome.status === "queued" && !x.outcome.deferred && !x.outcome.resetAttempts)).toHaveLength(1);
  });

  it("never asks Gamma for a second deck when a try was cut off after the request went out", async () => {
    const calls = { sprout: [] as string[], gamma: [] as string[], apify: [] as string[] };
    const pipeline = socialPipeline(deps({ calls }));
    const saved = new Map<string, unknown>([
      ["normalized", MOBURST.normalized], [KEPT.analysis, MOBURST.ai.output],
      // The try before put this, then was cut off before Gamma's answer came back.
      ["gamma.posting", { at: "2026-10-16T21:01:00.000Z" }],
    ]);
    const ctx: Any = {
      run: { id: "run-1", kind: "social", mode: "shadow", input: {}, started_at: "2026-10-16T20:59:24.047Z" }, step: "deck", attempt: 2, state: {}, poll: null,
      now: () => new Date("2026-10-16T21:05:00.000Z"), signal: new AbortController().signal, deadline: new Date("2026-10-16T21:06:50.000Z"),
      payloads: { async put(k: string, v: unknown) { saved.set(k, v); return { key: k, bytes: 1 }; }, async get(k: string) { return saved.get(k) ?? null; } },
      output: { async write() {} }, db: {}, env: ENV,
    };
    const result = await pipeline.steps.deck(ctx);
    expect(result).toMatchObject({ type: "next", step: "summary", detail: { deck: "request unanswered" } });
    expect(calls.gamma).toEqual([]);
    expect(saved.get(KEPT.gamma)).toEqual({ error: { message: "The deck request was not answered." } });
  });
});

describe("the September replay: fd501cba from the answers a run kept", () => {
  it("makes the report again from what the live run read, with no provider called, and it matches the stored report figure for figure", async () => {
    const live = await run({ mode: "shadow" });
    const { db, clock } = live;
    const none = { sprout: [] as string[], gamma: [] as string[], apify: [] as string[] };
    const requests: Any[] = [];
    const pipeline = socialPipeline(deps({ calls: none, requests }));
    const registry = makeRegistry([pipeline], () => true);
    const started = await startSocialReplay(db, pipeline, { reportId: REPORT.id, reuseAnalysis: true, now: () => clock.now() });
    expect(started).toMatchObject({ started: true, from_run: live.run_id, report_id: REPORT.id });
    const driven = await drivePipeline(db, registry, started.run_id, { clock, env: ENV });
    expect(driven.outcome.status).toBe("done");
    expect(none).toEqual({ sprout: [], gamma: [], apify: [] });
    expect(requests).toEqual([]);
    const replayRun = db.tables.report_pipeline_runs.find((r: Any) => r.id === started.run_id);
    expect(replayRun.input.replay).toEqual({ from_run: live.run_id, report_id: REPORT.id, reuse_analysis: true });
    const compared = await compareSocialRun(db, started.run_id);
    expect(compared!.figures).toMatchObject({ differences: [], onlyReal: [], onlyShadow: [] });
    expect(compared!.figures.compared).toBe(SHOWN_FIGURES);
    expect(compared!.comparison.numbers.differences).toEqual([]);
    expect(compared!.comparison.text.filter((t) => !t.same)).toEqual([]);
    expect(compared!.text).toContain("Figures a screen shows:");
  });

  it("a live shadow of a past report runs only on shadow, from the dispatch's request, tied to the competitive report the run was sent with", async () => {
    const clock = testClock("2026-10-20T10:00:00Z");
    const rows = (engine: string) => ({
      reports: [{ id: REPORT.id, client_id: CLIENT, status: "completed", created_at: REPORT.created_at, date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: REPORT.report_data }],
      clients: [{ id: CLIENT, name: "Moburst", primary_platforms: ["linkedin", "instagram"] }],
      scheduled_jobs: [{ id: "job-1", kind: "dispatch", report_id: REPORT.id, created_at: "2026-10-16T20:59:00Z", result: { competitive_report_id: "comp-1", runs: [{ report_id: REPORT.id }] } }],
      competitive_reports: [{ id: "comp-1", client_id: CLIENT, status: "complete", created_at: "2026-10-07T07:15:04Z", report_data: {} }],
      report_engines: [{ kind: "social", client_id: CLIENT, engine }],
    });
    const pipeline = socialPipeline(deps());
    await expect(startSocialShadow(pipelineDb(rows("n8n"), () => clock.now()), pipeline, REPORT.id)).rejects.toThrow("A live shadow runs only for a client whose social switch is on shadow.");
    const db = pipelineDb(rows("shadow"), () => clock.now());
    const started = await startSocialShadow(db, pipeline, REPORT.id, { now: () => clock.now() });
    expect(started).toMatchObject({ started: true, report_id: REPORT.id, competitive_report_id: "comp-1" });
    const runRow = db.tables.report_pipeline_runs.find((r) => r.id === started.run_id) as Any;
    expect(runRow).toMatchObject({ mode: "shadow", kind: "social", real_table: "reports", real_id: REPORT.id });
    expect(runRow.input).toMatchObject({ range: { start: "2026-09-01", end: "2026-09-30" }, attempt_started_at: REPORT.created_at, request: { client_name: "Moburst" } });
    expect(runRow.input.replay).toBeUndefined();
    expect(String(runRow.dedupe_key)).toMatch(/^live:social:/);
  });

  it("a replay that would ask Claude starts only for a client whose social switch is on shadow", async () => {
    const live = await run({ mode: "shadow" });
    const pipeline = socialPipeline(deps());
    await expect(startSocialReplay(live.db, pipeline, { reportId: REPORT.id })).rejects.toThrow("runs only for a client whose social switch is on shadow");
    live.db.tables.report_engines = [{ kind: "social", client_id: CLIENT, engine: "shadow" }];
    await expect(startSocialReplay(live.db, pipeline, { reportId: REPORT.id, now: () => new Date("2026-10-20T10:00:00Z") })).resolves.toMatchObject({ started: true });
    // A report no in-app run has made cannot be replayed.
    await expect(startSocialReplay(live.db, pipeline, { reportId: "c98e94f1-cc0f-4ede-8287-23a78b50d925", reuseAnalysis: true })).rejects.toThrow("cannot be replayed");
  });
});

describe("the requests", () => {
  it("are built from the request n8n got, for the Sprout reads too", () => {
    const setupJson = MOBURST.sprout_setup;
    expect(sproutRequests(setupJson, MOBURST.combine).current.body.filters).toEqual(["customer_profile_id.eq(5034995, 5489335, 5719052)", "reporting_period.in(2026-09-01...2026-09-30)"]);
  });
});
