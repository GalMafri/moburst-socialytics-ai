// @vitest-environment node
// P44: Claude overloaded while the weekly filter runs. trends_v1 gives up after
// CLAUDE_TRIES (minutes, not hours) and saves the week partial with nothing
// kept. A partial week is meant to be collected again (trends.ts header), but
// the retry rule looks only at failed sources, so this week is never tried
// again and the client has no trends until next week.
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
import { recollectDecision, recollectWaitMs, runTrendJob, startTrendWeek, type TrendRunRow, type TrendWeekRow } from "../../../functions/run-scheduled-jobs/trends";

// deno-lint-ignore no-explicit-any
type Any = any;
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p: TrendPlatform): Any[] => JSON.parse(readFileSync(join(here, "..", "..", "..", "fixtures", "trends", `${p}.json`), "utf8"));
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];
const NOW = "2026-11-01T06:00:00.000Z"; // Sunday 08:00 in Israel, week of 26 Oct

function apify(): () => ApifyClient {
  const byActor = Object.fromEntries(TREND_PLATFORMS.map((p) => [TREND_SOURCES[p].actor.id, p])) as Record<string, TrendPlatform>;
  const runs: Record<string, TrendPlatform> = {};
  let n = 0;
  return () => ({
    async startRun(actorId: string) { const id = `r${++n}`; runs[id] = byActor[actorId]; return { id, status: "RUNNING", defaultDatasetId: `ds-${id}` }; },
    async getRun(id: string) { return { id, status: "SUCCEEDED", defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.01 }; },
    async datasetPage() { return []; },
    async datasetItems(ds: string) { return fixture(runs[ds.slice(3)]); },
  }) as unknown as ApifyClient;
}

/** Every batch ends errored with overloaded_error while the outage is on (a transient outage); after it, every candidate is kept. */
function claudeOverloaded(requests: Any[], outage: { on: boolean }) {
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { requests.push(JSON.parse(String(init.body)).requests[0]); return new Response(JSON.stringify({ id: `batch-${requests.length}` })); }
    const k = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
    if (!url.endsWith("/results")) return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${k}/results` }));
    const req = requests[k - 1];
    if (outage.on) return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "errored", error: { type: "overloaded_error" } } }) + "\n");
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

it("a week whose filter met a short Claude outage is collected again", async () => {
  const clock = testClock(NOW);
  const db = pipelineDb({
    clients: [{ id: "c1", name: "Moburst", geo: "US", language: "en", location: null, archived_at: null, exclude_from_reporting: false, demo_job_id: null }],
    trend_profiles: [{ client_id: "c1", audience: "App founders", fit_rubric: "Posts that teach app growth.", platforms: [{ platform: "tiktok", reason: "r" }, { platform: "youtube", reason: "r" }], search_overrides: {}, inputs_key: "k", written_at: NOW, hashtags_at: NOW }],
    trend_terms: [{ id: "t1", client_id: "c1", kind: "topic", platform: null, term: "app marketing", reason: "r", source: "lifecycle", removed_at: null }],
    sprout_profiles: [], competitor_handles: [],
    trend_weeks: [{ id: "w1", client_id: "c1", week_start: "2026-10-26", status: "running", platforms: {}, cost: {}, created_at: "2026-10-26T09:00:00.000Z" }],
  }, () => clock.now());
  const requests: Any[] = [];
  const outage = { on: true };
  const pipeline = trendsPipeline({ apify: apify(), claudeFetch: claudeOverloaded(requests, outage) });
  const { run_id } = await startPipelineRun(db, { mode: "app", pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w1", input: { week_start: "2026-10-26" }, dedupe: "trends:c1:2026-10-26" });
  const registry = makeRegistry([pipeline], () => true);
  await drivePipeline(db, registry, run_id, { clock, env: ENV, maxCalls: 2000 });
  const week = db.tables.trend_weeks.find((w) => w.id === "w1")!;
  const kept = (db.tables.trend_posts ?? []).filter((p) => p.week_id === "w1" && p.kept).length;
  const minutes = Math.round((clock.now().getTime() - Date.parse(NOW)) / 60_000);
  const runs = db.tables.report_pipeline_runs.filter((r) => r.real_id === "w1") as TrendRunRow[];
  clock.set(new Date(clock.now().getTime() + recollectWaitMs(1)));
  const decision = recollectDecision(week as TrendWeekRow, runs, clock.now());
  const weekly = await startTrendWeek(db, "c1", clock.now());
  console.log(`gave up after ${minutes} min | week ${week.status}/${week.filter_status} | kept ${kept} | recollect: ${JSON.stringify(decision)} | weekly job: ${JSON.stringify(weekly)}`);
  expect(week).toMatchObject({ status: "partial", filter_status: "failed" });
  expect(kept).toBe(0);
  // A partial week is meant to be collected again; this one never is.
  expect(decision.act).not.toBe("none");

  // QA 22 Nov 2026: the week is judged again once the outage is over, from the answers its sources kept.
  expect(decision).toMatchObject({ act: "collect", platforms: [], rejudge: true });
  outage.on = false;
  const scrapesBefore = db.tables.report_pipeline_steps.filter((x) => String(x.step).startsWith("scrape_") && x.detail?.apify_run_id).length;
  const job = await runTrendJob(db, { id: "rj", kind: "trend_refresh", client_id: "c1", payload: { recollect: { week_id: "w1" } }, attempts: 1, max_attempts: 3 } as Any, clock.now());
  expect(job.status).toBe("done");
  await drivePipeline(db, registry, String((job.result as Any).run_id), { clock, env: ENV, maxCalls: 2000 });
  const after = db.tables.trend_weeks.find((w) => w.id === "w1")!;
  expect(after).toMatchObject({ status: "done", filter_status: "ok" });
  expect((db.tables.trend_posts ?? []).filter((p) => p.week_id === "w1" && p.kept).length).toBeGreaterThan(0);
  // No source was paid for twice.
  expect(db.tables.report_pipeline_steps.filter((x) => String(x.step).startsWith("scrape_") && x.detail?.apify_run_id).length).toBe(scrapesBefore);
}, 120_000);
