// The weekly trend_refresh job (spec: docs/superpowers/specs/2026-10-28-
// trends-redesign-design.md, section 3). The daily enqueue queues one per
// active client with a trend profile on the client's feed weekday; this makes
// the week's trend_weeks row and starts trends_v1 on it in app mode. The
// harness modes trends_now and replay_trends start a week the same way.
//
// A week is complete only when every source it needs has answered. A week
// saved with a failed source is partial, and that source is collected again
// by the app (the second half of this file): the worker's sweep
// (queueSourceRecollects) queues a trend_refresh job for the week when its
// next try has come, and that job (runTrendJob with payload.recollect) starts
// a run that asks the failed sources only (trends_v1 knows such a run by its
// input.recollect: _shared/pipelines/definitions/trends.ts). At
// most RECOLLECTS_PER_WEEK tries, spaced 10 minutes, an hour, six hours, then
// a day apart, and never after the week is over. A source that refuses the
// app's request or its account REFUSALS_BEFORE_STOP tries running is not
// asked again that week: that is a fact about the request or the account,
// and asking again sends the same thing. Each job's result says what every
// failed source last answered and what kind of fault that is.

import { makePayloadStore, PayloadUnread, startPipelineRun } from "../_shared/pipelines/store.ts";
import { TRENDS_PIPELINE, trendsPipeline, type Recollect } from "../_shared/pipelines/definitions/trends.ts";
import { REGISTRY } from "../_shared/pipelines/registry.ts";
import type { PayloadStore } from "../_shared/pipelines/types.ts";
import { retryWait } from "../_shared/calendar/runWeek.ts";
import { failedSources, sourceFault, sourceFaultKind, type SourceFault } from "../_shared/trends/faults.ts";
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
    const { data: week } = await db.from("trend_weeks").select("status, platforms").eq("id", weekId).maybeSingle();
    const { data: runs, error: runsError } = await db.from("report_pipeline_runs").select("id, status").eq("real_id", weekId);
    if (runsError) throw new Error(`Could not read the week's runs: ${runsError.message}`);
    const list = (runs ?? []) as Array<{ id: string; status: string }>;
    const running = list.find((r) => r.status === "running");
    if (running) return { weekId, runId: running.id, started: false };
    if (week?.status && week.status !== "running") {
      // A week saved without a source is never started over here: only that source is collected again (queueSourceRecollects).
      const missing = week.status === "partial" ? failedSources(week.platforms) : [];
      return { skipped: missing.length ? `This week's trends are collected except ${namesOf(missing)}, which the app collects again on its own.` : "This week's trends are already collected." };
    }
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

async function startOn(db: Db, clientId: string, weekId: string, weekStart: string, suffix: string, replayFrom?: string, recollect?: Recollect): Promise<{ runId: string; started: boolean }> {
  const pipeline = REGISTRY.get(TRENDS_PIPELINE) ?? trendsPipeline();
  const { run_id, started } = await startPipelineRun(db, {
    mode: "app", pipeline, clientId, realTable: "trend_weeks", realId: weekId,
    input: { week_start: weekStart, ...(replayFrom ? { replay: { from_run: replayFrom } } : {}), ...(recollect ? { recollect } : {}) },
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

// ── A failed source, collected again ────────────────────────────────────────

/** A week's failed sources are collected again at most this many times. */
export const RECOLLECTS_PER_WEEK = 6;
/** A source that refuses the request or the account this many tries in a row is not asked again that week. */
export const REFUSALS_BEFORE_STOP = 2;
/** The worker's sweep looks for a due try every this many minutes; the shortest wait between tries is twice that. */
export const RECOLLECT_SWEEP_MINUTES = 5;

/** True on the ticks the sweep runs in. */
export const recollectSweepDue = (now: Date): boolean => now.getUTCMinutes() % RECOLLECT_SWEEP_MINUTES === 0;

/**
 * The wait before a week's try (from 1): 10 minutes, an hour, six hours, then
 * a day. The same waits a week's calendar plan is tried again on (retryWait),
 * so the app has one answer to "how long before trying again".
 */
export const recollectWaitMs = (attempt: number): number => retryWait(attempt);

const PLATFORM_NAMES: Record<TrendPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", pinterest: "Pinterest", facebook: "Facebook" };
/** "TikTok", "TikTok and YouTube", "TikTok, YouTube and Facebook". */
function namesOf(platforms: TrendPlatform[]): string {
  const names = platforms.map((p) => PLATFORM_NAMES[p] ?? p);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
}

/** The columns of trend_weeks and report_pipeline_runs the rule reads. */
const WEEK_COLUMNS = "id, client_id, week_start, status, platforms, finished_at";
const RUN_COLUMNS = "id, status, input, started_at, finished_at, outcome, job_id";

export interface TrendWeekRow { id: string; client_id: string; week_start: string; status: string; platforms: unknown; finished_at: string | null }
export interface TrendRunRow { id: string; status: string; input: Record<string, unknown> | null; started_at: string | null; finished_at: string | null; outcome: string | null; job_id?: string | null }

export type RecollectDecision =
  /** The next try has come: these sources are asked again, the rest read from the run the week was saved from. `refused`: failed sources no longer asked. */
  | { act: "collect"; try: number; platforms: TrendPlatform[]; fromRun: string; refused: TrendPlatform[] }
  /** No source is asked again and one still has not answered: every try was used ("tries"), or what is left refused the request or the account twice running ("refused"). The week stays as it is. */
  | { act: "end"; why: "tries" | "refused"; tries: number; platforms: TrendPlatform[] }
  /** Nothing to do now, and why. */
  | { act: "none"; why: string };

/**
 * The failed sources that are not asked again this week: the last
 * REFUSALS_BEFORE_STOP tries in a row ended with the source refusing the
 * request, or the account (the mark trends_v1 keeps: platforms.<p>.fault).
 * A fault that passes on its own (transient) never stops a source.
 */
export function refusedSources(platforms: unknown): TrendPlatform[] {
  const tally = (platforms ?? {}) as Record<string, { fault?: { kind?: unknown; tries?: unknown } | null } | null | undefined>;
  return failedSources(platforms).filter((p) => {
    const fault = tally[p]?.fault;
    return (fault?.kind === "request" || fault?.kind === "credentials") && Number(fault.tries) >= REFUSALS_BEFORE_STOP;
  });
}

const timeOf = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);
const isRecollect = (run: TrendRunRow): boolean => !!(run.input as { recollect?: unknown } | null)?.recollect;
/** The run the week's sources were last read in full by: its newest finished run. */
const lastDone = (runs: TrendRunRow[]): TrendRunRow | null =>
  runs.filter((r) => r.status === "done").sort((a, b) => timeOf(b.finished_at) - timeOf(a.finished_at))[0] ?? null;

/**
 * The one rule, from what is stored: the week's row and its runs. A week is
 * collected again only while it is this week, saved partial, with a source
 * that failed and may still be asked, no run of it going, tries left, and
 * the wait since its last try over. A week that is done, running or over is
 * never touched, so a complete week is never paid for twice.
 */
export function recollectDecision(week: TrendWeekRow, runs: TrendRunRow[], now: Date): RecollectDecision {
  const none = (why: string): RecollectDecision => ({ act: "none", why });
  if (String(week.week_start).slice(0, 10) !== weekStartOf(now)) return none("The week is over, so nothing more is collected for it.");
  if (week.status === "running") return none("The week is still being collected.");
  if (week.status !== "partial") return none("Every source of the week answered, so nothing is collected again.");
  const failed = failedSources(week.platforms);
  if (!failed.length) return none("No source of the week failed, so nothing is collected again.");
  if (runs.some((r) => r.status === "running")) return none("A run of the week is under way.");
  const tries = runs.filter(isRecollect);
  const refused = refusedSources(week.platforms);
  const platforms = failed.filter((p) => !refused.includes(p));
  if (!platforms.length) return { act: "end", why: "refused", tries: tries.length, platforms: failed };
  if (tries.length >= RECOLLECTS_PER_WEEK) return { act: "end", why: "tries", tries: tries.length, platforms: failed };
  const from = lastDone(runs);
  if (!from) return none("No finished run of the week is left to start from.");
  const lastEnd = Math.max(timeOf(week.finished_at), ...tries.map((r) => timeOf(r.finished_at)));
  const due = lastEnd + recollectWaitMs(tries.length + 1);
  if (now.getTime() < due) return none(`The next try is due at ${new Date(due).toISOString()}.`);
  return { act: "collect", try: tries.length + 1, platforms, fromRun: from.id, refused };
}

async function weekRuns(db: Db, weekId: string): Promise<TrendRunRow[]> {
  const { data, error } = await db.from("report_pipeline_runs").select(RUN_COLUMNS).eq("real_id", weekId);
  if (error) throw new Error(`Could not read the week's runs: ${error.message}`);
  return (data ?? []) as TrendRunRow[];
}

/**
 * A run of the week that is waiting for the collecting account (its token is
 * not set or was refused): the run's own job says so (PipelineJobPayload
 * paused_for). The run goes on by itself once the account answers.
 */
async function accountWait(db: Db, runs: TrendRunRow[]): Promise<{ runId: string; waitingFor: string } | null> {
  for (const run of runs.filter((r) => r.status === "running" && r.job_id)) {
    const { data, error } = await db.from("scheduled_jobs").select("payload").eq("id", run.job_id).maybeSingle();
    if (error) throw new Error(`Could not read the run's job: ${error.message}`);
    const waitingFor = (data?.payload as { paused_for?: unknown } | null)?.paused_for;
    if (typeof waitingFor === "string" && waitingFor) return { runId: run.id, waitingFor };
  }
  return null;
}

/**
 * The worker's sweep (index.ts, every RECOLLECT_SWEEP_MINUTES): one
 * trend_refresh job for each of this week's weeks whose next try has come,
 * one when a week's tries are used up, and one when a week's run waits for
 * the collecting account. Nothing is collected here; the job decides again
 * from the stored facts when it runs. Each key is queued once: a try's key
 * carries the day, so a job that could not start its run is queued again the
 * next day rather than never. Answers with the keys it asked for.
 */
export async function queueSourceRecollects(db: Db, now: Date): Promise<string[]> {
  const { data, error } = await db.from("trend_weeks").select(WEEK_COLUMNS).eq("week_start", weekStartOf(now)).in("status", ["partial", "running"]);
  if (error) throw new Error(`Could not read this week's trend weeks: ${error.message}`);
  const day = now.toISOString().slice(0, 10);
  const queued: string[] = [];
  for (const week of (data ?? []) as TrendWeekRow[]) {
    if (week.status === "partial" && !failedSources(week.platforms).length) continue;
    const runs = await weekRuns(db, week.id);
    const decision = recollectDecision(week, runs, now);
    let key: string | null = null;
    if (decision.act === "collect") key = `trend_recollect:${week.id}:${decision.try}:${day}`;
    else if (decision.act === "end") key = `trend_recollect:${week.id}:end`;
    else if (await accountWait(db, runs)) key = `trend_recollect:${week.id}:account`;
    if (!key) continue;
    const { error: queueError } = await db.from("scheduled_jobs").upsert(
      { kind: "trend_refresh", client_id: week.client_id, dedupe_key: key, priority: 50, available_at: now.toISOString(), payload: { recollect: { week_id: week.id } } },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (queueError) throw new Error(`Could not queue the week's next try: ${queueError.message}`);
    queued.push(key);
  }
  return queued;
}

/** What the job's record says for a failed source whose kept words could not be read. */
export const EARLIER_ANSWER_UNREAD = "The earlier answer could not be read.";

/**
 * What each failed source last answered, from the message the week's newest
 * finished run kept for it (source.<platform>.<n>.failed), with the kind of
 * fault it is. A source whose message is gone is transient with no message.
 * This read is only for the job's record, so it never holds back the work: a
 * message that is kept and could not be read (PayloadUnread, and only that)
 * is recorded as such, and the source is collected again all the same.
 */

async function sourceFaults(db: Db, runs: TrendRunRow[], platforms: TrendPlatform[]): Promise<SourceFault[]> {
  const from = lastDone(runs);
  if (!from) return platforms.map((p) => sourceFault(p, ""));
  const { data, error } = await db.from("pipeline_payloads").select("key").eq("run_id", from.id);
  if (error) throw new Error(`Could not read what the week's run kept: ${error.message}`);
  const keys = ((data ?? []) as Array<{ key: string }>).map((r) => String(r.key));
  const store = makePayloadStore(db, from.id);
  const out: SourceFault[] = [];
  for (const p of platforms) {
    const prefix = `source.${p}.`;
    const failed = keys.filter((k) => k.startsWith(prefix) && k.endsWith(".failed"))
      .sort((a, b) => Number(b.slice(prefix.length).split(".")[0]) - Number(a.slice(prefix.length).split(".")[0]));
    let kept: { message?: unknown } | null = null;
    try {
      kept = failed.length ? await store.get<{ message?: unknown }>(failed[0]) : null;
    } catch (e) {
      if (!(e instanceof PayloadUnread)) throw e;
      out.push({ ...sourceFault(p, EARLIER_ANSWER_UNREAD), unread: true });
      continue;
    }
    out.push(sourceFault(p, typeof kept?.message === "string" ? kept.message : ""));
  }
  return out;
}

/**
 * The job the sweep queues for a week (payload.recollect.week_id). It decides
 * again from the stored facts, so a job that runs late or twice starts
 * nothing it should not: one run per try, by the run's key. Its result is
 * the operators' record: which sources failed, what each last answered and
 * what kind of fault that is (request, credentials or transient), the try,
 * and the run it started. Two outcomes end the job failed, so the daily
 * sweep lists them: a source that used every try, and a week whose run is
 * waiting for the collecting account.
 */
async function runSourceRecollect(db: Db, job: ScheduledJob, weekId: string, now: Date): Promise<JobOutcome> {
  const { data: week, error } = await db.from("trend_weeks").select(WEEK_COLUMNS).eq("id", weekId).maybeSingle();
  if (error) throw new Error(`Could not read the client's trend week: ${error.message}`);
  if (!week || week.client_id !== job.client_id) return { status: "skipped", reason: "The week this job was for no longer exists." };
  const row = week as TrendWeekRow;
  const weekStart = String(row.week_start).slice(0, 10);
  const about = { week_id: row.id, week_start: weekStart };
  const runs = await weekRuns(db, row.id);

  // A run of the week is held by the collecting account: nothing to start, and the job ends failed so the daily sweep lists it.
  const waiting = await accountWait(db, runs);
  if (waiting) {
    return {
      status: "failed", reason: `The week's collection is waiting for ${waiting.waitingFor}: the collecting account is not set or was refused. It goes on by itself once the account answers, until the week ends.`,
      result: { ...about, run_id: waiting.runId, waiting_for: waiting.waitingFor, kind: "credentials" },
    };
  }

  const decision = recollectDecision(row, runs, now);
  if (decision.act === "none") return { status: "skipped", reason: decision.why, result: about };
  if (!(await isActiveClient(db, row.client_id))) return { status: "skipped", reason: "This is not an active client, so nothing is collected.", result: about };

  const refused = decision.act === "collect" ? decision.refused : refusedSources(row.platforms);
  const sources = await sourceFaults(db, runs, decision.act === "collect" ? [...decision.platforms, ...refused] : decision.platforms);
  const names = namesOf(decision.platforms);
  // The newest try, when it stopped instead of finishing: why, and what kind of reason that is.
  const lastTry = runs.filter(isRecollect).sort((a, b) => timeOf(b.finished_at) - timeOf(a.finished_at))[0];
  const stopped = lastTry?.status === "stopped" && lastTry.outcome ? { run_id: lastTry.id, reason: lastTry.outcome, kind: sourceFaultKind(lastTry.outcome).kind } : null;

  if (decision.act === "end") {
    const them = decision.platforms.length > 1 ? "them" : "it";
    const reason = decision.why === "refused"
      ? `${names} refused the app's request or its account ${REFUSALS_BEFORE_STOP} tries in a row, so ${decision.platforms.length > 1 ? "they are" : "it is"} not asked again this week and the week stays without ${them}.`
      : `${names} did not answer in ${decision.tries} more tries, so the week stays without ${them}.`;
    return {
      status: "failed", reason,
      result: { ...about, sources, recollect: { tries: decision.tries, of: RECOLLECTS_PER_WEEK, platforms: decision.platforms, ended: decision.why, ...(refused.length ? { refused } : {}) }, ...(stopped ? { stopped } : {}) },
    };
  }

  const { data: profile } = await db.from("trend_profiles").select("client_id, platforms").eq("client_id", row.client_id).maybeSingle();
  if (!profile) return { status: "skipped", reason: "The client has no trend profile any more, so nothing is collected.", result: about };
  // A source the client stopped watching since the week was saved is not paid for again.
  const watched = Array.isArray(profile.platforms) ? new Set((profile.platforms as Array<{ platform?: unknown }>).map((p) => String(p?.platform ?? ""))) : null;
  const platforms = watched ? decision.platforms.filter((p) => watched.has(p)) : decision.platforms;
  if (!platforms.length) return { status: "skipped", reason: `The client no longer watches ${names}, so nothing is collected again.`, result: { ...about, sources } };
  const recollect: Recollect = { platforms, try: decision.try };
  const started = await startOn(db, row.client_id, row.id, weekStart, `source-${decision.try}`, decision.fromRun, recollect);
  return {
    status: "done", reason: `${namesOf(platforms)} ${platforms.length > 1 ? "are" : "is"} collected again for the week (try ${decision.try} of ${RECOLLECTS_PER_WEEK}).`,
    result: {
      ...about, run_id: started.runId, started: started.started, sources,
      recollect: { try: decision.try, of: RECOLLECTS_PER_WEEK, platforms, from_run: decision.fromRun, ...(refused.length ? { refused } : {}) },
      ...(stopped ? { stopped } : {}),
    },
  };
}

export async function runTrendJob(db: Db, job: ScheduledJob, now = new Date()): Promise<JobOutcome> {
  // A job the sweep queued for a week short of a source (queueSourceRecollects).
  const recollect = (job.payload as { recollect?: { week_id?: unknown } } | null | undefined)?.recollect;
  if (recollect) return runSourceRecollect(db, job, String(recollect.week_id ?? ""), now);
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

