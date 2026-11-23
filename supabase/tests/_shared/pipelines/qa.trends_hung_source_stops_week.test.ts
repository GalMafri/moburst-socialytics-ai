// @vitest-environment node
// P44: a trend source whose Apify run never ends is not marked failed after
// SCRAPE_TRIES like any other failing source. The runner's poll limit
// (MAX_POLL_MINUTES) turns it into a failed try of the whole step, and the
// step's own two-try rule never sees it, so the run stops (12 hours / 5 tries)
// and the week is not saved at all, though every other source answered.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { ApifyClient } from "../../../functions/_shared/apify/client";
import { makeRegistry } from "../../../functions/_shared/pipelines/registry";
import { startPipelineRun } from "../../../functions/_shared/pipelines/store";
import { drivePipeline, pipelineDb, testClock } from "../../../functions/_shared/pipelines/testDriver";
import { TREND_SOURCES } from "../../../functions/_shared/trends/sources";
import { TREND_PLATFORMS, type TrendPlatform } from "../../../functions/_shared/trends/types";
import { trendsPipeline } from "../../../functions/_shared/pipelines/definitions/trends";
import { viaTestMeter } from "../../paid/testMeter";

// deno-lint-ignore no-explicit-any
type Any = any;
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p: TrendPlatform): Any[] => JSON.parse(readFileSync(join(here, "..", "..", "..", "fixtures", "trends", `${p}.json`), "utf8"));
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];
const NOW = "2026-11-01T10:00:00.000Z";

/** TikTok answers; LinkedIn's actor run stays RUNNING forever (an actor with no timeout of its own). */
function apify(linkedin: "RUNNING" | "FAILED" = "RUNNING"): () => ApifyClient {
  const byActor = Object.fromEntries(TREND_PLATFORMS.map((p) => [TREND_SOURCES[p].actor.id, p])) as Record<string, TrendPlatform>;
  const runs: Record<string, TrendPlatform> = {};
  let n = 0;
  const client: ApifyClient = {
    async startRun(actorId) { const id = `r${++n}`; runs[id] = byActor[actorId]; return { id, status: "RUNNING", defaultDatasetId: `ds-${id}` }; },
    async getRun(id) { return { id, status: runs[id] === "linkedin" ? linkedin : "SUCCEEDED", defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.01 }; },
    async datasetPage() { return []; },
    async datasetItems(ds) { return fixture(runs[ds.slice(3)]); },
  } as ApifyClient;
  return () => client;
}

/** Claude's batches: keep every candidate, three themes. */
function claude(requests: Any[]) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { requests.push(JSON.parse(String(init.body)).requests[0]); return new Response(JSON.stringify({ id: `batch-${requests.length}` })); }
    const k = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
    const req = requests[k - 1];
    if (!url.endsWith("/results")) return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${k}/results` }));
    const prompt = String(req.params.messages[0].content);
    let answer: unknown;
    if (String(req.custom_id).includes("filter")) {
      const ids = [...prompt.matchAll(/<post id="P(\d+)">/g)].map((m) => `P${m[1]}`);
      answer = { decisions: ids.map((id, i) => ({ id, keep: true, fit: 70 + (i % 30), why: "w", format: "short_video", lesson: "l" })) };
    } else {
      const ids = [...prompt.matchAll(/<post id="K(\d+)">/g)].map((m) => `K${m[1]}`);
      answer = { themes: ["One", "Two", "Three"].map((title, i) => ({ title, happening: "h", why_it_matters: "w", angle: "a", post_ids: [ids[i % ids.length]] })) };
    }
    const message = { content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "succeeded", message } }) + "\n");
  };
}

async function drive(linkedin: "RUNNING" | "FAILED") {
  const clock = testClock(NOW);
  const db = pipelineDb({
    clients: [{ id: "c1", name: "Moburst", geo: "US", language: "en", location: null }],
    trend_profiles: [{ client_id: "c1", audience: "App founders", fit_rubric: "Posts that teach app growth.", platforms: [{ platform: "tiktok", reason: "r" }, { platform: "linkedin", reason: "r" }], search_overrides: {}, inputs_key: "k", written_at: NOW, hashtags_at: NOW }],
    trend_terms: [
      { id: "t1", client_id: "c1", kind: "topic", platform: null, term: "app marketing", reason: "r", source: "lifecycle", removed_at: null },
      { id: "t2", client_id: "c1", kind: "topic", platform: null, term: "marketing tips", reason: "r", source: "lifecycle", removed_at: null },
    ],
    sprout_profiles: [], competitor_handles: [],
    trend_weeks: [{ id: "w1", client_id: "c1", week_start: "2026-10-26", status: "running", platforms: {}, cost: {}, created_at: "2026-10-26T09:00:00.000Z" }],
  }, () => clock.now());
  const requests: Any[] = [];
  const pipeline = trendsPipeline({ apify: apify(linkedin), ...viaTestMeter(claude(requests)) });
  const registry = makeRegistry([pipeline], () => true);
  const { run_id } = await startPipelineRun(db, { mode: "app", pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w1", input: { week_start: "2026-10-26" }, dedupe: "trends:c1:2026-10-26" });
  const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV, maxCalls: 6000 });
  const week = db.tables.trend_weeks.find((w) => w.id === "w1")!;
  const run = db.tables.report_pipeline_runs.find((r) => r.id === run_id)!;
  console.log(linkedin, "run:", run.status, "|", run.outcome, "| week:", week.status, "| hours:", ((clock.now().getTime() - Date.parse(NOW)) / 3_600_000).toFixed(1));
  return { run, week, driven };
}

it("control: a LinkedIn run that ends FAILED twice is marked failed and the week is saved partial", async () => {
  const { run, week } = await drive("FAILED");
  expect(run.status).toBe("done");
  expect(week.status).toBe("partial");
  expect(week.platforms?.linkedin?.status).toBe("failed");
}, 120_000);

it("marks a never-ending source failed and saves the week with the sources that answered", async () => {
  const { run, week } = await drive("RUNNING");
  // Design (trends.ts header): "A source that fails twice is marked failed and the week goes on."
  expect(run.status).toBe("done");
  expect(week.status).toBe("partial");
  expect(week.platforms?.linkedin?.status).toBe("failed");
}, 120_000);
