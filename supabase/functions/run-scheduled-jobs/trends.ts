// The weekly trend_refresh job (spec: docs/superpowers/specs/2026-10-28-
// trends-redesign-design.md, section 3). The daily enqueue queues one per
// active client with a trend profile on the client's feed weekday; this makes
// the week's trend_weeks row and starts trends_v1 on it in app mode. The
// harness modes trends_now and replay_trends start a week the same way.

import { startPipelineRun } from "../_shared/pipelines/store.ts";
import { TRENDS_PIPELINE, trendsPipeline } from "../_shared/pipelines/definitions/trends.ts";
import { REGISTRY } from "../_shared/pipelines/registry.ts";
import type { JobOutcome, ScheduledJob } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** A week, named by its Monday in Israel time (YYYY-MM-DD). */
export function weekStartOf(now: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const t = Date.parse(`${today}T00:00:00Z`);
  const isoDow = ((new Date(t).getUTCDay() + 6) % 7) + 1;
  return new Date(t - (isoDow - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** This week's row for the client: the one there is, or a new one. */
async function weekRow(db: Db, clientId: string, weekStart: string): Promise<string> {
  const find = async () => {
    const { data, error } = await db.from("trend_weeks").select("id").eq("client_id", clientId).eq("week_start", weekStart).maybeSingle();
    if (error) throw new Error(`Could not read the client's trend week: ${error.message}`);
    return (data?.id as string | undefined) ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const { error } = await db.from("trend_weeks").insert({ client_id: clientId, week_start: weekStart, status: "running" });
  // Two jobs at once: the other one's row wins.
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(`Could not start the client's trend week: ${error.message}`);
  const made = await find();
  if (!made) throw new Error("The client's trend week was not made.");
  return made;
}

/**
 * Starts trends_v1 on the client's week. One run per client and week; a
 * suffix makes another (the trial's trends_now, a replay), which writes the
 * same week again.
 */
export async function startTrendWeek(db: Db, clientId: string, now: Date, o: { replayFrom?: string; suffix?: string } = {}): Promise<{ weekId: string; runId: string; started: boolean } | { skipped: string }> {
  const { data: profile, error } = await db.from("trend_profiles").select("client_id").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the client's trend profile: ${error.message}`);
  if (!profile) return { skipped: "The client has no trend profile yet, so nothing is collected." };
  const weekStart = weekStartOf(now);
  const weekId = await weekRow(db, clientId, weekStart);
  const pipeline = REGISTRY.get(TRENDS_PIPELINE) ?? trendsPipeline();
  const { run_id, started } = await startPipelineRun(db, {
    mode: "app", pipeline, clientId, realTable: "trend_weeks", realId: weekId,
    input: { week_start: weekStart, ...(o.replayFrom ? { replay: { from_run: o.replayFrom } } : {}) },
    dedupe: `trends:${clientId}:${weekStart}${o.suffix ? `:${o.suffix}` : ""}`,
  });
  return { weekId, runId: run_id, started };
}

export async function runTrendJob(db: Db, job: ScheduledJob, now = new Date()): Promise<JobOutcome> {
  const r = await startTrendWeek(db, job.client_id, now);
  if ("skipped" in r) return { status: "skipped", reason: r.skipped };
  return { status: "done", reason: r.started ? "The week's trends collection started." : "The week's trends collection was already under way.", result: { week_id: r.weekId, run_id: r.runId, started: r.started } };
}
