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
function apify(calls: TrendPlatform[], o: { fail?: TrendPlatform } = {}): TrendsDeps["apify"] {
  const byActor = Object.fromEntries(TREND_PLATFORMS.map((p) => [TREND_SOURCES[p].actor.id, p])) as Record<string, TrendPlatform>;
  const runs: Record<string, TrendPlatform> = {};
  const client: ApifyClient = {
    async startRun(actorId) {
      const platform = byActor[actorId];
      calls.push(platform);
      const id = `r${calls.length}`;
      runs[id] = platform;
      return { id, status: "RUNNING", defaultDatasetId: `ds-${id}` };
    },
    async getRun(id) {
      return { id, status: o.fail === runs[id] ? "FAILED" : "SUCCEEDED", defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.01 };
    },
    async datasetPage() { return []; },
    async datasetItems(datasetId) { return fixture(runs[datasetId.slice(3)]); },
  };
  return () => client;
}

/** Claude's Message Batches, answering the filter and the themes from what each request lists. */
function claude(requests: Any[], o: { badFilter?: boolean } = {}) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)).requests[0]);
      return new Response(JSON.stringify({ id: `batch-${requests.length}` }));
    }
    const n = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
    const req = requests[n - 1];
    if (!url.endsWith("/results")) return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${n}/results` }));
    const prompt = String(req.params.messages[0].content);
    let answer: unknown;
    if (String(req.custom_id).includes("filter")) {
      const ids = [...prompt.matchAll(/^P(\d+) \| (\w+) \|/gm)].map((m) => ({ id: `P${m[1]}`, platform: m[2] }));
      answer = o.badFilter ? { decisions: [] } : { decisions: ids.map((x, i) => ({ id: x.id, keep: true, fit: 70 + (i % 30), why: "w", format: x.platform === "pinterest" ? "pin" : "short_video", lesson: "l" })) };
    } else {
      const ids = [...prompt.matchAll(/^K(\d+) \|/gm)].map((m) => `K${m[1]}`);
      answer = { themes: ["One", "Two", "Three"].map((title, i) => ({ title, happening: "h", why_it_matters: "w", angle: "a", post_ids: [ids[i % ids.length]] })) };
    }
    const message = { content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } };
    return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "succeeded", message } }) + "\n");
  };
}

const ALL = TREND_PLATFORMS.map((platform) => ({ platform, reason: "watched" }));

function setup(o: { language?: string; platforms?: Array<{ platform: string; reason: string }> } = {}) {
  const clock = testClock(NOW);
  const db = pipelineDb({
    clients: [{ id: "c1", name: "Moburst", geo: "US", language: o.language ?? "en", location: null }],
    trend_profiles: [{ client_id: "c1", audience: "App founders", fit_rubric: "Posts that teach app growth.", platforms: o.platforms ?? ALL, search_overrides: {}, inputs_key: "k", written_at: NOW, hashtags_at: NOW }],
    trend_terms: [
      { id: "t1", client_id: "c1", kind: "topic", platform: null, term: "app marketing", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t2", client_id: "c1", kind: "topic", platform: null, term: "marketing tips", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t3", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#stopchasingstartplaying", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t4", client_id: "c1", kind: "exclusion", platform: null, term: "fake reviews", reason: "r", source: "dismissal", removed_at: null },
    ],
    trend_weeks: [
      { id: "w1", client_id: "c1", week_start: "2026-10-26", status: "running", platforms: {}, cost: {} },
      { id: "w2", client_id: "c1", week_start: "2026-11-02", status: "running", platforms: {}, cost: {} },
    ],
  }, () => clock.now());
  return { clock, db };
}

async function run(o: { deps?: Partial<TrendsDeps>; fail?: TrendPlatform; badFilter?: boolean; language?: string; platforms?: Array<{ platform: string; reason: string }> } = {}) {
  const { clock, db } = setup(o);
  const calls: TrendPlatform[] = [];
  const requests: Any[] = [];
  const pipeline = trendsPipeline({ apify: apify(calls, { fail: o.fail }), claudeFetch: claude(requests, { badFilter: o.badFilter }), ...o.deps });
  const registry = makeRegistry([pipeline], () => true);
  const { run_id } = await startPipelineRun(db, { mode: "app", pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w1", input: { week_start: "2026-10-26" }, dedupe: "trends:c1:2026-10-26" });
  const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
  const week = db.tables.trend_weeks.find((w) => w.id === "w1")!;
  const posts = (db.tables.trend_posts ?? []).filter((p) => p.week_id === "w1");
  const themes = (db.tables.trend_themes ?? []).filter((t) => t.week_id === "w1");
  return { db, clock, run_id, driven, week, posts, themes, calls, requests, pipeline, registry };
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
    expect(r.posts.some((p) => p.drop_reason === "language")).toBe(true);
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
    const { run_id } = await startPipelineRun(r.db, { mode: "app", pipeline: r.pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w2", input: { week_start: "2026-11-02", replay: { from_run: r.run_id } }, dedupe: "trends:c1:replay" });
    const replay = await drivePipeline(r.db, r.registry, run_id, { clock: r.clock, env: ENV });
    expect(replay.outcome.status).toBe("done");
    expect(r.calls.length).toBe(before);
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
});
