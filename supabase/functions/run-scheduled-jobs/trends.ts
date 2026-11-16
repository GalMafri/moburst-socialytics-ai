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

/** What a week's watched platforms say: all of them failed, and at least one was watched. */
function everyWatchedPlatformFailed(platforms: unknown): boolean {
  const states = Object.values((platforms ?? {}) as Record<string, { status?: string } | null>).map((p) => p?.status).filter((st) => st && st !== "not_watched");
  return states.length > 0 && states.every((st) => st === "failed");
}

/**
 * The client's current week when it was closed partial with nothing back: every
 * watched platform failed, no post was kept, no theme was written. Only the
 * code before this release saved such a week (with each platform's status).
 * Since then a week in which every watched platform failed is never saved: its
 * run stops and the close step leaves platforms empty, so this matches nothing
 * new. It is for the weeks of 9 Nov 2026 saved that way, and is to be removed
 * after Monday 16 Nov 2026, once no current week can match. It reads only the
 * client's own week.
 */
async function emptyPartialWeek(db: Db, clientId: string, weekStart: string): Promise<string | null> {
  const { data: week, error } = await db.from("trend_weeks").select("id, status, platforms").eq("client_id", clientId).eq("week_start", weekStart).maybeSingle();
  if (error) throw new Error(`Could not read the client's trend week: ${error.message}`);
  if (!week || week.status !== "partial" || !everyWatchedPlatformFailed(week.platforms)) return null;
  const { data: kept } = await db.from("trend_posts").select("id").eq("week_id", week.id).eq("kept", true).limit(1);
  if ((kept ?? []).length) return null;
  const { data: themes } = await db.from("trend_themes").select("id").eq("week_id", week.id).limit(1);
  if ((themes ?? []).length) return null;
  return week.id as string;
}

/** A client the weekly enqueue would collect for: not archived, not excluded from reporting, not a demo (enqueue_trend_refresh_jobs). */
async function isActiveClient(db: Db, clientId: string): Promise<boolean> {
  const { data, error } = await db.from("clients").select("id, archived_at, exclude_from_reporting, demo_job_id").eq("id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the client: ${error.message}`);
  return !!data && !data.archived_at && !data.exclude_from_reporting && !data.demo_job_id;
}

/**
 * An explicitly invoked action (harness mode trends_recollect), never queued by
 * a schedule: this week's collection again for each client whose week was
 * saved partial with nothing back by the code before this release (see
 * emptyPartialWeek; to be removed after 16 Nov 2026). The week is opened
 * again and trends_v1 starts on it through the same path as the weekly job, so
 * it pays one week's Apify runs and model calls per client. With a client named
 * it answers for that client alone; without one it covers every client whose
 * week qualifies, read from the weeks themselves.
 */
export async function recollectEmptyWeeks(db: Db, now: Date, clientId?: string): Promise<Array<{ clientId: string; weekId: string; runId: string; started: boolean } | { clientId: string; skipped: string }>> {
  const weekStart = weekStartOf(now);
  let clients: string[];
  if (clientId) clients = [clientId];
  else {
    const { data, error } = await db.from("trend_weeks").select("client_id").eq("week_start", weekStart).eq("status", "partial");
    if (error) throw new Error(`Could not read this week's trend weeks: ${error.message}`);
    clients = [...new Set(((data ?? []) as Array<{ client_id: string }>).map((w) => w.client_id))];
  }
  const out: Array<{ clientId: string; weekId: string; runId: string; started: boolean } | { clientId: string; skipped: string }> = [];
  for (const id of clients) {
    if (!(await isActiveClient(db, id))) {
      if (clientId) out.push({ clientId: id, skipped: "This is not an active client, so nothing is collected." });
      continue;
    }
    const weekId = await emptyPartialWeek(db, id, weekStart);
    if (!weekId) {
      if (clientId) out.push({ clientId: id, skipped: "This is not a week that brought nothing back, so it is not collected again." });
      continue;
    }
    const { data: profile } = await db.from("trend_profiles").select("client_id").eq("client_id", id).maybeSingle();
    if (!profile) { out.push({ clientId: id, skipped: "The client has no trend profile yet, so nothing is collected." }); continue; }
    const { data: runs } = await db.from("report_pipeline_runs").select("id").eq("real_id", weekId);
    const { error } = await db.from("trend_weeks").update({ status: "running", finished_at: null }).eq("id", weekId).eq("status", "partial");
    if (error) throw new Error(`Could not open the client's trend week again: ${error.message}`);
    out.push({ clientId: id, weekId, ...(await startOn(db, id, weekId, weekStart, `recollect-${((runs ?? []) as unknown[]).length + 1}`)) });
  }
  return out;
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

