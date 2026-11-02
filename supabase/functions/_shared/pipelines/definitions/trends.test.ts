// @vitest-environment node
// trends_v1, the weekly industry-trends collection (spec sections 2 to 5),
// driven through the real step runner and stores with the six sources
// answering from the recorded fixtures and Claude answering from the request.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ApifyClient } from "../../apify/client";
import { makeRegistry } from "../registry";
import { startPipelineRun } from "../store";
import { drivePipeline, pipelineDb, testClock } from "../testDriver";
import { TREND_SOURCES } from "../../trends/sources";
import { TREND_PLATFORMS, type TrendPlatform } from "../../trends/types";
import { TRENDS_PIPELINE, trendsPipeline, type TrendsDeps } from "./trends";

// deno-lint-ignore no-explicit-any
type Any = any;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p: TrendPlatform): Any[] => JSON.parse(readFileSync(join(here, "..", "..", "trends", "fixtures", `${p}.json`), "utf8"));
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];
const NOW = "2026-11-01T10:00:00.000Z";

/** The six actors, answering with the recorded rows. */
type ApifyOptions = { fail?: TrendPlatform; answers?: Partial<Record<TrendPlatform, Any[][]>>; inputs?: Array<{ platform: TrendPlatform; input: Any }> };
function apify(calls: TrendPlatform[], o: ApifyOptions = {}): TrendsDeps["apify"] {
  const byActor = Object.fromEntries(TREND_PLATFORMS.map((p) => [TREND_SOURCES[p].actor.id, p])) as Record<string, TrendPlatform>;
  const runs: Record<string, { platform: TrendPlatform; rows: Any[] }> = {};
  const queued = Object.fromEntries(Object.entries(o.answers ?? {}).map(([k, v]) => [k, [...(v ?? [])]])) as Partial<Record<TrendPlatform, Any[][]>>;
  const client: ApifyClient = {
    async startRun(actorId, input) {
      const platform = byActor[actorId];
      calls.push(platform);
      o.inputs?.push({ platform, input });
      const id = `r${calls.length}`;
      runs[id] = { platform, rows: queued[platform]?.shift() ?? fixture(platform) };
      return { id, status: "RUNNING", defaultDatasetId: `ds-${id}` };
    },
    async getRun(id) {
      return { id, status: o.fail === runs[id].platform ? "FAILED" : "SUCCEEDED", defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.01 };
    },
    async datasetPage() { return []; },
    async datasetItems(datasetId) { return runs[datasetId.slice(3)].rows; },
  };
  return () => client;
}

/** Claude's Message Batches, answering the filter and the themes from what each request lists, and a search rewrite with the answers given (in order). */
type ClaudeOptions = { badFilter?: boolean; failFilter?: boolean; rewrite?: unknown[]; failRewrite?: boolean; onRewrite?: () => void };
const REWRITTEN = ["mobile app growth", "app store optimization"];
function claude(requests: Any[], o: ClaudeOptions = {}) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)).requests[0]);
      return new Response(JSON.stringify({ id: `batch-${requests.length}` }));
    }
    const n = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
    const req = requests[n - 1];
    if (!url.endsWith("/results")) return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${n}/results` }));
    const prompt = String(req.params.messages[0].content);
    const errored = new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "errored", error: { type: "overloaded_error" } } }) + "\n");
    if (o.failFilter && String(req.custom_id).includes("filter")) return errored;
    if (o.failRewrite && String(req.custom_id).includes("rewrite")) return errored;
    let answer: unknown;
    if (String(req.custom_id).includes("rewrite")) {
      const nth = requests.slice(0, n).filter((q) => String(q.custom_id).includes("rewrite")).length - 1;
      o.onRewrite?.();
      answer = o.rewrite?.[nth] ?? { searches: REWRITTEN };
    } else if (String(req.custom_id).includes("filter")) {
      const ids = [...prompt.matchAll(/<post id="P(\d+)">\n(\w+) \|/g)].map((m) => ({ id: `P${m[1]}`, platform: m[2] }));
      answer = o.badFilter ? { decisions: [] } : { decisions: ids.map((x, i) => ({ id: x.id, keep: true, fit: 70 + (i % 30), why: "w", format: x.platform === "pinterest" ? "pin" : "short_video", lesson: "l" })) };
    } else {
      const ids = [...prompt.matchAll(/<post id="K(\d+)">/g)].map((m) => `K${m[1]}`);
      answer = { themes: ["One", "Two", "Three"].map((title, i) => ({ title, happening: "h", why_it_matters: "w", angle: "a", post_ids: [ids[i % ids.length]] })) };
    }
    const message = { content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } };
    return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "succeeded", message } }) + "\n");
  };
}

const ALL = TREND_PLATFORMS.map((platform) => ({ platform, reason: "watched" }));

/** Weeks finished before the run's own, with what each platform kept. */
type SetupOptions = { language?: string; platforms?: Array<{ platform: string; reason: string }>; noInstagramTags?: boolean; handles?: boolean; prior?: Any[]; writtenAt?: string; hashtagsAt?: string; personTopic?: boolean; removedTopic?: boolean; overrides?: Record<string, string[]> };
const EARLY = "2026-10-01T00:00:00.000Z";
const tally = (kept: Partial<Record<TrendPlatform, number>>) => Object.fromEntries(TREND_PLATFORMS.map((p) => [p, { status: "ok", searched: 2, rows: 40, candidates: 20, kept: kept[p] ?? 8 }]));
const finished = (id: string, week_start: string, kept: Partial<Record<TrendPlatform, number>>) => ({ id, client_id: "c1", week_start, status: "done", filter_status: "ok", platforms: tally(kept), cost: {}, created_at: `${week_start}T09:00:00.000Z` });
/** TikTok kept 2, then 1, in the two weeks before the run's. */
const SHORT_TIKTOK = [finished("w-2", "2026-10-12", { tiktok: 2 }), finished("w-1", "2026-10-19", { tiktok: 1 })];

function setup(o: SetupOptions = {}) {
  const clock = testClock(NOW);
  const db = pipelineDb({
    clients: [{ id: "c1", name: "Moburst", geo: "US", language: o.language ?? "en", location: null }],
    trend_profiles: [{ client_id: "c1", audience: "App founders", fit_rubric: "Posts that teach app growth.", platforms: o.platforms ?? ALL, search_overrides: o.overrides ?? {}, inputs_key: "k", written_at: o.writtenAt ?? NOW, hashtags_at: o.hashtagsAt ?? o.writtenAt ?? NOW }],
    trend_terms: [
      { id: "t1", client_id: "c1", kind: "topic", platform: null, term: "app marketing", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t2", client_id: "c1", kind: "topic", platform: null, term: "marketing tips", reason: "r", source: "lifecycle", removed_at: null },
      ...(o.noInstagramTags ? [] : [{ id: "t3", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#stopchasingstartplaying", reason: "r", source: "lifecycle", removed_at: null }]),
      { id: "t4", client_id: "c1", kind: "exclusion", platform: null, term: "fake reviews", reason: "r", source: "dismissal", removed_at: null },
      ...(o.personTopic ? [{ id: "t5", client_id: "c1", kind: "topic", platform: null, term: "mobile game UA", reason: "", source: "person", removed_at: null }] : []),
      ...(o.removedTopic ? [{ id: "t6", client_id: "c1", kind: "topic", platform: null, term: "app store optimization", reason: "r", source: "lifecycle", removed_at: "2026-10-20T08:00:00.000Z" }] : []),
    ],
    sprout_profiles: o.handles ? [{ id: "s1", client_id: "c1", native_name: "techdropp", profile_name: "Tech Drop", is_active: true }] : [],
    competitor_handles: o.handles ? [{ id: "h1", client_id: "c1", handle: "ahmed-dawood", display_name: "Kehinde Dawood MBA", is_active: true }] : [],
    trend_weeks: [
      ...(o.prior ?? []),
      { id: "w1", client_id: "c1", week_start: "2026-10-26", status: "running", platforms: {}, cost: {}, created_at: "2026-10-26T09:00:00.000Z" },
      { id: "w2", client_id: "c1", week_start: "2026-11-02", status: "running", platforms: {}, cost: {}, created_at: "2026-11-02T09:00:00.000Z" },
    ],
  }, () => clock.now());
  return { clock, db };
}

async function run(o: SetupOptions & ClaudeOptions & { deps?: Partial<TrendsDeps>; fail?: TrendPlatform; answers?: ApifyOptions["answers"]; refreshMidRun?: boolean } = {}) {
  const { clock, db } = setup(o);
  const calls: TrendPlatform[] = [];
  const requests: Any[] = [];
  const inputs: Array<{ platform: TrendPlatform; input: Any }> = [];
  // The monthly hashtag refresh lands while Claude is rewriting, after the run read the profile.
  const onRewrite = o.refreshMidRun ? () => { db.tables.trend_profiles[0].hashtags_at = "2026-11-01T09:30:00.000Z"; } : o.onRewrite;
  const pipeline = trendsPipeline({ apify: apify(calls, { fail: o.fail, answers: o.answers, inputs }), claudeFetch: claude(requests, { ...o, onRewrite }), ...o.deps });
  const registry = makeRegistry([pipeline], () => true);
  const { run_id } = await startPipelineRun(db, { mode: "app", pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w1", input: { week_start: "2026-10-26" }, dedupe: "trends:c1:2026-10-26" });
  const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
  const week = db.tables.trend_weeks.find((w) => w.id === "w1")!;
  const posts = (db.tables.trend_posts ?? []).filter((p) => p.week_id === "w1");
  const themes = (db.tables.trend_themes ?? []).filter((t) => t.week_id === "w1");
  return { db, clock, run_id, driven, week, posts, themes, calls, requests, inputs, pipeline, registry };
}

describe("trends_v1", () => {
  it("is the app-only trends pipeline", () => {
    const p = trendsPipeline();
    expect(TRENDS_PIPELINE).toBe("trends_v1");
    expect(p).toMatchObject({ name: "trends_v1", kind: "trends", modes: ["app"], appCapable: true });
  });

  it("collects six platforms, keeps at most 10 each, writes 3 to 6 themes and the measured cost", async () => {
    const r = await run();
    expect(r.driven.outcome.status).toBe("done");
    expect(new Set(r.calls)).toEqual(new Set(TREND_PLATFORMS));
    expect(r.week.status).toBe("done");
    expect(r.week.filter_status).toBe("ok");
    expect(Object.keys(r.week.platforms).sort()).toEqual([...TREND_PLATFORMS].sort());
    const kept = r.posts.filter((p) => p.kept);
    expect(kept.length).toBeGreaterThan(0);
    for (const platform of TREND_PLATFORMS) expect(kept.filter((p) => p.platform === platform).length).toBeLessThanOrEqual(10);
    // Every post the week looked at is stored, kept or dropped with a reason.
    expect(r.posts.filter((p) => !p.kept).every((p) => p.drop_reason)).toBe(true);
    // A Latin-script post in another language (the Spanish TikTok) goes on to Claude; only another script is cut by the rules.
    expect(r.posts.find((p) => p.author === "monetiza_con_yanet")!.drop_reason).not.toBe("language");
    expect(r.themes.length).toBeGreaterThanOrEqual(3);
    expect(r.themes.length).toBeLessThanOrEqual(6);
    expect(r.themes.every((t) => t.post_ids.length > 0 && t.post_ids.every((id: string) => kept.some((p) => p.id === id)))).toBe(true);
    expect(r.week.cost.apify_usd).toBeCloseTo(r.calls.length * 0.01, 5);
    expect(r.week.cost.claude["claude-sonnet-5-5"]).toEqual({ input_tokens: 1000, output_tokens: 200 });
    expect(r.week.cost.claude["claude-opus-5-5"]).toEqual({ input_tokens: 1000, output_tokens: 200 });
    // The filter was told what the brand never wants.
    expect(String(r.requests[0].params.messages[0].content)).toContain("fake reviews");
  });

  it("finishes the week without LinkedIn when its scraper fails twice", async () => {
    const r = await run({ fail: "linkedin" });
    expect(r.driven.outcome.status).toBe("done");
    expect(r.week.status).toBe("partial");
    expect(r.week.platforms.linkedin.status).toBe("failed");
    expect(r.posts.some((p) => p.platform === "linkedin")).toBe(false);
    expect(r.posts.some((p) => p.kept && p.platform === "tiktok")).toBe(true);
  });

  it("re-asks once when the filter answer is wrong, then stores every candidate with nothing kept", async () => {
    const r = await run({ badFilter: true });
    expect(r.driven.outcome.status).toBe("done");
    expect(r.requests.filter((q) => String(q.custom_id).includes("filter"))).toHaveLength(2);
    expect(r.requests.some((q) => String(q.custom_id).includes("themes"))).toBe(false);
    expect(r.week).toMatchObject({ status: "partial", filter_status: "failed" });
    expect(r.posts.length).toBeGreaterThan(0);
    expect(r.posts.some((p) => p.kept)).toBe(false);
    expect(r.themes).toHaveLength(0);
  });

  it("never calls a source the client doesn't watch", async () => {
    const r = await run({ platforms: [{ platform: "instagram", reason: "r" }, { platform: "facebook", reason: "r" }] });
    expect(new Set(r.calls)).toEqual(new Set(["instagram", "facebook"]));
    expect(r.calls.filter((c) => c === "facebook")).toHaveLength(2);
    expect(r.week.platforms.tiktok.status).toBe("not_watched");
  });

  it("replays a week from its kept answers without calling Apify", async () => {
    const r = await run();
    const before = r.calls.length;
    // A week later: the replay still reads the original week's window and searches.
    r.clock.set(new Date(Date.parse(NOW) + 8 * 86_400_000));
    r.db.tables.trend_terms = r.db.tables.trend_terms.filter((t) => t.kind !== "topic");
    const { run_id } = await startPipelineRun(r.db, { mode: "app", pipeline: r.pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w2", input: { week_start: "2026-11-02", replay: { from_run: r.run_id } }, dedupe: "trends:c1:replay" });
    const replay = await drivePipeline(r.db, r.registry, run_id, { clock: r.clock, env: ENV });
    expect(replay.outcome.status).toBe("done");
    expect(r.calls.length).toBe(before);
    const replayedWeek = r.db.tables.trend_weeks.find((w) => w.id === "w2")!;
    // The replay scraped nothing; the week keeps the scraping cost of the run it replays.
    expect(replayedWeek.cost.apify_usd).toBeCloseTo(r.week.cost.apify_usd, 5);
    expect(replayedWeek.cost.replayed_from).toBe(r.run_id);
    const keptAgain = r.db.tables.trend_posts.filter((p) => p.week_id === "w2" && p.kept).length;
    expect(keptAgain).toBe(r.posts.filter((p) => p.kept).length);
  });

  it("finishes a Hebrew client's week with zero kept posts as a coverage gap", async () => {
    const r = await run({ language: "he" });
    expect(r.driven.outcome.status).toBe("done");
    expect(r.requests).toHaveLength(0);
    expect(r.week).toMatchObject({ status: "done", filter_status: "skipped" });
    expect(r.posts.some((p) => p.kept)).toBe(false);
    expect(r.themes).toHaveLength(0);
  });

  it("fails only that platform when its answer cannot be read", async () => {
    const r = await run({ answers: { instagram: [[{ type: "Image", shortCode: "x", caption: "c", inputUrl: "https://www.instagram.com/explore/tags/%E0%A4%A/" }], [{ type: "Image", shortCode: "x", caption: "c", inputUrl: "https://www.instagram.com/explore/tags/%E0%A4%A/" }]] } });
    expect(r.driven.outcome.status).toBe("done");
    expect(r.week.platforms.instagram.status).toBe("failed");
    expect(r.week.status).toBe("partial");
    expect(r.posts.some((p) => p.kept && p.platform === "tiktok")).toBe(true);
  });

  it("saves the week with a failed filter when Claude cannot be reached", async () => {
    const r = await run({ failFilter: true });
    expect(r.driven.outcome.status).toBe("done");
    expect(r.week).toMatchObject({ status: "partial", filter_status: "failed" });
    expect(r.posts.length).toBeGreaterThan(0);
    expect(r.posts.some((p) => p.kept)).toBe(false);
  });

  it("reads every language of a client with several", async () => {
    const r = await run({ language: "he,en" });
    expect(r.inputs.find((x) => x.platform === "youtube")!.input.lang).toBe("he");
    expect(r.posts.some((p) => p.kept && p.platform === "linkedin")).toBe(true);
  });

  it("drops the client's own and competitors' posts by their handles, and names the brand for Claude", async () => {
    const r = await run({ handles: true });
    expect(r.posts.find((p) => p.author === "techdropp")!.drop_reason).toBe("own_or_competitor");
    expect(r.posts.find((p) => p.author === "Kehinde Dawood MBA")!.drop_reason).toBe("own_or_competitor");
    const prompt = String(r.requests[0].params.messages[0].content);
    expect(prompt).toContain("Moburst");
    expect(prompt).toContain("Kehinde Dawood MBA");
  });

  it("asks again with the problems named, with room for a long answer", async () => {
    const r = await run({ badFilter: true });
    const again = r.requests.filter((q) => String(q.custom_id).includes("filter"))[1];
    expect(again.params.max_tokens).toBeGreaterThanOrEqual(32000);
    expect(again.params.messages).toHaveLength(3);
    expect(String(again.params.messages[2].content)).toMatch(/problems/);
  });

  it("tries an empty answer once more before calling it empty", async () => {
    const r = await run({ answers: { tiktok: [[]] } });
    expect(r.calls.filter((c) => c === "tiktok")).toHaveLength(2);
    expect(r.week.platforms.tiktok.status).toBe("ok");
  });

  it("takes an empty answer to one narrow search as it is, with no second run", async () => {
    // YouTube, Pinterest and Facebook run one search at a time; a narrow topic with nothing new this week is normal.
    const r = await run({ answers: { youtube: [[]] } });
    expect(r.calls.filter((c) => c === "youtube")).toHaveLength(2);
    expect(r.week.platforms.youtube.status).toBe("ok");
  });

  it("does not count a watched platform with nothing to search as a gap", async () => {
    const r = await run({ noInstagramTags: true });
    expect(r.week.platforms.instagram.status).toBe("no_searches");
    expect(r.calls).not.toContain("instagram");
    expect(r.week.status).toBe("done");
  });
});

/** The week after a run's: w2, a week later, through the same fakes. */
async function nextWeek(r: Awaited<ReturnType<typeof run>>, input: Record<string, unknown> = {}) {
  r.clock.set(new Date(Date.parse(NOW) + 7 * 86_400_000));
  const { run_id } = await startPipelineRun(r.db, { mode: "app", pipeline: r.pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w2", input: { week_start: "2026-11-02", ...input }, dedupe: `trends:c1:2026-11-02:${Object.keys(input).join("")}` });
  const driven = await drivePipeline(r.db, r.registry, run_id, { clock: r.clock, env: ENV });
  return { driven, week: r.db.tables.trend_weeks.find((w) => w.id === "w2")! };
}

const rewrites = (requests: Any[]) => requests.filter((q) => String(q.custom_id).includes("rewrite"));
const searched = (inputs: Array<{ platform: TrendPlatform; input: Any }>, platform: TrendPlatform) => inputs.filter((x) => x.platform === platform).at(-1)!.input;
const stepLog = (r: { db: Any }, step: string) => (r.db.tables.report_pipeline_steps ?? []).filter((s: Any) => s.step === step);

describe("trends_v1 coverage rewrite", () => {
  it("rewrites a platform's searches after two short weeks, after what a person added, for this week's scrape and the next", async () => {
    const r = await run({ prior: SHORT_TIKTOK, writtenAt: EARLY, personTopic: true });
    expect(r.driven.outcome.status).toBe("done");
    expect(rewrites(r.requests)).toHaveLength(1);
    const ask = rewrites(r.requests)[0].params;
    expect(ask.model).toBe("claude-sonnet-5-5");
    expect(String(ask.messages[0].content)).toContain("TikTok");
    // Stored, and used by this week's scrape: a person's topic first, the rewrite in place of the profile's own.
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({ tiktok: REWRITTEN });
    expect(searched(r.inputs, "tiktok").keywords).toEqual(["mobile game UA", ...REWRITTEN]);
    expect(searched(r.inputs, "linkedin").searchQueries).toEqual(["mobile game UA", "app marketing", "marketing tips"]);
    expect(r.week.platforms.tiktok.rewritten).toBe(true);
    expect(r.week.platforms.linkedin.rewritten).toBeUndefined();
    // The rewrite's tokens are in the week's cost, with the filter's (both Sonnet).
    expect(r.week.cost.claude["claude-sonnet-5-5"]).toEqual({ input_tokens: 2000, output_tokens: 400 });

    // The next week reads the stored searches, and asks no new rewrite while they have had one week.
    const next = await nextWeek(r);
    expect(next.driven.outcome.status).toBe("done");
    expect(rewrites(r.requests)).toHaveLength(1);
    expect(searched(r.inputs, "tiktok").keywords).toEqual(["mobile game UA", ...REWRITTEN]);
    expect(next.week.platforms.tiktok.rewritten).toBeUndefined();
  });

  it("asks for nothing when one of the two weeks kept enough, or when the weeks came before the profile", async () => {
    const enough = await run({ prior: [finished("w-2", "2026-10-12", { tiktok: 2 }), finished("w-1", "2026-10-19", { tiktok: 5 })], writtenAt: EARLY });
    expect(rewrites(enough.requests)).toHaveLength(0);
    expect(searched(enough.inputs, "tiktok").keywords).toEqual(["app marketing", "marketing tips"]);
    // Weeks run on an older profile say nothing about the searches it has now.
    const older = await run({ prior: SHORT_TIKTOK });
    expect(rewrites(older.requests)).toHaveLength(0);
  });

  it("keeps the platform's searches and finishes the week when the rewrite answer cannot be used", async () => {
    const r = await run({ prior: SHORT_TIKTOK, writtenAt: EARLY, rewrite: [{ searches: [] }, { searches: ["Moburst growth"] }] });
    expect(r.driven.outcome.status).toBe("done");
    const asks = rewrites(r.requests);
    expect(asks).toHaveLength(2);
    // The second ask carries the first answer and its problems.
    expect(asks[1].params.messages).toHaveLength(3);
    expect(String(asks[1].params.messages[2].content)).toMatch(/problems/);
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({});
    expect(searched(r.inputs, "tiktok").keywords).toEqual(["app marketing", "marketing tips"]);
    expect(r.week.status).toBe("done");
    expect(r.week.platforms.tiktok.rewritten).toBeUndefined();
    expect(stepLog(r, "read_rewrite").at(-1).detail).toMatchObject({ platform: "tiktok", kept_searches: true });
    expect(String(stepLog(r, "read_rewrite").at(-1).detail.problems)).toMatch(/brand/);
  });

  it("keeps the platform's searches and finishes the week when Claude cannot be reached for the rewrite", async () => {
    const r = await run({ prior: SHORT_TIKTOK, writtenAt: EARLY, failRewrite: true });
    expect(r.driven.outcome.status).toBe("done");
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({});
    expect(searched(r.inputs, "tiktok").keywords).toEqual(["app marketing", "marketing tips"]);
    expect(r.week.status).toBe("done");
    expect(stepLog(r, "rewrite_searches").at(-1).detail).toMatchObject({ platform: "tiktok", kept_searches: true });
  });

  it("never searches a term a person removed, whatever the rewrite says", async () => {
    // "app store optimization" was a profile topic a person removed; the rewrite may not bring it back.
    const r = await run({ prior: SHORT_TIKTOK, writtenAt: EARLY, removedTopic: true, rewrite: [{ searches: REWRITTEN }, { searches: ["mobile app growth", "ASO tips"] }] });
    expect(String(rewrites(r.requests)[0].params.messages[0].content)).toContain("app store optimization");
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({ tiktok: ["mobile app growth", "ASO tips"] });
    // A stored rewrite holding a term a person removed later is searched without it.
    const later = await run({ prior: SHORT_TIKTOK, writtenAt: EARLY, removedTopic: true, overrides: { youtube: ["App Store Optimization", "aso tips"] } });
    expect(searched(later.inputs, "youtube").query).toBe("aso tips");
  });

  it("stores no Instagram rewrite built from hashtags a monthly refresh replaced during the run, and still stores the other platforms'", async () => {
    const prior = [finished("w-2", "2026-10-12", { tiktok: 2, instagram: 1 }), finished("w-1", "2026-10-19", { tiktok: 1, instagram: 0 })];
    const answers = [{ searches: REWRITTEN }, { searches: ["#mobileapps"] }];
    const r = await run({ prior, writtenAt: EARLY, refreshMidRun: true, rewrite: answers });
    expect(r.driven.outcome.status).toBe("done");
    expect(rewrites(r.requests)).toHaveLength(2);
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({ tiktok: REWRITTEN });
    // Without the refresh, the same run stores both.
    const calm = await run({ prior, writtenAt: EARLY, rewrite: answers });
    expect(calm.db.tables.trend_profiles[0].search_overrides).toEqual({ tiktok: REWRITTEN, instagram: ["#mobileapps"] });
  });

  it("judges Instagram only on weeks that searched its current hashtags, and TikTok on every week of the profile", async () => {
    // Both short in the two weeks before; a monthly refresh replaced the hashtags after them.
    const prior = [finished("w-2", "2026-10-12", { tiktok: 2, instagram: 1 }), finished("w-1", "2026-10-19", { tiktok: 1, instagram: 0 })];
    const r = await run({ prior, writtenAt: EARLY, hashtagsAt: "2026-10-20T08:00:00.000Z" });
    expect(r.driven.outcome.status).toBe("done");
    // One Claude call, for TikTok: the new hashtags have not been searched once yet.
    expect(rewrites(r.requests)).toHaveLength(1);
    expect(String(rewrites(r.requests)[0].params.messages[0].content)).toContain("The platform: TikTok");
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({ tiktok: REWRITTEN });
    expect(searched(r.inputs, "instagram").hashtags).toEqual(["stopchasingstartplaying"]);
    expect(r.week.platforms.instagram.rewritten).toBeUndefined();
    expect(r.week.platforms.tiktok.rewritten).toBe(true);
  });

  it("replays the week on its rewritten searches without asking again", async () => {
    const r = await run({ prior: SHORT_TIKTOK, writtenAt: EARLY });
    const replay = await nextWeek(r, { replay: { from_run: r.run_id } });
    expect(replay.driven.outcome.status).toBe("done");
    expect(rewrites(r.requests)).toHaveLength(1);
    expect(r.db.tables.trend_profiles[0].search_overrides).toEqual({ tiktok: REWRITTEN });
    expect(stepLog(r, "rewrite_searches").every((s: Any) => s.run_id === r.run_id)).toBe(true);
    // The replayed week ran on the same rewritten searches, and says so.
    expect(replay.week.platforms.tiktok.rewritten).toBe(true);
  });
});
