// @vitest-environment node
// The in-app social pipeline end to end, through the real step runner and
// stores. The providers are stand-ins that answer with what they answered
// n8n for Moburst's September 2026 report fd501cba (execution 574962, 16 Oct
// 2026): the four Sprout reads, the brief analysis, the synthesis and Gamma's
// deck. So the report must come out as the app stored fd501cba, as a screen
// shows it, and every write must land where its mode allows.
//
// Trends come from the weeks the weekly trend collection stored (Trends plan,
// Task 16): no scraper runs. The report's insights are worded in the run with
// the report_insights job's own code, so the deck says what the screens say,
// and the job queued afterwards meets the same input with no second call.
//
// The September replay is proved here: a live shadow run keeps every answer
// it read; a replay of fd501cba from those answers (no provider called) gives
// the same report, figure for figure.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOBURST, moburstPages, moburstRequest } from "../../../../fixtures/pipelines/social";
import { makeRegistry } from "../../../../functions/_shared/pipelines/registry";
import { startReportPipeline } from "../../../../functions/_shared/pipelines/shadow";
import { makePayloadStore } from "../../../../functions/_shared/pipelines/store";
import { drivePipeline, pipelineDb, testClock } from "../../../../functions/_shared/pipelines/testDriver";
import { compareSocial, compareSocialRun, startSocialReplay, startSocialShadow } from "../../../../functions/_shared/pipelines/social/harness";
import { sproutRequests, type GammaClient, type SproutReader } from "../../../../functions/_shared/pipelines/social/providers";
import { KEPT } from "../../../../functions/_shared/pipelines/social/replay";
import { readStoredTrends } from "../../../../functions/_shared/pipelines/social/storedTrends";
import { socialFigures } from "../../../../functions/_shared/reports/reportText";
import { runReportInsights } from "../../../../functions/_shared/reports/insights";
import { synthesisSystem } from "../../../../functions/_shared/pipelines/social/prompt";
import { socialPipeline, type SocialDeps } from "../../../../functions/_shared/pipelines/definitions/social";

// deno-lint-ignore no-explicit-any
type Any = any;

const REPORT = MOBURST.stored_report;
/** The figures a screen shows for the stored report, by key (reportText.ts socialFigures). */
const SHOWN_FIGURES = new Set(socialFigures(REPORT.report_data).map((f) => f.key)).size;
const CLIENT = REPORT.client_id;
const PERIOD = { start: "2026-09-01", end: "2026-09-30" };
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", SPROUT_CLIENT_ID: "si", SPROUT_CLIENT_SECRET: "ss", GAMMA_API_KEY: "gk" } as Record<string, string>)[n];
/** When report insights went live (report_insights_live_from): before fd501cba was made. */
const LIVE_FROM = "2026-10-01T00:00:00.000Z";

afterEach(() => { vi.restoreAllMocks(); });

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

/**
 * The insights call (insights.ts writeInsights): answers with the facts the
 * prompt numbers, each in its own code-written sentence, as a model that
 * words them faithfully would.
 */
function insightsModel(calls: Any[], o: { fail?: boolean } = {}): SocialDeps["insights"] {
  return () => async (body) => {
    calls.push(body);
    if (o.fail) throw new Error("Claude answered 529: overloaded");
    const content = String((body.messages as Any[])[0].content);
    const facts = [...content.matchAll(/^(F\d+) \([a-z]+\): (.+?) \((.+)\)$/gm)].map((m) => ({ id: m[1], sentence: m[2] }));
    const answer = {
      summary: { text: facts[0].sentence, facts: [facts[0].id] },
      insights: facts.slice(0, 3).map((f) => ({ text: f.sentence, facts: [f.id] })),
      recommendations: [{ text: "Plan next month's posts around what worked this month.", facts: [facts[0].id] }],
    };
    return { text: JSON.stringify(answer), stopReason: "end_turn", raw: { usage: { input_tokens: 1200, output_tokens: 300 } } };
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

interface Calls { sprout: string[]; gamma: string[] }

function deps(o: { calls?: Calls; requests?: Any[]; insights?: Any[]; synthesis?: unknown; failBrief?: boolean; refuseDeck?: boolean; failInsights?: boolean } = {}): SocialDeps {
  const calls = o.calls ?? { sprout: [], gamma: [] };
  return {
    sprout: sprout(calls.sprout),
    gamma: gamma(calls.gamma, { refuse: o.refuseDeck }),
    claudeFetch: claude({ brief: MOBURST.brief_analysis.output, synthesis: o.synthesis ?? MOBURST.ai.output }, o.requests ?? [], { failBrief: o.failBrief }),
    insights: insightsModel(o.insights ?? [], { fail: o.failInsights }),
  };
}

// ── The weeks the trend collection stored for Moburst ──────────────────────

const trendPost = (id: string, week: string, platform: string, o: Any = {}) => ({
  id, client_id: CLIENT, week_id: week, platform, url: `https://www.${platform}.com/p/${id}`, author: `creator_${id}`, text: `How agencies plan a month of posts with AI tools (${id}).`,
  posted_at: "2026-09-08T12:00:00Z", format: platform === "linkedin" ? "text" : "short_video", views: 12000, likes: 800, comments: 40, shares: 25, saves: 10,
  engagement: 1500, fit: 85, why: "Speaks to marketing leads.", lesson: "Open on the result.", search: "ai marketing", kept: true, tripwire: false, ...o,
});
const trendTheme = (id: string, week: string, position: number, title: string, platforms: string[], postIds: string[]) => ({
  id, client_id: CLIENT, week_id: week, position, title, happening: `${title}: creators post about it every day.`, why_it_matters: "Moburst's buyers watch these creators.",
  angle: "Show the agency's own numbers behind it.", platforms, post_ids: postIds, dismissed_at: null,
});
const TREND_TABLES = () => ({
  trend_weeks: [
    // Monday 31 Aug runs into September, but it is August's week (trends/reportWeeks.ts).
    { id: "wk-0", client_id: CLIENT, week_start: "2026-08-31", status: "done" },
    { id: "wk-1", client_id: CLIENT, week_start: "2026-09-07", status: "done" },
    { id: "wk-2", client_id: CLIENT, week_start: "2026-09-21", status: "partial" },
    // October's, outside the report's period.
    { id: "wk-3", client_id: CLIENT, week_start: "2026-10-05", status: "done" },
  ],
  trend_themes: [
    trendTheme("th-0", "wk-0", 0, "An August theme", ["tiktok"], ["tp-0"]),
    trendTheme("th-1", "wk-1", 0, "AI planning in public", ["tiktok", "instagram"], ["tp-1", "tp-2"]),
    trendTheme("th-2", "wk-1", 1, "Agency day in the life", ["tiktok"], ["tp-3"]),
    trendTheme("th-3", "wk-2", 0, "Budget cuts and channel mix", ["instagram", "linkedin"], ["tp-4", "tp-5"]),
    trendTheme("th-4", "wk-2", 1, "Late night launches", ["tiktok"], ["tp-6"]),
    trendTheme("th-5", "wk-3", 0, "An October theme", ["tiktok"], ["tp-7"]),
  ],
  trend_posts: [
    trendPost("tp-0", "wk-0", "tiktok"),
    trendPost("tp-1", "wk-1", "tiktok"), trendPost("tp-2", "wk-1", "instagram"), trendPost("tp-3", "wk-1", "tiktok"),
    trendPost("tp-4", "wk-2", "instagram"), trendPost("tp-5", "wk-2", "linkedin"),
    // A kept post the tripwire flagged: never in a report.
    trendPost("tp-6", "wk-2", "tiktok", { tripwire: true, text: "Free crypto giveaway, link in bio." }),
    trendPost("tp-7", "wk-3", "tiktok"),
  ],
});

/** What Claude wrote about the stored themes. */
const INDUSTRY_ANALYSIS = {
  overview: "Marketing creators spent September on AI planning and on doing more with smaller budgets.",
  themes: [
    { title: "Budget cuts and channel mix", platforms: ["Instagram", "LinkedIn"], note: "Moburst can show how it moves spend between channels." },
    { title: "AI planning in public", platforms: ["TikTok", "Instagram"], note: "Moburst's own planning process is the story." },
  ],
  opportunities_for_client: ["Post a weekly LinkedIn document on channel mix: measure saves and comments."],
  key_takeaways: ["Buyers want to see the process: show the plan, not only the result."],
};
/** The synthesis as Claude answers it now: n8n's analysis of the period, with the industry trends in place of TikTok's and Instagram's. */
const { tiktok_trends_analysis: _t, instagram_trends_analysis: _i, ...ANALYSIS } = MOBURST.ai.output;
const WITH_TRENDS = { ...ANALYSIS, industry_trends_analysis: INDUSTRY_ANALYSIS };

/** A request as the app sends it today: no trend switch (Trends Task 12). */
const todaysRequest = () => { const { skip_trends: _s, ...r } = moburstRequest(); return r; };

function setup(o: { reportStatus?: string; createdAt?: string; tables?: Record<string, Any[]>; liveFrom?: string } = {}) {
  const clock = testClock("2026-10-16T20:59:24.047Z");
  const db = pipelineDb({
    reports: [{
      id: REPORT.id, client_id: CLIENT, status: o.reportStatus ?? "completed", created_at: o.createdAt ?? REPORT.created_at, date_range_start: PERIOD.start, date_range_end: PERIOD.end,
      report_data: o.reportStatus === "running" ? {} : REPORT.report_data, gamma_url: REPORT.gamma_url, clients: { name: "Moburst", archived_at: null },
    }],
    ...(o.tables ?? {}),
  }, () => clock.now());
  // report_insights_live_from(), which the insights writer and the report_insights job read.
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => (name === "report_insights_live_from" ? { data: o.liveFrom ?? LIVE_FROM, error: null } : rpc(name, args));
  return { clock, db };
}

/** report_insights refusing a write: the first `times` writes, or every one. */
function refuseInsightWrites(db: Any, times = Infinity) {
  const from = db.from.bind(db);
  let refused = 0;
  db.from = (table: string) => {
    const q = from(table);
    if (table !== "report_insights") return q;
    q.upsert = (row: Any, opts: Any) => (refused++ < times ? Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } }) : from(table).upsert(row, opts));
    return q;
  };
}

async function run(o: { mode: "shadow" | "app"; request?: Any; deps?: SocialDeps; reportStatus?: string; tables?: Record<string, Any[]>; liveFrom?: string; refuseInsights?: number }) {
  const { clock, db } = setup({ reportStatus: o.reportStatus, tables: o.tables, liveFrom: o.liveFrom });
  if (o.refuseInsights) refuseInsightWrites(db, o.refuseInsights);
  const pipeline = socialPipeline(o.deps ?? deps());
  const registry = makeRegistry([pipeline], () => true);
  const request = o.request ?? moburstRequest();
  const { run_id } = await startReportPipeline(db, { mode: o.mode, kind: "social", pipeline, clientId: CLIENT, reportId: REPORT.id, range: PERIOD, request });
  const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
  const store = makePayloadStore(db, run_id);
  const deck = async () => String((await store.get<Any>("presentation"))?.presentation_content ?? "");
  return { db, clock, run_id, driven, pipeline, registry, store, deck, steps: driven.calls.map((c) => c.step) };
}

const STEPS = ["start", "brief", "combine", "sprout", "stored_trends", "normalize", "synthesis", "parse", "insights", "deck", "summary", "write"];

describe("social_v1, live, on what the providers answered n8n for fd501cba", () => {
  it("shadow: makes the report the app stored, as a screen shows it, and writes only shadow storage", async () => {
    const calls: Calls = { sprout: [], gamma: [] };
    const requests: Any[] = [];
    const insights: Any[] = [];
    const { db, run_id, driven, steps } = await run({ mode: "shadow", deps: deps({ calls, requests, insights }) });
    expect(driven.outcome.status).toBe("done");
    expect([...new Set(steps)]).toEqual(STEPS);
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
    expect(calls.gamma.filter((c) => c.startsWith("create"))).toHaveLength(1);
    expect(requests.map((r) => r.params.model)).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);
    expect(requests.map((r) => r.params.output_config)).toEqual([{ effort: "low" }, { effort: "high" }]);
    const normalized = await makePayloadStore(db, run_id).get<Any>("normalized");
    expect(requests[1].params.system).toBe(synthesisSystem(normalized));
    // The insights were worded once, as the report_insights job words them; a shadow stores none.
    expect(insights.map((b) => b.model)).toEqual(["claude-sonnet-5-5"]);
    expect(db.tables.report_insights ?? []).toEqual([]);
    // Every provider answer is kept for 90 days.
    const kept = (db.tables.pipeline_payloads ?? []).filter((p: Any) => p.key.startsWith("source."));
    expect(kept.map((p: Any) => p.key).sort()).toEqual([KEPT.analysis, KEPT.brief, KEPT.gamma, KEPT.trends, KEPT.insights, ...["current", "posts", "previous", "previous_posts"].map(KEPT.sprout)].sort());
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

  it("app: a report the dispatch has made again (a new attempt) or already finished is never written, nor are its insights", async () => {
    const { clock, db } = setup({ reportStatus: "running" });
    const pipeline = socialPipeline(deps());
    const registry = makeRegistry([pipeline], () => true);
    const { run_id } = await startReportPipeline(db, { mode: "app", kind: "social", pipeline, clientId: CLIENT, reportId: REPORT.id, range: PERIOD, request: moburstRequest() });
    // The dispatch takes the report away and makes it again: the same id here, a new created_at.
    db.tables.reports[0].created_at = "2026-10-16T22:00:00.000Z";
    const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
    expect(driven.outcome.status).toBe("done");
    expect(db.tables.reports[0]).toMatchObject({ status: "running", report_data: {} });
    expect(db.tables.report_insights ?? []).toEqual([]);
  });

  it("goes on when the brief cannot be analyzed or Gamma refuses the deck", async () => {
    const { db, driven } = await run({ mode: "shadow", deps: deps({ failBrief: true, refuseDeck: true }) });
    expect(driven.outcome.status).toBe("done");
    const report = db.tables.shadow_social_reports[0].report_data;
    expect(report.context.brief_context.raw_brief).toBe(MOBURST.combine.brief_text);
    expect(report.gamma_url).toBeNull();
    expect(report.gamma_status).toBe("failed");
    expect(report.warnings).toEqual([
      "The analysis is available, but the presentation did not complete. No presentation link is available.",
      "The brief could not be summarized; its original text was included in the analysis.",
    ]);
  });

  it("never asks Gamma for a second deck when a try was cut off after the request went out", async () => {
    const calls: Calls = { sprout: [], gamma: [] };
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

describe("social_v1 on stored trends (Trends plan, Task 16)", () => {
  it("two stored weeks in the period: their themes in industry_trends, Claude's analysis of them, an Industry trends slide, and no scraper or other network call", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in this test."));
    const calls: Calls = { sprout: [], gamma: [] };
    const requests: Any[] = [];
    const { db, driven, steps, deck } = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), tables: TREND_TABLES(), deps: deps({ calls, requests, synthesis: WITH_TRENDS }) });
    expect(driven.outcome.status).toBe("done");
    expect([...new Set(steps)]).toEqual(STEPS);
    expect(network).not.toHaveBeenCalled();

    const rd = db.tables.reports[0].report_data;
    expect(rd.industry_trends).toEqual(await readStoredTrends(db, CLIENT, PERIOD.start, PERIOD.end));
    expect(rd.industry_trends.themes.map((t: Any) => t.title)).toEqual(["Budget cuts and channel mix", "Late night launches", "AI planning in public", "Agency day in the life"]);
    const urlOf = (id: string) => TREND_TABLES().trend_posts.find((p) => p.id === id)!.url;
    expect(rd.industry_trends.posts.map((p: Any) => p.url)).toEqual(["tp-4", "tp-5", "tp-1", "tp-2", "tp-3"].map(urlOf));
    expect(JSON.stringify(rd.industry_trends)).not.toContain("crypto");
    expect(rd.ai_analysis.industry_trends_analysis).toEqual(INDUSTRY_ANALYSIS);
    expect(rd).not.toHaveProperty("tiktok_trends");
    expect(rd).not.toHaveProperty("instagram_trends");
    expect(rd.trend_status).toBe("stored");
    expect(rd.data_counts).toMatchObject({ tiktok_trends: 2, instagram_trends: 2, industry_trend_themes: 4, industry_trend_posts: 5 });

    // Claude read the themes, not a scraper's posts.
    const asked = requests[1].params;
    expect(asked.messages[0].content).toContain("Budget cuts and channel mix");
    expect(asked.system).toContain("industry_trends_analysis");
    expect(asked.system).not.toContain("No industry trends are available");
    expect(asked.system).not.toMatch(/tiktok_trends_analysis|instagram_trends_analysis/);

    // The deck: one Industry trends slide group, from the stored themes and Claude's notes.
    const text = await deck();
    expect(text).toContain("SLIDE 7: INDUSTRY TRENDS");
    expect(text).toContain(INDUSTRY_ANALYSIS.overview);
    expect(text).toContain("Budget cuts and channel mix (Instagram, LinkedIn): Moburst can show how it moves spend between channels.");
    expect(text).toContain(urlOf("tp-4"));
    expect(text).toContain(INDUSTRY_ANALYSIS.opportunities_for_client[0]);
    expect(text).toContain("• Industry trends: 4 themes and 5 example posts from the weekly trend research");
    expect(text).not.toMatch(/TIKTOK TRENDS|INSTAGRAM TRENDS|Trend Scraper|ENGAGEMENT SCORE|crypto/);
  });

  it("app: words the insights once, stores them for the report, puts them on the deck, and the job report_text queues afterwards meets the same input with no second call", async () => {
    const insights: Any[] = [];
    const { db, store, deck } = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), tables: TREND_TABLES(), deps: deps({ insights, synthesis: WITH_TRENDS }) });
    expect(insights).toHaveLength(1);
    const [row] = db.tables.report_insights;
    expect(db.tables.report_insights).toHaveLength(1);
    expect(row).toMatchObject({ report_table: "reports", report_id: REPORT.id, client_id: CLIENT, kind: "social", source: "model", model: "claude-sonnet-5-5", prompt_version: 1, input_tokens: 1200, output_tokens: 300, problems: [] });
    expect(row.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.facts.length).toBeGreaterThan(0);
    // The deck says what the screens say: the insights in place of the model-written findings.
    const text = await deck();
    for (const [i, c] of row.fields.insights.entries()) expect(text).toContain(`${i + 1}. ${c.text}`);
    expect(text).not.toContain(MOBURST.ai.output.sprout_performance_analysis.key_insights[0]);
    // The answer is kept with the run's provider answers.
    expect(await store.get(KEPT.insights)).toMatchObject({ input_hash: row.input_hash, fields: row.fields, facts: row.facts });
    // The stored report keeps its own words; the screens overlay the insights.
    expect(db.tables.reports[0].report_data.ai_analysis.sprout_performance_analysis).toEqual(ANALYSIS.sprout_performance_analysis);

    const later: Any[] = [];
    const job = { id: "job-insights", client_id: CLIENT, attempts: 1, max_attempts: 5, payload: { table: "reports", report_id: REPORT.id } };
    const outcome = await runReportInsights(db, job, { now: () => new Date("2026-10-17T08:00:00.000Z"), complete: async (body) => { later.push(body); throw new Error("No second call."); } });
    expect(outcome).toEqual({ status: "done", result: { facts: row.facts.length, reused: true } });
    expect(later).toEqual([]);
    expect(db.tables.report_insights).toHaveLength(1);
    expect(db.tables.report_insights[0].confirmed_at).toBe("2026-10-17T08:00:00.000Z");
  });

  it("shadow: the deck carries the insights, and nothing is stored for the report", async () => {
    const insights: Any[] = [];
    const { db, store, deck } = await run({ mode: "shadow", request: todaysRequest(), tables: TREND_TABLES(), deps: deps({ insights, synthesis: WITH_TRENDS }) });
    expect(insights).toHaveLength(1);
    expect(db.tables.report_insights ?? []).toEqual([]);
    const kept = await store.get<Any>(KEPT.insights);
    expect(await deck()).toContain(`1. ${kept.fields.insights[0].text}`);
    expect(db.tables.shadow_social_reports[0].report_data.industry_trends.themes).toHaveLength(4);
  });

  it("with no stored weeks in the period, industry_trends and its analysis are null and the report goes on", async () => {
    const tables = TREND_TABLES();
    tables.trend_weeks = tables.trend_weeks.filter((w) => w.id === "wk-3");
    const requests: Any[] = [];
    // Even an analysis Claude writes without trends is not kept.
    const { db, driven, deck } = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), tables, deps: deps({ requests, synthesis: WITH_TRENDS }) });
    expect(driven.outcome.status).toBe("done");
    const rd = db.tables.reports[0].report_data;
    expect(db.tables.reports[0].status).toBe("completed");
    expect(rd.industry_trends).toBeNull();
    expect(rd.ai_analysis.industry_trends_analysis).toBeNull();
    expect(rd.trend_status).toBe("none");
    expect(rd.data_counts).toMatchObject({ tiktok_trends: 0, instagram_trends: 0, industry_trend_themes: 0, industry_trend_posts: 0 });
    expect(rd.warnings).toEqual([]);
    expect(requests[1].params.system).toContain("IMPORTANT: No industry trends are available for this period. Set industry_trends_analysis to null in your output.");
    const text = await deck();
    expect(text).not.toContain("INDUSTRY TRENDS");
    expect(text).not.toContain("Trend analysis was not included");
    expect(text).toContain("SLIDE 7: ACTION ITEMS & NEXT STEPS");
  });

  it("a stored request that asked for no trends reads none, as the run it replays did", async () => {
    const { db, store } = await run({ mode: "shadow", request: { ...todaysRequest(), skip_trends: true }, tables: TREND_TABLES(), deps: deps({ synthesis: WITH_TRENDS }) });
    const rd = db.tables.shadow_social_reports[0].report_data;
    expect(rd.industry_trends).toBeNull();
    expect(rd.ai_analysis.industry_trends_analysis).toBeNull();
    expect(rd.trend_status).toBe("skipped");
    expect(await store.get(KEPT.trends)).toEqual({ trends: null });
  });

  it("when the insights can't be had on a second try, the deck uses the analysis as before and the report still finishes", async () => {
    const insights: Any[] = [];
    const { db, driven, deck, store } = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), tables: TREND_TABLES(), deps: deps({ insights, failInsights: true, synthesis: WITH_TRENDS }) });
    expect(driven.outcome.status).toBe("done");
    // The first try's error is not swallowed: the step is tried again, then goes on without them.
    expect(insights).toHaveLength(2);
    expect(db.tables.reports[0].status).toBe("completed");
    expect(db.tables.report_insights ?? []).toEqual([]);
    expect(await store.get(KEPT.insights)).toBeNull();
    expect(await deck()).toContain(`1. ${MOBURST.ai.output.sprout_performance_analysis.key_insights[0]}`);
    const steps = (db.tables.report_pipeline_steps ?? []).filter((s: Any) => s.step === "insights");
    expect(steps.map((s: Any) => s.outcome)).toEqual(["retry", "next"]);
    expect(steps[1].detail).toMatchObject({ insights: "not had", next: "deck" });
  });

  it("a write refused once is tried again with the answer it kept: no second call, and the answer is kept with the run's only once stored", async () => {
    const insights: Any[] = [];
    const { db, driven, store, deck } = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), tables: TREND_TABLES(), refuseInsights: 1, deps: deps({ insights, synthesis: WITH_TRENDS }) });
    expect(driven.outcome.status).toBe("done");
    expect(insights).toHaveLength(1);
    expect(db.tables.report_insights).toHaveLength(1);
    expect(await store.get(KEPT.insights)).toMatchObject({ input_hash: db.tables.report_insights[0].input_hash });
    expect(await deck()).toContain(`1. ${db.tables.report_insights[0].fields.insights[0].text}`);
  });

  it("a write refused every time: the deck uses the analysis, the run keeps no insights, and its replay puts none on a deck", async () => {
    const insights: Any[] = [];
    const live = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), tables: TREND_TABLES(), refuseInsights: Infinity, deps: deps({ insights, synthesis: WITH_TRENDS }) });
    expect(live.driven.outcome.status).toBe("done");
    expect(insights).toHaveLength(1);
    expect(await live.store.get(KEPT.insights)).toBeNull();
    expect(await live.deck()).toContain(`1. ${MOBURST.ai.output.sprout_performance_analysis.key_insights[0]}`);
    const pipeline = socialPipeline(deps({ insights }));
    const started = await startSocialReplay(live.db, pipeline, { reportId: REPORT.id, reuseAnalysis: true, now: () => live.clock.now() });
    await drivePipeline(live.db, makeRegistry([pipeline], () => true), started.run_id, { clock: live.clock, env: ENV });
    expect(await makePayloadStore(live.db, started.run_id).get("insights")).toEqual({ row: null });
    expect(insights).toHaveLength(1);
  });

  it("a report from before insights went live gets none and costs no call: the deck uses the analysis", async () => {
    const insights: Any[] = [];
    const { db, deck } = await run({ mode: "app", reportStatus: "running", request: todaysRequest(), liveFrom: "2026-10-20T00:00:00.000Z", deps: deps({ insights, synthesis: WITH_TRENDS }) });
    expect(insights).toEqual([]);
    expect(db.tables.report_insights ?? []).toEqual([]);
    expect(await deck()).toContain(`1. ${MOBURST.ai.output.sprout_performance_analysis.key_insights[0]}`);
  });
});

describe("the September replay: fd501cba from the answers a run kept", () => {
  it("makes the report again from what the live run read, with no provider called, and it matches the stored report figure for figure", async () => {
    const live = await run({ mode: "shadow" });
    const { db, clock } = live;
    const none: Calls = { sprout: [], gamma: [] };
    const requests: Any[] = [];
    const insights: Any[] = [];
    const pipeline = socialPipeline(deps({ calls: none, requests, insights }));
    const registry = makeRegistry([pipeline], () => true);
    const started = await startSocialReplay(db, pipeline, { reportId: REPORT.id, reuseAnalysis: true, now: () => clock.now() });
    expect(started).toMatchObject({ started: true, from_run: live.run_id, report_id: REPORT.id });
    const driven = await drivePipeline(db, registry, started.run_id, { clock, env: ENV });
    expect(driven.outcome.status).toBe("done");
    expect(none).toEqual({ sprout: [], gamma: [] });
    expect(requests).toEqual([]);
    // The insights are the live run's: no model call.
    expect(insights).toEqual([]);
    expect(await makePayloadStore(db, started.run_id).get(KEPT.insights)).toEqual(await live.store.get(KEPT.insights));
    const replayRun = db.tables.report_pipeline_runs.find((r: Any) => r.id === started.run_id);
    expect(replayRun.input.replay).toEqual({ from_run: live.run_id, report_id: REPORT.id, reuse_analysis: true });
    const compared = await compareSocialRun(db, started.run_id);
    expect(compared!.figures).toMatchObject({ differences: [], onlyReal: [], onlyShadow: [] });
    expect(compared!.figures.compared).toBe(SHOWN_FIGURES);
    expect(compared!.comparison.numbers.differences).toEqual([]);
    expect(compared!.comparison.text.filter((t) => !t.same)).toEqual([]);
    expect(compared!.text).toContain("Figures a screen shows:");
  });

  it("reads the trends the live run read, not the tables as they are now", async () => {
    const live = await run({ mode: "shadow", request: todaysRequest(), tables: TREND_TABLES(), deps: deps({ synthesis: WITH_TRENDS }) });
    const { db, clock } = live;
    // A theme dismissed after the run.
    db.tables.trend_themes[0].dismissed_at = "2026-10-20T09:00:00.000Z";
    const insights: Any[] = [];
    const pipeline = socialPipeline(deps({ insights }));
    const started = await startSocialReplay(db, pipeline, { reportId: REPORT.id, reuseAnalysis: true, now: () => clock.now() });
    const driven = await drivePipeline(db, makeRegistry([pipeline], () => true), started.run_id, { clock, env: ENV });
    expect(driven.outcome.status).toBe("done");
    expect(insights).toEqual([]);
    const replayed = db.tables.shadow_social_reports.find((r: Any) => r.run_id === started.run_id).report_data;
    expect(replayed.industry_trends).toEqual(db.tables.shadow_social_reports.find((r: Any) => r.run_id === live.run_id).report_data.industry_trends);
    expect(replayed.industry_trends.themes).toHaveLength(4);
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
