// The weekly trend_refresh job (spec: docs/superpowers/specs/2026-10-28-
// trends-redesign-design.md, section 3). The daily enqueue queues one per
// active client with a trend profile on the client's feed weekday; this makes
// the week's trend_weeks row and starts trends_v1 on it in app mode. The
// harness modes trends_now and replay_trends start a week the same way.

import { startPipelineRun } from "../_shared/pipelines/store.ts";
import { TRENDS_PIPELINE, trendsPipeline } from "../_shared/pipelines/definitions/trends.ts";
import { REGISTRY } from "../_shared/pipelines/registry.ts";
import type { PayloadStore } from "../_shared/pipelines/types.ts";
import { filterRequest, type FilterProfile } from "../_shared/trends/filter.ts";
import { engagementOf } from "../_shared/trends/sources.ts";
import type { Term, TrendPlatform, TrendPost } from "../_shared/trends/types.ts";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";

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

/** A week is started again at most until this many of its runs stopped; then it is closed as partial. */
export const RUNS_PER_WEEK = 3;

/**
 * Starts trends_v1 on the client's week. One run per client and week: while
 * it runs, asking again returns it; once it stopped without finishing, the
 * week is started again until RUNS_PER_WEEK of its runs stopped. Only stopped
 * runs count: a replay or a finished run never uses up the week's tries. A
 * suffix makes another run whatever the week's state (the trial's trends_now).
 */
export async function startTrendWeek(db: Db, clientId: string, now: Date, o: { replayFrom?: string; suffix?: string } = {}): Promise<{ weekId: string; runId: string; started: boolean } | { skipped: string }> {
  const { data: profile, error } = await db.from("trend_profiles").select("client_id").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the client's trend profile: ${error.message}`);
  if (!profile) return { skipped: "The client has no trend profile yet, so nothing is collected." };
  const weekStart = weekStartOf(now);
  const weekId = await weekRow(db, clientId, weekStart);
  let suffix = o.suffix ?? "";
  if (!suffix) {
    const { data: week } = await db.from("trend_weeks").select("status").eq("id", weekId).maybeSingle();
    const { data: runs, error: runsError } = await db.from("report_pipeline_runs").select("id, status").eq("real_id", weekId);
    if (runsError) throw new Error(`Could not read the week's runs: ${runsError.message}`);
    const list = (runs ?? []) as Array<{ id: string; status: string }>;
    const running = list.find((r) => r.status === "running");
    if (running) return { weekId, runId: running.id, started: false };
    if (week?.status && week.status !== "running") return { skipped: "This week's trends are already collected." };
    const stopped = list.filter((r) => r.status === "stopped").length;
    if (stopped >= RUNS_PER_WEEK) {
      await db.from("trend_weeks").update({ status: "partial", finished_at: now.toISOString() }).eq("id", weekId);
      return { skipped: `This week's trends stopped ${stopped} times; the week is closed as partial.` };
    }
    // Numbered past every run the week has, so the new run's key is never one already used.
    if (list.length) suffix = `again-${list.length + 1}`;
  }
  return { weekId, ...(await startOn(db, clientId, weekId, weekStart, suffix, o.replayFrom)) };
}

async function startOn(db: Db, clientId: string, weekId: string, weekStart: string, suffix: string, replayFrom?: string): Promise<{ runId: string; started: boolean }> {
  const pipeline = REGISTRY.get(TRENDS_PIPELINE) ?? trendsPipeline();
  const { run_id, started } = await startPipelineRun(db, {
    mode: "app", pipeline, clientId, realTable: "trend_weeks", realId: weekId,
    input: { week_start: weekStart, ...(replayFrom ? { replay: { from_run: replayFrom } } : {}) },
    dedupe: `trends:${clientId}:${weekStart}${suffix ? `:${suffix}` : ""}`,
  });
  return { runId: run_id, started };
}

/** A trends run's week again from its kept answers, written to that same week whatever week it is now. */
export async function startTrendReplay(db: Db, fromRunId: string, now: Date): Promise<{ weekId: string; runId: string; started: boolean } | { skipped: string }> {
  const { data: from, error } = await db.from("report_pipeline_runs").select("id, client_id, kind, real_id, input").eq("id", fromRunId).maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!from || from.kind !== "trends" || !from.real_id) return { skipped: "The run is not a trends run." };
  const weekStart = String(from.input?.week_start ?? "");
  const started = await startOn(db, from.client_id, from.real_id, weekStart, `replay-${now.getTime()}`, from.id);
  return { weekId: from.real_id, ...started };
}

export async function runTrendJob(db: Db, job: ScheduledJob, now = new Date()): Promise<JobOutcome> {
  const r = await startTrendWeek(db, job.client_id, now);
  if ("skipped" in r) return { status: "skipped", reason: r.skipped };
  return { status: "done", reason: r.started ? "The week's trends collection started." : "The week's trends collection was already under way.", result: { week_id: r.weekId, run_id: r.runId, started: r.started } };
}

/** At most this many posts in one filter check, about a fifth of a real week's candidates. */
export const FILTER_CHECK_MAX_POSTS = 60;

/**
 * QA (harness mode trends_filter_check): posts picked by hand, sent through
 * the filter exactly as a run of the client sends its candidates, with the
 * profile and exclusions that run kept. For testing the filter with known
 * answers and with posts written to attack it; nothing is saved to a week.
 */
export async function filterCheckRequest(store: PayloadStore, posts: unknown): Promise<{ body: Record<string, unknown> } | { error: string }> {
  if (!Array.isArray(posts) || !posts.length || posts.length > FILTER_CHECK_MAX_POSTS) return { error: `posts must be 1 to ${FILTER_CHECK_MAX_POSTS} posts.` };
  const plan = await store.get<{ profile: FilterProfile; exclusions: Term[] }>("plan");
  if (!plan?.profile) return { error: "The run kept no plan." };
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  // deno-lint-ignore no-explicit-any
  const candidates = (posts as any[]).map((p): TrendPost => {
    const post = {
      platform: String(p?.platform ?? "") as TrendPlatform, url: String(p?.url ?? ""), author: String(p?.author ?? ""), text: String(p?.text ?? ""),
      posted_at: p?.posted_at ? String(p.posted_at) : null, format: p?.format ?? null,
      views: n(p?.views), likes: n(p?.likes), comments: n(p?.comments), shares: n(p?.shares), saves: n(p?.saves), engagement: 0, search: String(p?.search ?? ""),
    };
    return { ...post, engagement: engagementOf(post) };
  });
  if (candidates.some((p) => !/^https:\/\//.test(p.url))) return { error: "Every post needs its https link." };
  return { body: filterRequest(plan.profile, plan.exclusions ?? [], candidates) };
}

