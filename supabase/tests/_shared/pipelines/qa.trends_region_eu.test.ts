// @vitest-environment node
// P44: regionOf (trends.ts:207) is "the client's country for the sources that
// take one", but a client whose market is set to "Europe" (ClientSetup GEOS
// value "EU") gets "EU" sent as a country: TikTok location and YouTube geo.
import { expect, it } from "vitest";
import type { ApifyClient } from "../../../functions/_shared/apify/client";
import { makeRegistry } from "../../../functions/_shared/pipelines/registry";
import { startPipelineRun } from "../../../functions/_shared/pipelines/store";
import { drivePipeline, pipelineDb, testClock } from "../../support/pipelineTestDriver";
import { TREND_SOURCES } from "../../../functions/_shared/trends/sources";
import { TREND_PLATFORMS, type TrendPlatform } from "../../../functions/_shared/trends/types";
import { trendsPipeline } from "../../../functions/_shared/pipelines/definitions/trends";

const NOW = "2026-11-01T10:00:00.000Z";
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", APIFY_API_TOKEN: "ap" } as Record<string, string>)[n];

it("never sends a region that is not a country (EU) to the sources", async () => {
  const clock = testClock(NOW);
  const db = pipelineDb({
    clients: [{ id: "c1", name: "Moburst", geo: "EU", language: "en", location: null }],
    trend_profiles: [{ client_id: "c1", audience: "a", fit_rubric: "f", platforms: [{ platform: "tiktok", reason: "r" }, { platform: "youtube", reason: "r" }], search_overrides: {}, inputs_key: "k", written_at: NOW, hashtags_at: NOW }],
    trend_terms: [{ id: "t1", client_id: "c1", kind: "topic", platform: null, term: "app marketing", reason: "r", source: "lifecycle", removed_at: null }],
    sprout_profiles: [], competitor_handles: [],
    trend_weeks: [{ id: "w1", client_id: "c1", week_start: "2026-10-26", status: "running", platforms: {}, cost: {}, created_at: "2026-10-26T09:00:00.000Z" }],
  }, () => clock.now());
  const byActor = Object.fromEntries(TREND_PLATFORMS.map((p) => [TREND_SOURCES[p].actor.id, p])) as Record<string, TrendPlatform>;
  const inputs: Array<{ platform: TrendPlatform; input: Record<string, unknown> }> = [];
  const client = {
    async startRun(actorId: string, input: Record<string, unknown>) { inputs.push({ platform: byActor[actorId], input }); return { id: `r${inputs.length}`, status: "RUNNING", defaultDatasetId: "ds" }; },
    async getRun(id: string) { return { id, status: "SUCCEEDED", defaultDatasetId: "ds", usageTotalUsd: 0 }; },
    async datasetPage() { return []; },
    async datasetItems() { return []; },
  } as unknown as ApifyClient;
  const pipeline = trendsPipeline({ apify: () => client });
  const { run_id } = await startPipelineRun(db, { mode: "app", pipeline, clientId: "c1", realTable: "trend_weeks", realId: "w1", input: { week_start: "2026-10-26" }, dedupe: "trends:c1:eu" });
  await drivePipeline(db, makeRegistry([pipeline], () => true), run_id, { clock, env: ENV });
  const tiktok = inputs.find((x) => x.platform === "tiktok")!.input;
  const youtube = inputs.find((x) => x.platform === "youtube")!.input;
  console.log("tiktok location:", tiktok.location, "| youtube geo:", youtube.geo);
  expect(tiktok.location).not.toBe("EU");
  expect(youtube.geo).not.toBe("EU");
});
