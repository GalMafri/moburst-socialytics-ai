// @vitest-environment node
// A trend week is complete only when every source it needs has answered. A
// source that failed is collected again by the app (that source only, a
// bounded number of times, spaced out) until it answers or the week is over,
// and the week's themes are made again when new posts arrive.
//
// Driven through the real weekly job, the real sweep, the real step runner
// and the real trends_v1 steps, with the six sources answering from the
// recorded fixtures and Claude answering from the request. The brand is
// invented.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApifyError, type ApifyClient } from "../../functions/_shared/apify/client";
import { addCost, nextFault, recollectOf, TRENDS_PIPELINE, trendsPipeline, type TrendsDeps } from "../../functions/_shared/pipelines/definitions/trends";
import { makeRegistry } from "../../functions/_shared/pipelines/registry";
import { makePayloadStore } from "../../functions/_shared/pipelines/store";
import { drivePipeline, pipelineDb, testClock } from "../../functions/_shared/pipelines/testDriver";
import { TREND_SOURCES } from "../../functions/_shared/trends/sources";
import { themeKey, themesRequest, withoutDismissed } from "../../functions/_shared/trends/themes";
import { TREND_PLATFORMS, type TrendPlatform } from "../../functions/_shared/trends/types";
import {
  EARLIER_ANSWER_UNREAD, queueSourceRecollects, RECOLLECTS_PER_WEEK, RECOLLECT_SWEEP_MINUTES, recollectDecision, recollectSweepDue, recollectWaitMs, REFUSALS_BEFORE_STOP, refusedSources, runTrendJob, startTrendWeek, weekStartOf,
  type TrendRunRow, type TrendWeekRow,
} from "../../functions/run-scheduled-jobs/trends";
import type { ScheduledJob } from "../../functions/_shared/scheduled-jobs/types";
import { trendWeekOf } from "../../../src/lib/display";

// deno-lint-ignore no-explicit-any
type Any = any;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p: TrendPlatform): Any[] => JSON.parse(readFileSync(join(here, "..", "..", "fixtures", "trends", `${p}.json`), "utf8"));
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];

/** Monday 16 Nov 2026, 07:10 UTC: the week of 2026-11-16 in Israel time. For the rule read from stored rows. */
const MONDAY = "2026-11-16T07:10:00.000Z";
const WEEK = "2026-11-16";
/** When the recorded fixtures were collected: Sunday 1 Nov 2026, the last day of the week of 2026-10-26. For the weeks driven through the real steps. */
const COLLECTED = "2026-11-01T10:00:00.000Z";
const FIXTURE_WEEK = "2026-10-26";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const REFUSED_INPUT = 'Apify POST /acts/5K30i8aFccKNF5ICs/runs answered 400: {"error":{"type":"invalid-input","message":"Field input.profileSorting must be equal to one of the allowed values"}}';
const REFUSED_TOKEN = 'Apify POST /acts/5K30i8aFccKNF5ICs/runs answered 401: {"error":{"type":"user-or-token-not-found","message":"User was not found or authentication token is not valid"}}';

/** How the sources answer; a test changes it between runs. */
interface Sources {
  /** Platforms whose start is refused, with the message the source gives. */
  refuse: Partial<Record<TrendPlatform, string>>;
  /** Platforms whose run answers with no rows. */
  empty: TrendPlatform[];
  /** One search of a source refused (a source that takes one search a run): the message the source gives for that run's input, if any. */
  refuseSearch?: (platform: TrendPlatform, input: Any) => string | undefined;
  /** Every actor start, in order. */
  calls: TrendPlatform[];
}
function apify(s: Sources): TrendsDeps["apify"] {
  const byActor = Object.fromEntries(TREND_PLATFORMS.map((p) => [TREND_SOURCES[p].actor.id, p])) as Record<string, TrendPlatform>;
  const runs: Record<string, TrendPlatform> = {};
  const client: ApifyClient = {
    async startRun(actorId, input) {
      const platform = byActor[actorId];
      s.calls.push(platform);
      const refused = s.refuse[platform] ?? s.refuseSearch?.(platform, input);
      if (refused) throw new ApifyError(refused, Number(refused.match(/answered (\d{3})/)?.[1]) || null);
      const id = `r${s.calls.length}`;
      runs[id] = platform;
      return { id, status: "RUNNING", defaultDatasetId: `ds-${id}` };
    },
    async getRun(id) { return { id, status: "SUCCEEDED", defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.01 }; },
    async datasetPage() { return []; },
    async datasetItems(datasetId) {
      const platform = runs[datasetId.slice(3)];
      return s.empty.includes(platform) ? [] : fixture(platform);
    },
  };
  return () => client;
}

/** Claude's Message Batches: every candidate kept, three themes; the filter errors when told to. */
function claude(requests: Any[], o: { failFilter?: boolean } = {}) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)).requests[0]);
      return new Response(JSON.stringify({ id: `batch-${requests.length}` }));
    }
    const n = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
    const req = requests[n - 1];
    if (!url.endsWith("/results")) return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${n}/results` }));
    const prompt = String(req.params.messages[0].content);
    if (o.failFilter && String(req.custom_id).includes("filter")) {
      return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "errored", error: { type: "overloaded_error" } } }) + "\n");
    }
    let answer: unknown;
    if (String(req.custom_id).includes("filter")) {
      const ids = [...prompt.matchAll(/<post id="P(\d+)">\n(\w+) \|/g)].map((m) => ({ id: `P${m[1]}`, platform: m[2] }));
      answer = { decisions: ids.map((x, i) => ({ id: x.id, keep: true, fit: 70 + (i % 30), why: "w", format: x.platform === "pinterest" ? "pin" : "short_video", lesson: "l" })) };
    } else {
      const ids = [...prompt.matchAll(/<post id="K(\d+)">/g)].map((m) => `K${m[1]}`);
      answer = { themes: ["One", "Two", "Three"].map((title, i) => ({ title, happening: "h", why_it_matters: "w", angle: "a", post_ids: [ids[i % ids.length]] })) };
    }
    const message = { content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } };
    return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "succeeded", message } }) + "\n");
  };
}

/** True when the rows are the very rows read before: nothing wrote them again (the fake database numbers new rows from the table's size, so an id alone cannot tell). */
const untouched = (now: Any[], before: Any[]) => now.length === before.length && now.every((row, i) => row === before[i]);

const ALL = TREND_PLATFORMS.map((platform) => ({ platform, reason: "watched" }));
const weeklyJob = (client = "c1") => ({ id: "weekly", kind: "trend_refresh", client_id: client, attempts: 1 } as unknown as ScheduledJob);

/** One invented client, its profile and terms, with nothing collected yet. */
function world(o: { failFilter?: boolean } = {}) {
  const clock = testClock(COLLECTED);
  const db = pipelineDb({
    clients: [{ id: "c1", name: "Larkfield Outdoor", geo: "US", language: "en", location: null, archived_at: null, exclude_from_reporting: false, demo_job_id: null }],
    trend_profiles: [{ client_id: "c1", audience: "Weekend hikers", fit_rubric: "Posts that teach trail skills.", platforms: ALL, search_overrides: {}, inputs_key: "k", written_at: COLLECTED, hashtags_at: COLLECTED }],
    trend_terms: [
      { id: "t1", client_id: "c1", kind: "topic", platform: null, term: "app marketing", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t2", client_id: "c1", kind: "topic", platform: null, term: "marketing tips", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t3", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#stopchasingstartplaying", reason: "r", source: "lifecycle", removed_at: null },
    ],
    sprout_profiles: [], competitor_handles: [], trend_weeks: [],
  }, () => clock.now());
  const sources: Sources = { refuse: {}, empty: [], calls: [] };
  const requests: Any[] = [];
  const filter = { failFilter: !!o.failFilter };
  const claudeFetch = (url: string, init?: RequestInit) => claude(requests, filter)(url, init);
  const registry = makeRegistry([trendsPipeline({ apify: apify(sources), claudeFetch })], () => true);
  const drive = (runId: string) => drivePipeline(db, registry, runId, { clock, env: ENV });
  const week = () => db.tables.trend_weeks[0];
  const posts = () => (db.tables.trend_posts ?? []).filter((p) => p.week_id === week().id);
  const themes = () => (db.tables.trend_themes ?? []).filter((t) => t.week_id === week().id);
  const run = (id: string) => db.tables.report_pipeline_runs.find((r) => r.id === id)!;
  /** The weekly job starts the week, and its run is driven to its end. */
  const collectWeek = async () => {
    const out = await runTrendJob(db, weeklyJob(), clock.now());
    await drive(String(out.result!.run_id));
    return String(out.result!.run_id);
  };
  /** The sweep, then every job it queued run as the worker would, each result written back to its row. */
  const sweepAndRun = async () => {
    const queued = await queueSourceRecollects(db, clock.now());
    const outcomes = [];
    for (const job of db.tables.scheduled_jobs.filter((j) => j.kind === "trend_refresh" && j.status !== "done" && j.status !== "failed" && j.status !== "skipped")) {
      const outcome = await runTrendJob(db, { ...job, attempts: 1 } as ScheduledJob, clock.now());
      Object.assign(job, { status: outcome.status, reason: outcome.reason ?? null, result: outcome.result ?? null, created_at: clock.now().toISOString() });
      outcomes.push(outcome);
    }
    return { queued, outcomes };
  };
  return { clock, db, sources, requests, filter, registry, drive, week, posts, themes, run, collectWeek, sweepAndRun };
}

describe("a week with one failed source", () => {
  it("is saved partial with what the source answered, and is collected again for that source only until it answers", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    const first = await w.collectWeek();
    expect(w.week()).toMatchObject({ status: "partial", week_start: FIXTURE_WEEK });
    // The weekly collection is no try: the fault is marked with none counted.
    expect(w.week().platforms.tiktok).toMatchObject({ status: "failed", fault: { kind: "request", status: 400, tries: 0, by: first } });
    expect(w.themes()).toHaveLength(3);
    expect(w.posts().some((p) => p.platform === "tiktok")).toBe(false);
    const savedAt = Date.parse(w.week().finished_at);
    const firstThemes = w.themes();
    const firstCost = w.week().cost;

    // Five minutes on, nothing is due: the first wait is ten minutes.
    w.clock.set(new Date(savedAt + 5 * MIN));
    expect((await w.sweepAndRun()).queued).toEqual([]);

    // Ten minutes on, the sweep queues one job for the week; it starts a run for TikTok alone.
    w.clock.set(new Date(savedAt + 10 * MIN));
    w.sources.calls.length = 0;
    w.requests.length = 0;
    const one = await w.sweepAndRun();
    expect(one.queued).toEqual([`trend_recollect:${w.week().id}:1:2026-11-01`]);
    expect(one.outcomes[0]).toMatchObject({
      status: "done", reason: "TikTok is collected again for the week (try 1 of 6).",
      result: { week_id: w.week().id, week_start: FIXTURE_WEEK, started: true, recollect: { try: 1, of: RECOLLECTS_PER_WEEK, platforms: ["tiktok"], from_run: first } },
    });
    const tryOne = String(one.outcomes[0].result!.run_id);
    expect(w.run(tryOne)).toMatchObject({ pipeline: TRENDS_PIPELINE, real_id: w.week().id, dedupe_key: `trends:c1:${FIXTURE_WEEK}:source-1`, input: { week_start: FIXTURE_WEEK, replay: { from_run: first }, recollect: { platforms: ["tiktok"], try: 1 } } });

    // TikTok still refuses: only TikTok was asked, no model was called, and the week is as it was.
    await w.drive(tryOne);
    expect(new Set(w.sources.calls)).toEqual(new Set(["tiktok"]));
    expect(w.requests).toHaveLength(0);
    expect(w.run(tryOne).status).toBe("done");
    expect(w.week().status).toBe("partial");
    expect(untouched(w.themes(), firstThemes)).toBe(true);
    // The try is recorded on the week: its cost (a refused start costs nothing) and the fault, one try running.
    expect(w.week().cost).toEqual({ ...firstCost, recollected_by: tryOne });
    expect(w.week().platforms.tiktok).toMatchObject({ status: "failed", fault: { kind: "request", status: 400, tries: 1, by: tryOne } });

    // The second try waits an hour from the end of the first.
    const tryOneEnd = Date.parse(w.run(tryOne).finished_at);
    w.clock.set(new Date(tryOneEnd + 59 * MIN));
    expect((await w.sweepAndRun()).queued).toEqual([]);
    w.clock.set(new Date(tryOneEnd + HOUR));
    w.sources.refuse = {};
    w.sources.calls.length = 0;
    const two = await w.sweepAndRun();
    expect(two.outcomes[0]).toMatchObject({ status: "done", result: { recollect: { try: 2, platforms: ["tiktok"], from_run: tryOne } } });
    const tryTwo = String(two.outcomes[0].result!.run_id);
    await w.drive(tryTwo);

    // TikTok answered: it alone was asked, once; the week is done, with TikTok's posts and no post twice.
    expect(w.sources.calls).toEqual(["tiktok"]);
    expect(w.week().status).toBe("done");
    expect(w.week().platforms.tiktok.status).toBe("ok");
    expect(w.week().platforms.tiktok.fault).toBeUndefined();
    expect(w.posts().some((p) => p.platform === "tiktok" && p.kept)).toBe(true);
    const urls = w.posts().map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const p of TREND_PLATFORMS.filter((x) => x !== "tiktok")) expect(w.week().platforms[p].status).toBe("ok");

    // The themes were made again once: one filter and one themes request in the whole recollection.
    expect(w.requests.map((r) => String(r.custom_id).replace(/[^a-z_]/g, "")).filter((id) => id.includes("themes"))).toHaveLength(1);
    expect(w.requests).toHaveLength(2);
    expect(w.themes()).toHaveLength(3);
    expect(untouched(w.themes(), firstThemes)).toBe(false);

    // The week's cost is what it had cost and what the try cost, together.
    expect(w.week().cost.apify_usd).toBeCloseTo(firstCost.apify_usd + 0.01, 4);
    expect(w.week().cost.recollected_by).toBe(tryTwo);
    for (const [model, tokens] of Object.entries(firstCost.claude as Record<string, { input_tokens: number }>)) {
      expect(w.week().cost.claude[model].input_tokens).toBe(tokens.input_tokens + 1000);
    }

    // A complete week is never collected again, however long the sweep goes on.
    w.sources.calls.length = 0;
    for (const later of [10 * MIN, 2 * HOUR, 6 * HOUR, 10 * HOUR]) {
      w.clock.set(new Date(Date.parse(w.week().finished_at) + later));
      expect((await w.sweepAndRun()).queued).toEqual([]);
    }
    expect(w.sources.calls).toEqual([]);
    expect(w.db.tables.report_pipeline_runs).toHaveLength(3);
  });

  it("moves the window's end to the try, so the late source's newest posts count", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    const first = await w.collectWeek();
    const firstPlan = await makePayloadStore(w.db, first).get<Any>("plan");
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 3 * HOUR));
    w.sources.refuse = {};
    const { outcomes } = await w.sweepAndRun();
    const tryOne = String(outcomes[0].result!.run_id);
    const startedAt = w.clock.now().toISOString();
    await w.drive(tryOne);
    const plan = await makePayloadStore(w.db, tryOne).get<Any>("plan");
    expect(plan.window).toEqual({ start: firstPlan.window.start, end: startedAt });
    expect(plan.searches).toEqual(firstPlan.searches);
  });

  it("judges the week again with what people excluded since it was saved, so a dismissed theme stays out", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    const first = await w.collectWeek();
    expect((await makePayloadStore(w.db, first).get<Any>("plan")).exclusions).toEqual([]);
    // A person dismisses a theme: it becomes an exclusion (trend_theme_dismiss).
    w.db.tables.trend_terms.push({ id: "x1", client_id: "c1", kind: "exclusion", platform: null, term: "Gear hauls", reason: "Creators unbox new kit.", source: "dismissal", removed_at: null });
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.requests.length = 0;
    const { outcomes } = await w.sweepAndRun();
    await w.drive(String(outcomes[0].result!.run_id));
    const filter = w.requests.find((r) => String(r.custom_id).includes("filter"))!;
    expect(String(filter.params.messages[0].content)).toContain("Never keep posts like these: Gear hauls (Creators unbox new kit.)");
  });

  it("records a source that answers with nothing as answered, without asking the model or touching the themes", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    const before = { themes: w.themes(), posts: w.posts(), cost: w.week().cost };
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.sources.empty = ["tiktok"];
    w.requests.length = 0;
    const { outcomes } = await w.sweepAndRun();
    await w.drive(String(outcomes[0].result!.run_id));
    expect(w.requests).toHaveLength(0);
    expect(w.week().status).toBe("done");
    expect(w.week().platforms.tiktok).toMatchObject({ status: "empty", rows: 0, candidates: 0, kept: 0 });
    expect(w.week().platforms.tiktok.fault).toBeUndefined();
    expect(untouched(w.themes(), before.themes)).toBe(true);
    expect(untouched(w.posts(), before.posts)).toBe(true);
    // The source's run was paid for, and the week's cost says so.
    expect(w.week().cost.apify_usd).toBeCloseTo(before.cost.apify_usd + 0.01, 4);
    expect(w.week().cost.claude).toEqual(before.cost.claude);
    expect((await w.sweepAndRun()).queued).toEqual([]);
  });

  it("keeps the week as it was saved when its posts cannot be judged again", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    const before = { themes: w.themes(), posts: w.posts(), status: w.week().status, cost: w.week().cost };
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.filter.failFilter = true;
    const { outcomes } = await w.sweepAndRun();
    const tryOne = String(outcomes[0].result!.run_id);
    await w.drive(tryOne);
    expect(w.run(tryOne)).toMatchObject({ status: "stopped", outcome: expect.stringMatching(/stays as it was saved/) });
    expect(untouched(w.themes(), before.themes)).toBe(true);
    expect(untouched(w.posts(), before.posts)).toBe(true);
    expect(w.week().status).toBe(before.status);
    expect(w.week().platforms.tiktok.status).toBe("failed");
    // The try paid for the source's run though it wrote nothing: that is in the week's cost, once.
    expect(w.week().cost.apify_usd).toBeCloseTo(before.cost.apify_usd + 0.01, 4);
    expect(w.week().cost.recollected_by).toBe(tryOne);
    // The stopped try counted: the next one is the second, from the run the week was saved by.
    w.filter.failFilter = false;
    w.clock.set(new Date(Date.parse(w.run(tryOne).finished_at) + HOUR));
    const next = await w.sweepAndRun();
    expect(next.outcomes[0].result).toMatchObject({ recollect: { try: 2 }, stopped: { run_id: tryOne, kind: "transient" } });
  });

  it("asks a source that takes one search a run again search by search, and nothing else", async () => {
    const w = world();
    w.sources.refuse.youtube = "Apify POST /acts/nfyn3ecod9uCDaoVH/runs answered 500: internal error";
    await w.collectWeek();
    expect(w.week()).toMatchObject({ status: "partial" });
    expect(w.week().platforms.youtube).toMatchObject({ status: "failed", searched: 2 });
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.sources.calls.length = 0;
    const { outcomes } = await w.sweepAndRun();
    expect(outcomes[0].result).toMatchObject({ recollect: { platforms: ["youtube"] }, sources: [{ platform: "youtube", kind: "transient", status: 500 }] });
    await w.drive(String(outcomes[0].result!.run_id));
    // One run per search (two topics), all of them YouTube's.
    expect(w.sources.calls).toEqual(["youtube", "youtube"]);
    expect(w.week().status).toBe("done");
    expect(w.week().platforms.youtube).toMatchObject({ status: "ok", searched: 2 });
    expect(w.posts().some((p) => p.platform === "youtube")).toBe(true);
  });

  it("leaves a plain replay a replay: no source is asked and the week keeps its scraping cost", async () => {
    const w = world();
    const first = await w.collectWeek();
    expect(w.week().status).toBe("done");
    const cost = w.week().cost.apify_usd;
    w.sources.calls.length = 0;
    const replay = await startTrendWeek(w.db, "c1", w.clock.now(), { replayFrom: first, suffix: "replay-1" });
    if (!("runId" in replay)) throw new Error(replay.skipped);
    await w.drive(replay.runId);
    expect(w.sources.calls).toEqual([]);
    expect(w.week().cost).toMatchObject({ apify_usd: cost, replayed_from: first });
    expect(w.week().cost.recollected_by).toBeUndefined();
  });

  it("stops before asking any source when an answer the week was saved from is no longer kept, and leaves the week as saved", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    const first = await w.collectWeek();
    const before = { themes: w.themes(), posts: w.posts(), status: w.week().status, instagram: w.week().platforms.instagram };
    expect(w.posts().some((p) => p.platform === "instagram")).toBe(true);
    // Instagram's kept answer is gone (not empty: gone).
    w.db.tables.pipeline_payloads = w.db.tables.pipeline_payloads.filter((r) => !(r.run_id === first && r.key === "source.instagram.0"));
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.sources.calls.length = 0;
    w.requests.length = 0;
    const { outcomes } = await w.sweepAndRun();
    const tryOne = String(outcomes[0].result!.run_id);
    await w.drive(tryOne);
    expect(w.run(tryOne)).toMatchObject({ status: "stopped", step: "start", outcome: "The earlier run kept no answer for instagram search 1 of 1, so the week is not written again." });
    // Nothing was paid for, nothing was judged, and Instagram's posts are still the week's.
    expect(w.sources.calls).toEqual([]);
    expect(w.requests).toEqual([]);
    expect(untouched(w.posts(), before.posts)).toBe(true);
    expect(untouched(w.themes(), before.themes)).toBe(true);
    expect(w.week().status).toBe(before.status);
    expect(w.week().platforms.instagram).toEqual(before.instagram);
  });

  it("never reads a missing kept answer as an empty one in a plain replay either: the replay stops and the week keeps its posts", async () => {
    const w = world();
    const first = await w.collectWeek();
    expect(w.week().status).toBe("done");
    const before = { themes: w.themes(), posts: w.posts(), linkedin: w.week().platforms.linkedin };
    w.db.tables.pipeline_payloads = w.db.tables.pipeline_payloads.filter((r) => !(r.run_id === first && r.key === "source.linkedin.0"));
    w.requests.length = 0;
    const replay = await startTrendWeek(w.db, "c1", w.clock.now(), { replayFrom: first, suffix: "replay-1" });
    if (!("runId" in replay)) throw new Error(replay.skipped);
    await w.drive(replay.runId);
    expect(w.run(replay.runId)).toMatchObject({ status: "stopped", step: "start", outcome: "The earlier run kept no answer for linkedin search 1 of 1, so the week is not written again." });
    expect(w.requests).toEqual([]);
    expect(untouched(w.posts(), before.posts)).toBe(true);
    expect(untouched(w.themes(), before.themes)).toBe(true);
    expect(w.week()).toMatchObject({ status: "done" });
    expect(w.week().platforms.linkedin).toEqual(before.linkedin);
  });

  it("stops a recollect run that names no run to start from, before any source is asked", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    w.sources.calls.length = 0;
    const { startPipelineRun } = await import("../../functions/_shared/pipelines/store");
    const { run_id } = await startPipelineRun(w.db, { mode: "app", pipeline: w.registry.get(TRENDS_PIPELINE)!, clientId: "c1", realTable: "trend_weeks", realId: w.week().id, input: { week_start: FIXTURE_WEEK, recollect: { platforms: ["tiktok"], try: 1 } }, dedupe: "trends:c1:orphan" });
    const driven = await w.drive(run_id);
    expect(driven.outcome.status).toBe("failed");
    expect(w.run(run_id).status).toBe("stopped");
    expect(w.sources.calls).toEqual([]);
  });
});

describe("what a rebuild reads from the run the week was saved from", () => {
  const SERVER_ERROR = "Apify POST /acts/nfyn3ecod9uCDaoVH/runs answered 500: internal error";
  /** A week saved without TikTok, in which one of YouTube's two searches failed and the other answered (so YouTube counts as answered). */
  async function weekWithAFailedSearch() {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    w.sources.refuseSearch = (platform, input) => (platform === "youtube" && input?.query === "marketing tips" ? SERVER_ERROR : undefined);
    const first = await w.collectWeek();
    expect(w.week()).toMatchObject({ status: "partial" });
    expect(w.week().platforms.youtube).toMatchObject({ status: "ok", searched: 2 });
    expect(w.week().platforms.tiktok.status).toBe("failed");
    return { w, first, youtube: w.posts().filter((p) => p.platform === "youtube").map((p) => p.url).sort() };
  }
  /** The next try: the sweep, its job, and the run driven to its end. */
  async function nextTry(w: ReturnType<typeof world>) {
    const last = Math.max(Date.parse(w.week().finished_at), ...w.db.tables.report_pipeline_runs.map((r) => Date.parse(r.finished_at ?? "") || 0));
    const tries = w.db.tables.report_pipeline_runs.filter((r) => r.input?.recollect).length;
    w.clock.set(new Date(last + [10 * MIN, HOUR, 6 * HOUR][tries]));
    const { outcomes } = await w.sweepAndRun();
    const runId = String(outcomes[0].result!.run_id);
    const driven = await w.drive(runId);
    return { runId, driven };
  }
  const keysOf = (w: ReturnType<typeof world>, runId: string) => w.db.tables.pipeline_payloads.filter((r) => r.run_id === runId).map((r) => String(r.key));
  afterEach(() => { vi.restoreAllMocks(); });
  /** Storage that fails to hand over one kept answer, a given number of times. The store's short waits between its tries of a read are not waited out here. */
  function failingRead(w: ReturnType<typeof world>, path: string, times: number) {
    const wait = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => wait(fn, ms && ms <= 450 ? 0 : ms, ...rest)) as typeof setTimeout);
    const storage = w.db.storage;
    const left = { n: times, failed: 0 };
    w.db.storage = {
      from: (bucket: string) => {
        const real = storage.from(bucket);
        return { ...real, download: async (at: string) => (at.endsWith(path) && left.n-- > 0 ? (left.failed++, { data: null, error: { message: "upstream request timeout" } }) : real.download(at)) };
      },
    };
    return left;
  }

  it("heals a week whose collection had one failed search of an answered source, when the failed source answers", async () => {
    const { w, first, youtube } = await weekWithAFailedSearch();
    // The original run recorded the failed search as a fact, beside the answer of the search that worked.
    expect(keysOf(w, first)).toEqual(expect.arrayContaining(["source.youtube.0", "source.youtube.1.failed"]));
    expect(keysOf(w, first)).not.toContain("source.youtube.1");
    w.sources.refuse = {};
    w.sources.refuseSearch = undefined;
    w.sources.calls.length = 0;
    const { runId } = await nextTry(w);
    expect(w.run(runId).status).toBe("done");
    // Only TikTok was asked. YouTube's failed search was read as what it was: a search that brought nothing.
    expect(w.sources.calls).toEqual(["tiktok"]);
    expect(w.week()).toMatchObject({ status: "done" });
    expect(w.week().platforms.tiktok.status).toBe("ok");
    expect(w.week().platforms.youtube).toMatchObject({ status: "ok", searched: 2 });
    expect(w.posts().filter((p) => p.platform === "youtube").map((p) => p.url).sort()).toEqual(youtube);
    expect(w.posts().some((p) => p.platform === "tiktok" && p.kept)).toBe(true);
    const plan = await makePayloadStore(w.db, runId).get<Any>("plan");
    expect(plan.kept["youtube.0"]).toEqual({ state: "answered" });
    expect(plan.kept["youtube.1"]).toEqual({ state: "failed", message: "" });
    // The fact is carried on, so the next rebuild of the week reads it the same way.
    expect(keysOf(w, runId)).toContain("source.youtube.1.failed");
    expect((await makePayloadStore(w.db, runId).get<Any>("source.youtube.1.failed")).message).toContain("answered 500");
  });

  it("heals it too when the failed search left no kept mark, from the run's own step log", async () => {
    const { w, first, youtube } = await weekWithAFailedSearch();
    // The mark was never stored (its write is not waited on); the run's step log still says the search failed.
    w.db.tables.pipeline_payloads = w.db.tables.pipeline_payloads.filter((r) => !(r.run_id === first && r.key === "source.youtube.1.failed"));
    const logged = w.db.tables.report_pipeline_steps.filter((x) => x.run_id === first && x.step === "scrape_youtube" && typeof x.detail?.failed === "string");
    expect(logged.map((x) => x.detail.run)).toEqual([2]);
    w.sources.refuse = {};
    w.sources.refuseSearch = undefined;
    w.sources.calls.length = 0;
    const { runId } = await nextTry(w);
    expect(w.run(runId).status).toBe("done");
    expect(w.sources.calls).toEqual(["tiktok"]);
    expect(w.week()).toMatchObject({ status: "done" });
    expect(w.posts().filter((p) => p.platform === "youtube").map((p) => p.url).sort()).toEqual(youtube);
    const plan = await makePayloadStore(w.db, runId).get<Any>("plan");
    expect(plan.kept["youtube.1"]).toEqual({ state: "failed", message: expect.stringContaining("answered 500") });
    // A replay of this run finds the mark again, and its step log says so as well.
    expect(keysOf(w, runId)).toContain("source.youtube.1.failed");
    expect(w.db.tables.report_pipeline_steps.some((x) => x.run_id === runId && x.step === "scrape_youtube" && x.detail?.run === 2 && typeof x.detail?.failed === "string")).toBe(true);
  });

  it("stops at start, before any paid call, when a search has nothing kept and no record of failing", async () => {
    const { w, first } = await weekWithAFailedSearch();
    const before = { posts: w.posts(), themes: w.themes(), week: { ...w.week() } };
    // YouTube's answered search has lost its answer, and nothing says that search failed.
    w.db.tables.pipeline_payloads = w.db.tables.pipeline_payloads.filter((r) => !(r.run_id === first && r.key === "source.youtube.0"));
    w.sources.refuse = {};
    w.sources.refuseSearch = undefined;
    w.sources.calls.length = 0;
    w.requests.length = 0;
    const { runId, driven } = await nextTry(w);
    expect(driven.calls.map((c) => c.step)).toEqual(["start"]);
    expect(w.run(runId)).toMatchObject({ status: "stopped", outcome: "The earlier run kept no answer for youtube search 1 of 2, so the week is not written again." });
    expect(w.sources.calls).toEqual([]);
    expect(w.requests).toEqual([]);
    expect(untouched(w.posts(), before.posts)).toBe(true);
    expect(untouched(w.themes(), before.themes)).toBe(true);
    expect(w.week()).toEqual(before.week);
  });

  it("reads every kept answer before it asks the named source, and reads each search exactly as start decided", async () => {
    const { w, first } = await weekWithAFailedSearch();
    w.sources.refuse = {};
    w.sources.refuseSearch = undefined;
    const { runId, driven } = await nextTry(w);
    // The named source's steps come last.
    const steps = driven.calls.map((c) => c.step).filter((x) => x.startsWith("scrape_"));
    const order = [...new Set(steps)];
    expect(order).toEqual(["scrape_instagram", "scrape_linkedin", "scrape_youtube", "scrape_pinterest", "scrape_facebook", "scrape_tiktok"]);
    // start's list has one entry for every search the run read, and the run read each as the list says.
    const plan = await makePayloadStore(w.db, runId).get<Any>("plan");
    const searches = TREND_PLATFORMS.filter((p) => p !== "tiktok").flatMap((p) =>
      TREND_SOURCES[p].inputs(plan.searches[p] ?? [], { region: plan.client.region, language: plan.client.language, windowStart: plan.window.start.slice(0, 10), windowEnd: plan.window.end.slice(0, 10) }).map((_, i) => `${p}.${i}`));
    expect(Object.keys(plan.kept).sort()).toEqual([...searches].sort());
    expect(searches.length).toBeGreaterThan(6);
    const read = keysOf(w, runId);
    const original = keysOf(w, first);
    for (const [search, held] of Object.entries(plan.kept as Record<string, { state: string }>)) {
      const key = `source.${search}`;
      // What start decided is what the earlier run holds, and what the scrape step then read and kept.
      expect(original.includes(held.state === "failed" ? `${key}.failed` : key), search).toBe(true);
      expect(read.includes(`${key}.failed`), search).toBe(held.state === "failed");
      expect(read.includes(key), search).toBe(held.state === "answered");
    }
    // The named source is in no list: it was asked.
    expect(Object.keys(plan.kept).some((k) => k.startsWith("tiktok."))).toBe(false);
  });

  it("tries again a kept answer that could not be read just now: not missing, not empty, and nothing is paid before it is read", async () => {
    const { w, first } = await weekWithAFailedSearch();
    const facebookBefore = w.posts().filter((p) => p.platform === "facebook").length;
    expect(facebookBefore).toBeGreaterThan(0);
    // Four downloads fail: the store's three tries of the first read, and the first try of the next.
    const reads = failingRead(w, `runs/${first}/source.facebook.1.json`, 4);
    w.sources.refuse = {};
    w.sources.refuseSearch = undefined;
    w.sources.calls.length = 0;
    const { runId, driven } = await nextTry(w);
    expect(reads.failed).toBe(4);
    // The step's first try failed on the read and was tried again by the runner; no source had been asked by then.
    const retried = driven.calls.filter((c) => c.step === "scrape_facebook" && String(c.outcome.reason ?? "").includes("is kept but could not be read"));
    expect(retried.map((c) => c.attempt)).toEqual([1]);
    expect(retried[0].outcome.status).toBe("queued");
    const firstPaid = driven.calls.findIndex((c) => c.step === "scrape_tiktok");
    expect(driven.calls.findIndex((c) => c === retried[0])).toBeLessThan(firstPaid);
    // Then it was read: the week healed, with every Facebook post it had, and TikTok asked once.
    expect(w.run(runId).status).toBe("done");
    expect(w.sources.calls).toEqual(["tiktok"]);
    expect(w.week()).toMatchObject({ status: "done" });
    expect(w.week().platforms.facebook.status).toBe("ok");
    expect(w.posts().filter((p) => p.platform === "facebook")).toHaveLength(facebookBefore);
  });

  it("stops without having paid for anything when a kept answer cannot be read at all, and the next try starts clean", async () => {
    const { w, first } = await weekWithAFailedSearch();
    const before = { posts: w.posts(), themes: w.themes(), status: w.week().status };
    // Every download fails through the runner's five tries of the step, three reads each.
    const reads = failingRead(w, `runs/${first}/source.facebook.1.json`, 15);
    w.sources.refuse = {};
    w.sources.refuseSearch = undefined;
    w.sources.calls.length = 0;
    w.requests.length = 0;
    const one = await nextTry(w);
    expect(reads.failed).toBe(15);
    expect(w.run(one.runId)).toMatchObject({ status: "stopped", outcome: expect.stringMatching(/scrape_facebook did not finish in 5 tries: The payload source\.facebook\.1 is kept but could not be read: upstream request timeout/) });
    expect(w.sources.calls).toEqual([]);
    expect(w.requests).toEqual([]);
    expect(untouched(w.posts(), before.posts)).toBe(true);
    expect(untouched(w.themes(), before.themes)).toBe(true);
    expect(w.week().status).toBe(before.status);
    // Storage answers again: the second try heals the week.
    const two = await nextTry(w);
    expect(w.run(two.runId).status).toBe("done");
    expect(w.week()).toMatchObject({ status: "done" });
    expect(w.sources.calls).toEqual(["tiktok"]);
  });

  it("never takes a list it could not read back for an empty one: the weekly save is tried again and writes the week whole", async () => {
    // Each list, and the step that reads it back first.
    for (const [lost, step] of [["kept", "themes"], ["themes", "save"], ["candidates", "filter"], ["rule_dropped", "save"], ["claude_dropped", "save"], ["posts.instagram", "rules"]]) {
      const w = world();
      // The first collection of a week: a list the run made cannot be read back on a step's first try.
      const reads = failingRead(w, `/${lost}.json`, 3);
      const first = await w.collectWeek();
      expect(reads.failed, lost).toBe(3);
      const retried = w.db.tables.report_pipeline_steps.filter((x) => x.run_id === first && x.outcome === "retry");
      expect(retried.map((x) => x.step), lost).toEqual([step]);
      expect(String(retried[0].detail.error), lost).toContain(`The payload ${lost} is kept but could not be read`);
      // No step gave up, and none went on with an empty list.
      expect(w.db.tables.report_pipeline_steps.some((x) => x.run_id === first && x.detail?.gave_up), lost).toBe(false);
      // The week was written once, whole: every source's posts, kept posts and themes.
      expect(w.week(), lost).toMatchObject({ status: "done" });
      expect(w.themes(), lost).toHaveLength(3);
      expect(w.posts().filter((p) => p.kept).length, lost).toBeGreaterThan(10);
      expect(w.posts().some((p) => p.platform === "facebook" && p.kept), lost).toBe(true);
      expect(w.posts().some((p) => p.platform === "instagram"), lost).toBe(true);
      expect(w.posts().some((p) => !p.kept), lost).toBe(true);
    }
  });

  it("writes nothing when its own lists cannot be read at all: the run stops and the week is not saved empty", async () => {
    const w = world();
    failingRead(w, "/kept.json", 1000);
    const out = await runTrendJob(w.db, weeklyJob(), w.clock.now());
    const driven = await w.drive(String(out.result!.run_id));
    expect(driven.outcome.status).toBe("failed");
    const run = w.run(String(out.result!.run_id));
    // The themes step, which reads the kept posts first, never gave up into a save; the runner's tries ended the run.
    expect(run).toMatchObject({ status: "stopped", step: "themes", outcome: expect.stringMatching(/themes did not finish in 5 tries: The payload kept is kept but could not be read/) });
    expect(w.week()).toMatchObject({ status: "running" });
    expect(w.posts()).toEqual([]);
    expect(w.themes()).toEqual([]);
  });

  it("does not mark a source failed, or lose its earlier searches, when the posts it has so far cannot be read", async () => {
    const w = world();
    // YouTube takes one search a run: before its second search is added, the posts of the first are read back.
    const reads = failingRead(w, "/posts.youtube.json", 3);
    const first = await w.collectWeek();
    expect(reads.failed).toBe(3);
    const steps = w.db.tables.report_pipeline_steps.filter((x) => x.run_id === first && x.step === "scrape_youtube");
    expect(steps.some((x) => x.outcome === "retry" && String(x.detail.error).includes("The payload posts.youtube is kept but could not be read"))).toBe(true);
    expect(w.week().platforms.youtube).toMatchObject({ status: "ok", searched: 2 });
    expect(w.week().platforms.youtube.fault).toBeUndefined();
    // Both searches' posts are the week's: the count the source's two answers hold.
    const store = makePayloadStore(w.db, first);
    const rows = [...(await store.get<Any[]>("source.youtube.0"))!, ...(await store.get<Any[]>("source.youtube.1"))!];
    expect((await store.get<Any[]>("posts.youtube"))!.length).toBe(rows.map((r, i) => TREND_SOURCES.youtube.normalize(r, "", i + 1)).filter(Boolean).length);
    expect(w.week()).toMatchObject({ status: "done" });
  });

  it("gives a plain replay the same reading list, and stops it at start when a search has nothing kept", async () => {
    const { w, first } = await weekWithAFailedSearch();
    w.sources.calls.length = 0;
    const replay = await startTrendWeek(w.db, "c1", w.clock.now(), { replayFrom: first, suffix: "replay-1" });
    if (!("runId" in replay)) throw new Error(replay.skipped);
    await w.drive(replay.runId);
    expect(w.run(replay.runId).status).toBe("done");
    expect(w.sources.calls).toEqual([]);
    const plan = await makePayloadStore(w.db, replay.runId).get<Any>("plan");
    // Every source is read from kept answers, TikTok's failed search among them.
    expect(plan.kept["tiktok.0"]).toMatchObject({ state: "failed" });
    expect(plan.kept["youtube.1"]).toMatchObject({ state: "failed" });
    expect(w.week().platforms.tiktok.status).toBe("failed");
    expect(w.week().platforms.youtube.status).toBe("ok");
  });
});

describe("a theme a person dismissed, when the week is written again", () => {
  /** A week saved without TikTok whose theme "Two" a person then dismissed, as trend_theme_dismiss leaves it. */
  async function dismissedWeek() {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    const two = w.themes().find((t) => t.title === "Two")!;
    Object.assign(two, { dismissed_at: "2026-11-01T10:20:00.000Z", dismissed_by: "staff-1" });
    w.db.tables.trend_terms.push({ id: "x1", client_id: "c1", kind: "exclusion", platform: null, term: two.title, reason: two.happening, source: "dismissal", removed_at: null });
    return { w, two, snapshot: { ...two } };
  }

  it("stays dismissed, by whom and when, and is not written again though the model writes it again", async () => {
    const { w, two, snapshot } = await dismissedWeek();
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.requests.length = 0;
    const { outcomes } = await w.sweepAndRun();
    const tryOne = String(outcomes[0].result!.run_id);
    await w.drive(tryOne);
    expect(w.week().status).toBe("done");

    // (a) The dismissed row is the same row: who dismissed it and when, its title and text.
    const kept = w.themes().filter((t) => t.dismissed_at != null);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(two);
    expect(kept[0]).toMatchObject({ id: snapshot.id, title: "Two", dismissed_at: "2026-11-01T10:20:00.000Z", dismissed_by: "staff-1", happening: snapshot.happening });
    // Its posts are posts the week still stores.
    const stored = new Set(w.posts().map((p) => p.id));
    expect(kept[0].post_ids.every((id: string) => stored.has(id))).toBe(true);

    // (b) The themes step was told which titles were dismissed.
    const themes = w.requests.find((r) => String(r.custom_id).includes("themes"))!;
    expect(String(themes.params.messages[0].content)).toContain("The brand's team dismissed these themes for this week. Do not write them again, under these or other words: Two");

    // (c) The model wrote "Two" again all the same (the fake always answers One, Two, Three): it is left out.
    expect(w.themes().filter((t) => t.dismissed_at == null).map((t) => t.title)).toEqual(["One", "Three"]);
    expect(w.themes().filter((t) => themeKey(t.title) === "two")).toHaveLength(1);
    const steps = w.db.tables.report_pipeline_steps.filter((x) => x.run_id === tryOne && x.step === "read_themes");
    expect(steps.at(-1)!.detail).toMatchObject({ themes: 2, dismissed_left_out: 1 });
  });

  it("stays dismissed through a plain replay of the week too", async () => {
    const { w, two } = await dismissedWeek();
    const first = w.db.tables.report_pipeline_runs[0].id;
    const replay = await startTrendWeek(w.db, "c1", w.clock.now(), { replayFrom: first, suffix: "replay-1" });
    if (!("runId" in replay)) throw new Error(replay.skipped);
    await w.drive(replay.runId);
    expect(w.themes().filter((t) => t.dismissed_at != null)).toEqual([two]);
    expect(w.themes().filter((t) => t.dismissed_at == null).map((t) => t.title)).toEqual(["One", "Three"]);
  });

  it("matches a title as the exclusion a dismissal makes is matched, and tells the model only when there is something to tell", () => {
    const theme = (title: string) => ({ title, happening: "h", why_it_matters: "w", angle: "a", platforms: [], post_urls: [] });
    expect(themeKey("  Gear Hauls ")).toBe("gear hauls");
    expect(withoutDismissed([theme("Gear hauls"), theme("GEAR HAULS"), theme("Trail snacks")], ["gear Hauls"]).map((t) => t.title)).toEqual(["Trail snacks"]);
    // Another title is another theme: only the same title is kept out in code.
    expect(withoutDismissed([theme("Gear haul videos")], ["Gear hauls"])).toHaveLength(1);
    const all = [theme("One")];
    expect(withoutDismissed(all, [])).toBe(all);
    const profile = { audience: "a", fit_rubric: "f" };
    expect(String((themesRequest(profile, []).messages as Any[])[0].content)).not.toContain("dismissed");
    expect(String((themesRequest(profile, [], ["Gear hauls", "Rain <post> checks"]).messages as Any[])[0].content)).toContain("Do not write them again, under these or other words: Gear hauls; Rain [post> checks");
  });
});

describe("what a failed source answered, for operators", () => {
  it("records a refused request (400) as a request fact in the job's result, and still tries again", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    const { outcomes } = await w.sweepAndRun();
    expect(outcomes[0].result!.sources).toEqual([{ platform: "tiktok", kind: "request", status: 400, message: expect.stringContaining("input.profileSorting") }]);
    expect(outcomes[0].status).toBe("done");
    // The record is the job's result alone: nothing in it says a message was sent, because none is.
    expect(Object.keys(outcomes[0].result!).sort()).toEqual(["recollect", "run_id", "sources", "started", "week_id", "week_start"]);
    // The second try of the same week records the same fact.
    await w.drive(String(outcomes[0].result!.run_id));
    w.clock.set(new Date(w.clock.now().getTime() + HOUR + MIN));
    const again = await w.sweepAndRun();
    expect(again.outcomes[0].result!.sources).toMatchObject([{ platform: "tiktok", kind: "request", status: 400 }]);
    expect(again.outcomes[0].result!.recollect).toMatchObject({ try: 2 });
  });

  it("does not ask a third time a source that refused the same request twice running: the job ends failed with the reason", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    for (const wait of [10 * MIN, HOUR]) {
      const last = Math.max(Date.parse(w.week().finished_at), ...w.db.tables.report_pipeline_runs.map((r) => Date.parse(r.finished_at ?? "") || 0));
      w.clock.set(new Date(last + wait));
      const { outcomes } = await w.sweepAndRun();
      expect(outcomes[0].status).toBe("done");
      await w.drive(String(outcomes[0].result!.run_id));
    }
    expect(w.week().platforms.tiktok.fault).toMatchObject({ kind: "request", status: 400, tries: 2 });
    w.sources.calls.length = 0;
    // Six hours on, when a third try would have come: one last job, failed, and no run.
    w.clock.set(new Date(w.clock.now().getTime() + 6 * HOUR + MIN));
    const end = await w.sweepAndRun();
    expect(end.queued).toEqual([`trend_recollect:${w.week().id}:end`]);
    expect(end.outcomes[0]).toMatchObject({
      status: "failed", reason: "TikTok refused the app's request or its account 2 tries in a row, so it is not asked again this week and the week stays without it.",
      result: { sources: [{ platform: "tiktok", kind: "request", status: 400 }], recollect: { tries: 2, of: 6, platforms: ["tiktok"], ended: "refused", refused: ["tiktok"] } },
    });
    expect(w.db.tables.report_pipeline_runs).toHaveLength(3);
    // The rest of the day: nothing more is queued, started or asked.
    w.clock.set(new Date(w.clock.now().getTime() + 3 * HOUR));
    const jobs = w.db.tables.scheduled_jobs.length;
    await w.sweepAndRun();
    expect(w.db.tables.scheduled_jobs).toHaveLength(jobs);
    expect(w.sources.calls).toEqual([]);
  });

  it("goes on asking another source of the week, and a rebuild leaves the refused source's mark and absence as they were", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    w.sources.refuse.youtube = "Apify POST /acts/nfyn3ecod9uCDaoVH/runs answered 500: internal error";
    await w.collectWeek();
    for (const wait of [10 * MIN, HOUR]) {
      const last = Math.max(Date.parse(w.week().finished_at), ...w.db.tables.report_pipeline_runs.map((r) => Date.parse(r.finished_at ?? "") || 0));
      w.clock.set(new Date(last + wait));
      const { outcomes } = await w.sweepAndRun();
      expect(outcomes[0].result).toMatchObject({ recollect: { platforms: ["tiktok", "youtube"] } });
      await w.drive(String(outcomes[0].result!.run_id));
    }
    expect(w.week().platforms.tiktok.fault).toMatchObject({ kind: "request", tries: 2 });
    expect(w.week().platforms.youtube.fault).toMatchObject({ kind: "transient", tries: 2 });
    // The third try asks YouTube alone; it answers, and the week is written again.
    w.sources.refuse = { tiktok: REFUSED_INPUT };
    w.sources.calls.length = 0;
    w.clock.set(new Date(w.clock.now().getTime() + 6 * HOUR + MIN));
    const third = await w.sweepAndRun();
    expect(third.outcomes[0]).toMatchObject({ status: "done", reason: "YouTube is collected again for the week (try 3 of 6).", result: { recollect: { platforms: ["youtube"], refused: ["tiktok"] } } });
    expect((third.outcomes[0].result!.sources as Any[]).map((f) => [f.platform, f.kind])).toEqual([["youtube", "transient"], ["tiktok", "request"]]);
    const tryThree = String(third.outcomes[0].result!.run_id);
    await w.drive(tryThree);
    expect(new Set(w.sources.calls)).toEqual(new Set(["youtube"]));
    expect(w.week().platforms.youtube.status).toBe("ok");
    expect(w.week()).toMatchObject({ status: "partial" });
    expect(w.week().platforms.tiktok).toMatchObject({ status: "failed", fault: { kind: "request", status: 400, tries: 2 } });
    // Only the refused source is left: the next look queues one last job that says so, and nothing more is asked.
    const end = await w.sweepAndRun();
    expect(end.outcomes[0]).toMatchObject({ status: "failed", result: { recollect: { ended: "refused", platforms: ["tiktok"] } } });
    expect(new Set(w.sources.calls)).toEqual(new Set(["youtube"]));
  });

  it("keeps trying a source that fails in passing, however many tries in a row", async () => {
    const w = world();
    w.sources.refuse.tiktok = "Apify POST /acts/5K30i8aFccKNF5ICs/runs answered 503: upstream unavailable";
    await w.collectWeek();
    for (const wait of [10 * MIN, HOUR, 6 * HOUR]) {
      const last = Math.max(Date.parse(w.week().finished_at), ...w.db.tables.report_pipeline_runs.map((r) => Date.parse(r.finished_at ?? "") || 0));
      w.clock.set(new Date(last + wait));
      const { outcomes } = await w.sweepAndRun();
      expect(outcomes[0]).toMatchObject({ status: "done", result: { started: true } });
      await w.drive(String(outcomes[0].result!.run_id));
    }
    expect(w.week().platforms.tiktok.fault).toMatchObject({ kind: "transient", status: 503, tries: 3 });
    expect(w.db.tables.report_pipeline_runs).toHaveLength(4);
  });

  it("records a refused account for one source (401) as a credentials fact", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    const first = await w.collectWeek();
    // The run kept a 401 for the source, as the weeks of 12 Nov did.
    await makePayloadStore(w.db, first).put("source.tiktok.0.failed", { message: REFUSED_TOKEN });
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    const { outcomes } = await w.sweepAndRun();
    expect(outcomes[0].result!.sources).toEqual([{ platform: "tiktok", kind: "credentials", status: 401, message: expect.stringContaining("authentication token") }]);
  });

  it("goes on collecting when the earlier answer cannot be read for the record, and says so in the job's result", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    const first = await w.collectWeek();
    // The failed source's kept words are in the index, and storage does not hand them over (every try of the read).
    const storage = w.db.storage;
    let failed = 0;
    w.db.storage = {
      from: (bucket: string) => {
        const real = storage.from(bucket);
        return { ...real, download: async (at: string) => (at.endsWith(`runs/${first}/source.tiktok.0.failed.json`) ? (failed++, { data: null, error: { message: "Object not found", status: 404 } }) : real.download(at)) };
      },
    };
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    w.sources.refuse = {};
    w.sources.calls.length = 0;
    const { queued, outcomes } = await w.sweepAndRun();
    expect(queued).toHaveLength(1);
    expect(failed).toBeGreaterThan(0);
    // The job did its work: the run started, and the record says in plain words what it could not read.
    expect(outcomes[0]).toMatchObject({ status: "done", reason: "TikTok is collected again for the week (try 1 of 6).", result: { started: true, recollect: { try: 1, platforms: ["tiktok"] } } });
    expect(outcomes[0].result!.sources).toEqual([{ platform: "tiktok", kind: "transient", status: null, message: EARLIER_ANSWER_UNREAD, unread: true }]);
    expect(EARLIER_ANSWER_UNREAD).toBe("The earlier answer could not be read.");
    // TikTok is asked for real, so its unreadable old mark is never needed: the week heals.
    await w.drive(String(outcomes[0].result!.run_id));
    expect(w.sources.calls).toEqual(["tiktok"]);
    expect(w.week()).toMatchObject({ status: "done" });
    expect(w.week().platforms.tiktok.status).toBe("ok");
  });

  it("still fails the job, to be tried again, when what the week's run kept cannot be listed at all", async () => {
    const w = world();
    w.sources.refuse.tiktok = REFUSED_INPUT;
    await w.collectWeek();
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    await queueSourceRecollects(w.db, w.clock.now());
    const job = w.db.tables.scheduled_jobs.find((j) => j.kind === "trend_refresh" && j.payload?.recollect) as ScheduledJob;
    // Any other error than an unread payload is not passed over: here the index itself does not answer.
    const from = w.db.from.bind(w.db);
    w.db.from = (table: string) => (table === "pipeline_payloads" ? { select: () => ({ eq: async () => ({ data: null, error: { message: "connection reset" } }) }) } : from(table));
    await expect(runTrendJob(w.db, job, w.clock.now())).rejects.toThrow("Could not read what the week's run kept: connection reset");
    expect(w.db.tables.report_pipeline_runs).toHaveLength(1);
  });

  it("records a source that only failed in passing as transient", async () => {
    const w = world();
    w.sources.refuse.tiktok = "Apify POST /acts/5K30i8aFccKNF5ICs/runs answered 503: upstream unavailable";
    await w.collectWeek();
    w.clock.set(new Date(Date.parse(w.week().finished_at) + 10 * MIN));
    const { outcomes } = await w.sweepAndRun();
    expect(outcomes[0].status).toBe("done");
    expect(outcomes[0].result!.sources).toMatchObject([{ platform: "tiktok", kind: "transient", status: 503 }]);
  });

  it("ends a job failed, once per week, when the week's run is waiting for the collecting account", async () => {
    const w = world();
    w.clock.set(new Date(MONDAY));
    w.db.tables.clients.push({ id: "c2", name: "Pinehollow Bikes", archived_at: null, exclude_from_reporting: false, demo_job_id: null });
    w.db.tables.trend_weeks.push(
      { id: "wa", client_id: "c1", week_start: WEEK, status: "running", platforms: {}, finished_at: null },
      { id: "wb", client_id: "c2", week_start: WEEK, status: "running", platforms: {}, finished_at: null },
    );
    w.db.tables.scheduled_jobs = [
      { id: "pa", kind: "report_pipeline", client_id: "c1", status: "queued", payload: { run_id: "ra", pipeline: TRENDS_PIPELINE, step: "scrape_tiktok", state: {}, paused_for: "APIFY_API_TOKEN", paused_at: MONDAY } },
      { id: "pb", kind: "report_pipeline", client_id: "c2", status: "queued", payload: { run_id: "rb", pipeline: TRENDS_PIPELINE, step: "scrape_tiktok", state: {}, paused_for: "APIFY_API_TOKEN", paused_at: MONDAY } },
    ];
    w.db.tables.report_pipeline_runs = [
      { id: "ra", real_id: "wa", status: "running", input: { week_start: WEEK }, job_id: "pa", started_at: MONDAY, finished_at: null, outcome: null },
      { id: "rb", real_id: "wb", status: "running", input: { week_start: WEEK }, job_id: "pb", started_at: MONDAY, finished_at: null, outcome: null },
    ];
    const { queued, outcomes } = await w.sweepAndRun();
    expect(queued).toEqual(["trend_recollect:wa:account", "trend_recollect:wb:account"]);
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "failed"]);
    expect(outcomes[0].result).toEqual({ week_id: "wa", week_start: WEEK, run_id: "ra", waiting_for: "APIFY_API_TOKEN", kind: "credentials" });
    expect(outcomes[0].reason).toMatch(/waiting for APIFY_API_TOKEN: the collecting account is not set or was refused/);
    expect(outcomes[1].result).toMatchObject({ week_id: "wb", kind: "credentials" });
    // Each week is noted once: the sweep's next looks add no job.
    const jobs = w.db.tables.scheduled_jobs.length;
    await queueSourceRecollects(w.db, new Date(Date.parse(MONDAY) + HOUR));
    expect(w.db.tables.scheduled_jobs).toHaveLength(jobs);
    // A run that is only waiting for its source, not for the account, is left alone.
    w.db.tables.scheduled_jobs[0].payload = { run_id: "ra", pipeline: TRENDS_PIPELINE, step: "scrape_tiktok", state: {} };
    w.db.tables.scheduled_jobs = w.db.tables.scheduled_jobs.filter((j) => j.kind === "report_pipeline");
    expect(await queueSourceRecollects(w.db, new Date(Date.parse(MONDAY) + HOUR))).toEqual(["trend_recollect:wb:account"]);
  });
});

describe("the rule, from what is stored", () => {
  const SAVED = "2026-11-16T07:30:00.000Z";
  const week = (over: Partial<TrendWeekRow> = {}): TrendWeekRow => ({
    id: "w1", client_id: "c1", week_start: WEEK, status: "partial", finished_at: SAVED,
    platforms: { tiktok: { status: "failed" }, instagram: { status: "ok" }, linkedin: { status: "not_watched" } }, ...over,
  });
  const done = (id: string, finished = SAVED, input: Record<string, unknown> = { week_start: WEEK }): TrendRunRow => ({ id, status: "done", input, started_at: finished, finished_at: finished, outcome: null });
  const tryRun = (n: number, finished: string, status = "done"): TrendRunRow => ({ ...done(`try-${n}`, finished, { week_start: WEEK, recollect: { platforms: ["tiktok"], try: n } }), status });
  const at = (iso: string) => new Date(iso);

  it("waits ten minutes, an hour, six hours, then a day between tries, each from the end of the last", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => recollectWaitMs(n) / MIN)).toEqual([10, 60, 360, 1440, 1440, 1440]);
    const runs = [done("run-1")];
    expect(recollectDecision(week(), runs, at("2026-11-16T07:39:59.000Z"))).toMatchObject({ act: "none", why: expect.stringContaining("2026-11-16T07:40:00.000Z") });
    expect(recollectDecision(week(), runs, at("2026-11-16T07:40:00.000Z"))).toEqual({ act: "collect", try: 1, platforms: ["tiktok"], fromRun: "run-1", refused: [] });
    // After two tries that brought nothing, the third comes six hours after the second ended.
    const two = [...runs, tryRun(1, "2026-11-16T07:45:00.000Z"), tryRun(2, "2026-11-16T08:50:00.000Z")];
    expect(recollectDecision(week(), two, at("2026-11-16T14:49:00.000Z")).act).toBe("none");
    expect(recollectDecision(week(), two, at("2026-11-16T14:50:00.000Z"))).toEqual({ act: "collect", try: 3, platforms: ["tiktok"], fromRun: "try-2", refused: [] });
  });

  it("bounds the tries: after six the week is left as it is", () => {
    const runs = [done("run-1"), ...[1, 2, 3, 4, 5, 6].map((n) => tryRun(n, `2026-11-${16 + Math.min(n, 4)}T09:00:00.000Z`, n === 3 ? "stopped" : "done"))];
    expect(RECOLLECTS_PER_WEEK).toBe(6);
    expect(recollectDecision(week(), runs, at("2026-11-21T09:00:00.000Z"))).toEqual({ act: "end", why: "tries", tries: 6, platforms: ["tiktok"] });
    // Five used: one is left.
    expect(recollectDecision(week(), runs.slice(0, 6), at("2026-11-21T09:00:00.000Z"))).toMatchObject({ act: "collect", try: 6 });
  });

  it("never collects a week that is done, still running, over, or without a failed source", () => {
    const runs = [done("run-1")];
    const later = at("2026-11-17T09:00:00.000Z");
    expect(recollectDecision(week({ status: "done", platforms: { tiktok: { status: "ok" } } }), runs, later)).toMatchObject({ act: "none", why: expect.stringMatching(/every source/i) });
    expect(recollectDecision(week({ status: "running" }), runs, later).act).toBe("none");
    // Partial for another reason (the filter failed): no source failed, so no source is asked.
    expect(recollectDecision(week({ platforms: { tiktok: { status: "ok" }, instagram: { status: "empty" } } }), runs, later)).toMatchObject({ act: "none", why: expect.stringMatching(/no source/i) });
    // Closed with nothing saved: no source's state is known.
    expect(recollectDecision(week({ platforms: {} }), [], later).act).toBe("none");
    // Monday 23 Nov, Israel time: the week of 16 Nov is over.
    expect(recollectDecision(week(), runs, at("2026-11-22T22:30:00.000Z"))).toMatchObject({ act: "none", why: expect.stringMatching(/week is over/i) });
    expect(recollectDecision(week(), runs, at("2026-11-22T21:30:00.000Z")).act).toBe("collect");
  });

  it("stops asking a source that refused the request or the account two tries running, and keeps asking through a passing fault", () => {
    expect(REFUSALS_BEFORE_STOP).toBe(2);
    const runs = [done("run-1"), tryRun(1, "2026-11-16T07:45:00.000Z"), tryRun(2, "2026-11-16T08:50:00.000Z")];
    const later = at("2026-11-17T09:00:00.000Z");
    const marked = (fault: unknown, more: Record<string, unknown> = {}) => week({ platforms: { tiktok: { status: "failed", fault }, instagram: { status: "ok" }, ...more } });
    // Refused twice running: the source is not asked a third time, with four tries unused.
    for (const kind of ["request", "credentials"]) {
      expect(refusedSources(marked({ kind, status: 400, tries: 2 }).platforms)).toEqual(["tiktok"]);
      expect(recollectDecision(marked({ kind, status: 400, tries: 2 }), runs, later)).toEqual({ act: "end", why: "refused", tries: 2, platforms: ["tiktok"] });
    }
    // Refused once, or failing in passing however often: asked again.
    expect(recollectDecision(marked({ kind: "request", status: 400, tries: 1 }), runs, later)).toMatchObject({ act: "collect", try: 3, refused: [] });
    expect(recollectDecision(marked({ kind: "transient", status: 503, tries: 5 }), runs, later)).toMatchObject({ act: "collect", try: 3, refused: [] });
    // A week saved before faults were marked: asked as before.
    expect(recollectDecision(week(), runs, later)).toMatchObject({ act: "collect", try: 3 });
    // Another source of the week that may still answer is asked alone.
    expect(recollectDecision(marked({ kind: "request", status: 400, tries: 2 }, { youtube: { status: "failed", fault: { kind: "transient", status: 500, tries: 2 } } }), runs, later))
      .toEqual({ act: "collect", try: 3, platforms: ["youtube"], fromRun: "try-2", refused: ["tiktok"] });
    // A source that answered since is no longer counted, whatever mark it had.
    expect(refusedSources({ tiktok: { status: "empty", fault: { kind: "request", tries: 3 } } })).toEqual([]);
  });

  it("counts a fault's tries in a row: one more of the same kind, the first of another, none on the weekly collection, and once per run", () => {
    const request = { kind: "request" as const, status: 400 };
    expect(nextFault(undefined, request, false, "weekly")).toEqual({ kind: "request", status: 400, tries: 0, by: "weekly" });
    const one = nextFault({ kind: "request", status: 400, tries: 0, by: "weekly" }, request, true, "try-1");
    expect(one).toEqual({ kind: "request", status: 400, tries: 1, by: "try-1" });
    // The same run's step tried again adds nothing.
    expect(nextFault(one, request, true, "try-1")).toBe(one);
    expect(nextFault(one, request, true, "try-2").tries).toBe(2);
    expect(nextFault(one, { kind: "credentials", status: 401 }, true, "try-2")).toEqual({ kind: "credentials", status: 401, tries: 1, by: "try-2" });
    expect(nextFault(one, { kind: "transient", status: 503 }, true, "try-2").tries).toBe(1);
    // A source whose fault was not read is taken as passing.
    expect(nextFault(undefined, undefined, true, "try-1")).toEqual({ kind: "transient", status: null, tries: 1, by: "try-1" });
  });

  it("starts nothing while a run of the week is going, and needs a finished run to start from", () => {
    const going: TrendRunRow = { ...tryRun(1, SAVED), status: "running", finished_at: null };
    expect(recollectDecision(week(), [done("run-1"), going], at("2026-11-18T09:00:00.000Z"))).toMatchObject({ act: "none", why: expect.stringMatching(/under way/i) });
    expect(recollectDecision(week(), [], at("2026-11-18T09:00:00.000Z"))).toMatchObject({ act: "none", why: expect.stringMatching(/start from/i) });
  });

  it("names a week as the Trends screen does, so the screen's line about this week is about the week collected", () => {
    // Around Monday in Israel, in winter and in summer time, and across a year's end.
    for (const moment of ["2026-11-17T09:00:00Z", "2026-11-15T21:59:00Z", "2026-11-15T22:00:00Z", "2026-11-22T21:59:59Z", "2026-07-05T20:59:00Z", "2026-07-05T21:00:00Z", "2026-03-29T21:30:00Z", "2026-12-31T23:30:00Z"]) {
      expect(trendWeekOf(new Date(moment)), moment).toBe(weekStartOf(new Date(moment)));
    }
  });

  it("runs the sweep on every fifth minute", () => {
    expect(RECOLLECT_SWEEP_MINUTES).toBe(5);
    expect([0, 1, 4, 5, 10, 59].map((m) => recollectSweepDue(new Date(Date.UTC(2026, 10, 16, 7, m, 3))))).toEqual([true, false, false, true, true, false]);
  });
});

describe("the sweep and the job it queues", () => {
  const seed = (weeks: Any[], runs: Any[], extra: Record<string, Any[]> = {}) => pipelineDb({
    clients: ["c1", "c2", "c3"].map((id) => ({ id, name: id, archived_at: id === "c3" ? "2026-11-01T00:00:00Z" : null, exclude_from_reporting: false, demo_job_id: null })),
    trend_profiles: [{ client_id: "c1" }, { client_id: "c2" }, { client_id: "c3" }],
    trend_weeks: weeks, report_pipeline_runs: runs, scheduled_jobs: [], ...extra,
  }, () => new Date(MONDAY));
  const partial = (id: string, client: string, over: Any = {}) => ({ id, client_id: client, week_start: WEEK, status: "partial", finished_at: MONDAY, platforms: { tiktok: { status: "failed" }, youtube: { status: "failed" }, instagram: { status: "ok" } }, ...over });
  const firstRun = (id: string, weekId: string) => ({ id, real_id: weekId, status: "done", input: { week_start: WEEK }, started_at: MONDAY, finished_at: MONDAY, outcome: null, job_id: null });
  const tries = (weekId: string, n: number) => Array.from({ length: n }, (_, i) => ({
    ...firstRun(`${weekId}-try-${i + 1}`, weekId), input: { week_start: WEEK, recollect: { platforms: ["tiktok"], try: i + 1 } },
    finished_at: new Date(Date.parse(MONDAY) + (i + 1) * HOUR).toISOString(),
  }));
  const later = new Date(Date.parse(MONDAY) + 2 * DAY);

  it("queues one job per week whose try has come, and the same look again adds none", async () => {
    const db = seed([partial("w1", "c1"), partial("w2", "c2", { status: "done" }), partial("w3", "c2", { week_start: "2026-11-09" })], [firstRun("r1", "w1"), firstRun("r2", "w2")]);
    expect(await queueSourceRecollects(db, later)).toEqual(["trend_recollect:w1:1:2026-11-18"]);
    expect(db.tables.scheduled_jobs).toEqual([expect.objectContaining({ kind: "trend_refresh", client_id: "c1", dedupe_key: "trend_recollect:w1:1:2026-11-18", payload: { recollect: { week_id: "w1" } }, available_at: later.toISOString() })]);
    await queueSourceRecollects(db, new Date(later.getTime() + 5 * MIN));
    expect(db.tables.scheduled_jobs).toHaveLength(1);
  });

  it("asks every failed source of the week in one run, and one run per try however often the job runs", async () => {
    const db = seed([partial("w1", "c1")], [firstRun("r1", "w1")]);
    await queueSourceRecollects(db, later);
    const job = db.tables.scheduled_jobs[0] as ScheduledJob;
    const out = await runTrendJob(db, job, later);
    expect(out).toMatchObject({ status: "done", reason: "TikTok and YouTube are collected again for the week (try 1 of 6).", result: { started: true, recollect: { platforms: ["tiktok", "youtube"] } } });
    expect(recollectOf(db.tables.report_pipeline_runs.at(-1)!)).toEqual({ platforms: ["tiktok", "youtube"], try: 1 });
    // The same job again, while its run is going: nothing more starts.
    const again = await runTrendJob(db, job, later);
    expect(again).toMatchObject({ status: "skipped", reason: expect.stringMatching(/under way/i) });
    expect(db.tables.report_pipeline_runs).toHaveLength(2);
  });

  it("ends failed, once, when the tries are used up, naming what the source last said", async () => {
    const db = seed([partial("w1", "c1", { platforms: { tiktok: { status: "failed" }, instagram: { status: "ok" } } })], [firstRun("r1", "w1"), ...tries("w1", RECOLLECTS_PER_WEEK)]);
    await makePayloadStore(db, `w1-try-${RECOLLECTS_PER_WEEK}`).put("source.tiktok.0.failed", { message: REFUSED_INPUT });
    expect(await queueSourceRecollects(db, later)).toEqual(["trend_recollect:w1:end"]);
    const out = await runTrendJob(db, db.tables.scheduled_jobs[0] as ScheduledJob, later);
    expect(out).toMatchObject({
      status: "failed", reason: "TikTok did not answer in 6 more tries, so the week stays without it.",
      result: { recollect: { tries: 6, of: 6, ended: "tries" }, sources: [{ platform: "tiktok", kind: "request", status: 400 }] },
    });
    expect(db.tables.report_pipeline_runs).toHaveLength(1 + RECOLLECTS_PER_WEEK);
    await queueSourceRecollects(db, new Date(later.getTime() + DAY));
    expect(db.tables.scheduled_jobs).toHaveLength(1);
  });

  it("collects nothing for a client that is no longer active, or a week that is gone", async () => {
    const db = seed([partial("w3", "c3")], [firstRun("r3", "w3")]);
    await queueSourceRecollects(db, later);
    const out = await runTrendJob(db, db.tables.scheduled_jobs[0] as ScheduledJob, later);
    expect(out).toMatchObject({ status: "skipped", reason: expect.stringMatching(/not an active client/i) });
    const gone = await runTrendJob(db, { id: "j", kind: "trend_refresh", client_id: "c1", attempts: 1, payload: { recollect: { week_id: "nope" } } } as unknown as ScheduledJob, later);
    expect(gone.status).toBe("skipped");
    expect(db.tables.report_pipeline_runs).toHaveLength(1);
  });

  it("asks only the failed sources the client still watches", async () => {
    const db = seed([partial("w1", "c1"), partial("w2", "c2")], [firstRun("r1", "w1"), firstRun("r2", "w2")]);
    db.tables.trend_profiles[0].platforms = [{ platform: "youtube", reason: "r" }, { platform: "instagram", reason: "r" }];
    db.tables.trend_profiles[1].platforms = [{ platform: "instagram", reason: "r" }];
    await queueSourceRecollects(db, later);
    const [one, two] = db.tables.scheduled_jobs as ScheduledJob[];
    expect(await runTrendJob(db, one, later)).toMatchObject({ status: "done", reason: "YouTube is collected again for the week (try 1 of 6).", result: { recollect: { platforms: ["youtube"] } } });
    expect(await runTrendJob(db, two, later)).toMatchObject({ status: "skipped", reason: "The client no longer watches TikTok and YouTube, so nothing is collected again." });
    expect(db.tables.report_pipeline_runs).toHaveLength(3);
  });

  it("tells the weekly job that a week saved without a source is not started over", async () => {
    const db = seed([partial("w1", "c1", { platforms: { tiktok: { status: "failed" }, instagram: { status: "ok" } } })], [firstRun("r1", "w1")]);
    const out = await startTrendWeek(db, "c1", new Date(MONDAY));
    expect(out).toEqual({ skipped: "This week's trends are collected except TikTok, which the app collects again on its own." });
    expect(db.tables.report_pipeline_runs).toHaveLength(1);
  });
});

describe("the run trends_v1 knows by its input", () => {
  it("reads which sources a run collects again, and takes any other run as it is", () => {
    expect(recollectOf({ input: { week_start: WEEK, replay: { from_run: "r1" }, recollect: { platforms: ["youtube", "tiktok", "not-a-platform"], try: 3 } } })).toEqual({ platforms: ["tiktok", "youtube"], try: 3 });
    expect(recollectOf({ input: { week_start: WEEK } })).toBeNull();
    expect(recollectOf({ input: { week_start: WEEK, replay: { from_run: "r1" } } })).toBeNull();
    expect(recollectOf({ input: { recollect: { platforms: [] } } })).toBeNull();
    expect(recollectOf({ input: { recollect: { platforms: "tiktok" } } })).toBeNull();
  });

  it("adds a try's cost to the week's once, however often its save is tried", () => {
    const before = { apify_usd: 0.05, claude: { sonnet: { input_tokens: 1000, output_tokens: 200 } }, replayed_from: "old" };
    const once = addCost(before, { apify_usd: 0.01, claude: { sonnet: { input_tokens: 500, output_tokens: 50 }, opus: { input_tokens: 10, output_tokens: 5 } } }, "try-1");
    expect(once).toEqual({ apify_usd: 0.06, claude: { sonnet: { input_tokens: 1500, output_tokens: 250 }, opus: { input_tokens: 10, output_tokens: 5 } }, recollected_by: "try-1" });
    expect(addCost(once, { apify_usd: 0.01, claude: {} }, "try-1")).toBe(once);
    expect(addCost(once, { apify_usd: 0.02, claude: {} }, "try-2").apify_usd).toBe(0.08);
  });
});
