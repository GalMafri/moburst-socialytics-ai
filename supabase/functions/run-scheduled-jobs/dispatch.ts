// One scheduled report dispatch: one schedule occurrence, until its report exists.
//
// The rules: competitive needs a set in an accepted status and a RivalIQ
// landscape that tracks the client (the same check run-report makes, from
// _shared/competitive/landscapeCheck.ts), and creates no report and sends
// nothing until both hold. Social waits for a paired competitive analysis
// only while that analysis is about to start or is running, and then takes
// its range from that report. A competitive analysis that was never created,
// or that did not finish, never holds the social report: it goes out with the
// latest complete analysis instead.
//
// A report that does not finish never ends the occurrence. Its row is taken
// away, so no screen shows a run that did not finish, and a new run starts
// after a wait that doubles each time (30 minutes, then 1, 2, 4 hours, up to
// a day). The schedule waits on the occurrence the whole time. Only when the
// schedule's next run is close does the occurrence close, quietly, and that
// run takes over.
//
// A run a person asks for (run-report) is the same job with no schedule
// behind it: a manual run, its kind and period on the job's payload. It
// follows every rule above, retries included, for MANUAL_RUN_DAYS from when
// it was asked for, and touches no schedule.
//
// A competitive analysis that finishes but does not pass its checks
// (competitiveReportQuality) is held: never shown to clients. The occurrence
// then stays open and the analysis is made again once a day, up to
// HELD_REDOS times; the held run stays for staff, read as being redone.
//
// Each dispatch is its own job with recorded phases:
//
//   prepared  the report row exists and its id is on the job. A resumed job
//             reuses it.
//   posting   written immediately before the webhook request. A job found in
//             this phase sends the same request again: the workflow writes
//             into that one report (a competitive one is also fenced by
//             attempt_started_at), so a repeat never makes a second report.
//             With the switch on app by then, the in-app run makes that same
//             report instead.
//   sent      the workflow accepted the request, or the in-app run was
//             queued. From here the job only watches its report.
//
// Which engine makes the report is the engine switch (report_engines, read
// through _shared/pipelines/engine.ts), read once per lease before anything
// is made. n8n, a row set by hand: everything above is exactly as it was,
// and without its webhook the dispatch is blocked before anything is made, as
// before. shadow: the request goes to n8n as above, and once n8n has it an
// in-app pipeline run is queued that writes only to shadow tables. Anything
// else is app: no request goes to n8n and no webhook is needed; the in-app
// run makes the report, and the job watches that run instead of the
// 90-minute clock: a run the worker is still taking step by step is not
// stuck however long it takes, and a run that stopped, or that nothing has
// touched for 90 minutes, ends this run of the report.
//
// n8n is never the backup. However many in-app runs stop, the occurrence
// runs again in the app later, with the waits and the closing rule above. A
// missing or unknown row is app and runs now with the app pipeline; only a
// dispatch given no switch, a switch that cannot be read, or an app with no
// pipeline that can run in this deployment (a secret not set) waits, and
// runs again later the same way.
//
// A report still not made a day after its first try gets one Slack message
// to #ai-products-issues (_shared/alerts/slack.ts), at the day itself. The
// occurrence's first run sets alert_due_at (its start plus
// ALERT_AFTER_MINUTES), and the job is leased then wherever it stands:
//
//   between runs  the job is queued for the earlier of its next run and the
//                 alert's time. A lease before the next run only checks the
//                 alert and puts the job back for that run (retry_at), so the
//                 runs keep their times; the lease is deferred, so it does
//                 not count as an attempt. An occurrence a person moved, or a
//                 manual run whose window closed, is skipped first, unalerted.
//   a run going   release_ready_dispatches lets the waiting job out at
//                 alert_due_at (20261110200000_dispatch_alert_due.sql), and
//                 the watch alerts that the report is still running.
//   a run ending  a run that ends at or after the day alerts with its reason.
//
// The alert is tried once at its time: alert_due_at is then removed, so the
// job is never leased again just for it. alerted_at is kept only when the
// message was posted, so with no webhook nothing is recorded and the next
// run that ends (or the daily look at a running one) tries again once the
// webhook is there. One alert per occurrence, never before the day; when the
// report is then made, one short message says so. Nothing here changes what
// the dispatch makes or when.

import { nextRun, rangeForSchedule, type ReportRange } from "../_shared/reports/schedule.ts";
import { madeReportText, reportsLink, stuckReportText } from "../_shared/alerts/slack.ts";
import { STUCK_AFTER_MINUTES } from "../_shared/reports/payloads.ts";
import { isTrackingProblem, LANDSCAPE_MISSING, type LandscapeCheck } from "../_shared/competitive/landscapeCheck.ts";
import { HELD_REDOS } from "../_shared/competitive/reportEvidence.ts";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";
import { RETRY_MINUTES } from "./worker.ts";
import type { Engine, PipelineDefinition } from "../_shared/pipelines/types.ts";
import type { ReportPipelineStart } from "../_shared/pipelines/shadow.ts";
import type { AppRunView } from "../_shared/pipelines/store.ts";

/**
 * How a competitive schedule records that RivalIQ does not track the client
 * (or no longer does). It is the schedule's last_result, shown on the client
 * setup page, so the prefix is the contract the page reads.
 */
export const NEEDS_TRACKING = "needs tracking";

/** The wait before the second run of an occurrence; each later wait doubles. */
export const RETRY_FIRST_MINUTES = 30;
/** The longest wait between two runs of one occurrence. */
export const RETRY_MAX_MINUTES = 24 * 60;
/** The last run of an occurrence starts at least this long before the schedule's next run. */
export const LAST_RUN_LEAD_MINUTES = 180;
/** How long a manual run keeps trying, from when it was asked for. */
export const MANUAL_RUN_DAYS = 7;
/** The wait before a held competitive analysis is made again. */
export const HELD_REDO_MINUTES = 24 * 60;
/** A report still not made this long after its occurrence's first run started gets one Slack alert. */
export const ALERT_AFTER_MINUTES = 24 * 60;

/**
 * Why a run of the report ended, as a code each call site below passes next
 * to its words for the logs; still_running is a run going at the day.
 */
export type RunEnd =
  | "app_stopped" | "app_gone" | "app_stopped_answering" | "app_ended_without_report" | "app_not_queued"
  | "no_pipeline" | "engine_unreadable" | "report_removed" | "interrupted" | "n8n" | "held" | "still_running" | "error";

/** Each code in the plain words the Slack alert uses; never raw error text. */
export const PLAIN_REASONS: Readonly<Record<RunEnd, string>> = {
  app_stopped: "the in-app run stopped",
  app_gone: "the in-app run stopped",
  app_stopped_answering: "the in-app run stopped answering",
  app_ended_without_report: "the in-app run ended without the report",
  app_not_queued: "the in-app run could not start",
  no_pipeline: "the in-app pipeline could not start",
  engine_unreadable: "the report engine setting could not be read",
  report_removed: "the report was removed before it finished",
  interrupted: "the job was interrupted before the report could start",
  n8n: "the n8n workflow did not finish it",
  held: "the analysis did not pass its checks",
  still_running: "it is still running",
  error: "the run ended without a recorded reason",
};

/** The plain words for a code; a run with none on record (kept before codes existed) reads as an error. */
export function plainReason(end: RunEnd | undefined): string {
  return PLAIN_REASONS[end ?? "error"] ?? PLAIN_REASONS.error;
}

/** A run a person asked for, with no schedule behind it (scheduled_jobs.payload). */
export interface ManualRun {
  run: "manual";
  kind: "social" | "competitive";
  range: ReportRange;
  requested_by: string | null;
  requested_at: string;
  skip_trends?: boolean;
}

/** The job's manual run, or null for a schedule's dispatch. */
export function manualRun(job: Pick<ScheduledJob, "schedule_id" | "payload" | "created_at">): ManualRun | null {
  const p = (job.payload ?? null) as Partial<ManualRun> | null;
  if (job.schedule_id || !p || p.run !== "manual") return null;
  const kind = p.kind === "competitive" || p.kind === "social" ? p.kind : null;
  if (!kind || !p.range?.start || !p.range?.end) return null;
  return {
    run: "manual", kind, range: { start: String(p.range.start), end: String(p.range.end) },
    requested_by: p.requested_by ?? null, requested_at: p.requested_at ?? job.created_at, skip_trends: p.skip_trends === true,
  };
}

export interface ScheduleRow {
  id: string;
  client_id: string;
  report_kind: string;
  is_active: boolean;
  next_run_at: string;
  run_day_of_month: number | null;
  frequency: string | null;
  range_mode: string | null;
  created_by: string | null;
  pending_competitive_report_id: string | null;
}

export interface ClientRow {
  id: string;
  name: string;
  archived_at: string | null;
  [key: string]: unknown;
}

export interface CompetitorSetRow {
  id: string;
  [key: string]: unknown;
}

export interface NewReportRow {
  client_id: string;
  status: "running";
  report_data: Record<string, never>;
  date_range_start: string;
  date_range_end: string;
  created_by: string | null;
}

/** A report row as the dispatch watches it. */
export interface ReportRun {
  status: string;
  created_at: string | null;
  /** What the workflow said when it stopped, kept on the job for the logs. */
  error: string | null;
  /** A finished competitive analysis that did not pass its checks (competitiveReportQuality). */
  held?: boolean;
}

/** Everything a dispatch reads and writes, so the rules can run against a fake. */
export interface DispatchStore {
  schedule(id: string): Promise<ScheduleRow | null>;
  client(id: string): Promise<ClientRow | null>;
  /** The client's latest competitor set in confirmed, analyzing, complete or failed. */
  competitorSet(clientId: string): Promise<CompetitorSetRow | null>;
  competitiveReport(id: string, clientId: string): Promise<{ status: string; date_range_start: string | null; date_range_end: string | null } | null>;
  /** A report row's status and start, or null when the row is gone. */
  reportRun(table: "reports" | "competitive_reports", id: string): Promise<ReportRun | null>;
  /**
   * True while the client's due competitive analysis is about to start: an
   * active competitive schedule is due and its dispatch job for that
   * occurrence is running, or queued for its first run, or not created yet.
   * A competitive job that is waiting, blocked, between runs or finished will
   * not produce a report now, so the social report does not wait for it.
   */
  pairedCompetitivePending(clientId: string, now: Date): Promise<boolean>;
  /** Put the client's waiting, unpinned social dispatches back in the queue. */
  releaseHeldSocial(clientId: string): Promise<void>;
  webhooks(): Promise<{ social: string | null; competitive: string | null }>;
  insertCompetitiveReport(row: NewReportRow & { created_at: string; set_id: string }): Promise<string>;
  insertSocialReport(row: NewReportRow): Promise<string>;
  /** Pin the client's due social schedules (none pinned yet) to this competitive report. */
  holdSocial(clientId: string, competitiveReportId: string, now: Date): Promise<void>;
  setAnalyzing(setId: string): Promise<void>;
  /**
   * Take away a run that did not finish: social schedules pinned to it are
   * unpinned, then the row is deleted unless it completed meanwhile.
   */
  dropReport(table: "reports" | "competitive_reports", id: string): Promise<void>;
  /** A set this dispatch put into analyzing goes back to complete, or to confirmed when it has no complete report. */
  releaseSet(setId: string): Promise<void>;
  /** The report ran: last run, next run, result, pin cleared. */
  advance(schedule: ScheduleRow, nextRunAt: string, result: string): Promise<void>;
  /** The occurrence closed without a report: next run and pin, and nothing to show. */
  close(schedule: ScheduleRow, nextRunAt: string): Promise<void>;
  /** Record where the schedule stands (shown on the client setup page); null shows nothing. */
  note(scheduleId: string, result: string | null): Promise<void>;
}

export interface DispatchDeps {
  store: DispatchStore;
  now(): Date;
  /** Sends the workflow request. Throws on a network failure. */
  post(url: string, body: unknown): Promise<{ ok: boolean; status: number }>;
  buildSocialPayload(args: { client: ClientRow; reportId: string; range: ReportRange; scheduled: boolean; staggerSeconds: number; competitiveReportId?: string; skipTrends?: boolean }): Promise<Record<string, unknown>>;
  buildCompetitivePayload(args: { client: ClientRow; reportId: string; set: CompetitorSetRow; range: ReportRange; attemptStartedAt: string; scheduled: boolean; staggerSeconds: number }): Promise<Record<string, unknown>>;
  /** The shared RivalIQ landscape check (landscapeCheck.ts), bound to the project's key. One provider read. */
  checkLandscape(client: ClientRow, set: CompetitorSetRow): Promise<LandscapeCheck>;
  /** Persist the job's phase before the step that depends on it. */
  saveJob(patch: Partial<Pick<ScheduledJob, "phase" | "report_id" | "result">>): Promise<void>;
  /** Read and build everything, write nothing, send nothing. */
  dryRun?: boolean;
  /**
   * The engine switch for this report kind and client (_shared/pipelines/engine.ts
   * readEngine). An app with no pipeline cannot run now; a throw, or no
   * switch given at all, reads as that. Only a switch that answers n8n (or
   * shadow) sends a request to n8n.
   */
  engine?(kind: "social" | "competitive", clientId: string): Promise<{ engine: Engine; pipeline?: PipelineDefinition; refused?: string; unreadable?: boolean }>;
  /** Queue the report's in-app pipeline run (_shared/pipelines/shadow.ts). Throws when it could not be queued; absent, nothing can be queued. */
  startPipeline?(args: ReportPipelineStart): Promise<{ run_id: string }>;
  /** The in-app run that makes a report (app engine), or null. Without it the job watches the report's own 90-minute clock. */
  pipelineRun?(reportId: string): Promise<AppRunView | null>;
  /** Posts one message to #ai-products-issues; true when it was posted. Absent: nothing is posted. */
  alert?(text: string): Promise<boolean>;
}

/** One run of an occurrence, kept on the job for the logs. */
export interface DispatchRun {
  report_id: string;
  started_at: string;
  ended_at?: string;
  /** held: it finished, did not pass its checks, and is made again. */
  outcome?: "ran" | "stopped" | "held";
  note?: string;
  /** Set only on a run the in-app pipeline made (the app engine). */
  engine?: "app";
  /** Why the run ended, as a code (PLAIN_REASONS). */
  end?: RunEnd;
}

/** What a dispatch job keeps between its leases (scheduled_jobs.result). */
export interface DispatchMemory {
  range?: ReportRange;
  set_id?: string;
  attempt_started_at?: string;
  /** The competitive report the social request was built on, so a repeated request is the same request. */
  competitive_report_id?: string | null;
  competitive_report_skipped?: string;
  runs?: DispatchRun[];
  /** Set only when the in-app pipeline makes the report (the app engine); an n8n run never carries it. */
  engine?: "app";
  pipeline_run_id?: string;
  /** When the Slack alert for this occurrence was posted; set once, kept by every later run. */
  alerted_at?: string;
  /** When the alert is due (the first run's start plus a day); removed once it was tried. */
  alert_due_at?: string;
  /** The next run's time, while the job is queued earlier for the alert; that lease only checks the alert. */
  retry_at?: string;
  [key: string]: unknown;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Both n8n webhooks answer on receipt; a request still open after this long is treated as unanswered. */
export const POST_TIMEOUT_MS = 30_000;

export function makePoster(secret: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)) {
  return async (url: string, body: unknown) => {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    await r.body?.cancel().catch(() => {});
    return { ok: r.ok, status: r.status };
  };
}

/** The wait after the given number of runs that did not finish: 30 minutes, doubling, at most a day. */
export function retryWaitMinutes(runsMade: number): number {
  return Math.min(RETRY_MAX_MINUTES, RETRY_FIRST_MINUTES * 2 ** Math.max(0, runsMade - 1));
}

/**
 * When the occurrence runs again, or null when no run fits before the
 * schedule's next run (the occurrence then closes and that run takes over).
 */
export function nextRunOfOccurrence(runsMade: number, now: Date, deadline: string): Date | null {
  const latest = Date.parse(deadline) - LAST_RUN_LEAD_MINUTES * MINUTE;
  const at = Math.min(now.getTime() + retryWaitMinutes(runsMade) * MINUTE, latest);
  return at > now.getTime() ? new Date(at) : null;
}

/** The schedule's next run after this occurrence: never in the past, so a late finish does not fire again at once. */
export function followingRun(schedule: ScheduleRow, occurrence: string, now: Date): string {
  const next = nextRun(new Date(occurrence), schedule.run_day_of_month, schedule.frequency);
  return Date.parse(next) > now.getTime() ? next : nextRun(now, schedule.run_day_of_month, schedule.frequency);
}

const finished = (status: string | null | undefined) => status === "complete" || status === "completed";
const inProgress = (status: string | null | undefined) => status === "running" || status === "pending";

export async function runDispatch(job: ScheduledJob, d: DispatchDeps): Promise<JobOutcome> {
  const now = d.now();
  const manual = manualRun(job);
  const schedule = manual ? null : job.schedule_id ? await d.store.schedule(job.schedule_id) : null;
  if (!manual && (!schedule || !schedule.is_active)) return { status: "skipped", reason: "The schedule was deleted or turned off before it ran." };
  const client = await d.store.client(manual ? job.client_id : schedule!.client_id);
  if (!client || client.archived_at) return { status: "skipped", reason: "client archived or missing" };
  const competitive = (manual ? manual.kind : schedule!.report_kind) === "competitive";
  const kind = competitive ? "competitive" : "social";
  const table = competitive ? "competitive_reports" : "reports";
  const memory: DispatchMemory = { ...((job.result ?? {}) as DispatchMemory) };
  const runs: DispatchRun[] = Array.isArray(memory.runs) ? memory.runs.map((r) => ({ ...r })) : [];
  const occurrence = manual ? manual.requested_at : job.occurrence ?? schedule!.next_run_at;
  // A person who changed the schedule meanwhile keeps the next run they chose.
  const moved = !!schedule && new Date(schedule.next_run_at).getTime() !== new Date(occurrence).getTime();
  const deadline = manual
    ? new Date(Date.parse(manual.requested_at) + MANUAL_RUN_DAYS * DAY).toISOString()
    : nextRun(new Date(occurrence), schedule!.run_day_of_month, schedule!.frequency);
  const createdBy = manual ? manual.requested_by : schedule!.created_by;
  /** Where the schedule stands, for the logs; a manual run has no schedule to note. */
  const note = async (result: string | null) => { if (schedule) await d.store.note(schedule.id, result); };

  /** What the job keeps for the occurrence's next run: its period, its runs, and where its alert stands. */
  const keep = (): DispatchMemory => ({
    range: memory.range, runs,
    ...(memory.alerted_at ? { alerted_at: memory.alerted_at } : {}),
    ...(memory.alert_due_at ? { alert_due_at: memory.alert_due_at } : {}),
  });
  /** The report's period, as this occurrence makes it. */
  const period = (): ReportRange => memory.range ?? (manual ? manual.range : rangeForSchedule(schedule!.range_mode, now));
  /** One Slack message; true when it was posted. Nothing here ever changes what the dispatch does. */
  const tell = async (text: string): Promise<boolean> => {
    if (!d.alert || d.dryRun) return false;
    try {
      return await d.alert(text);
    } catch (e) {
      console.warn(`[dispatch] The Slack message for the ${kind} report of ${client.id} was not sent (${e instanceof Error ? e.name : "error"}).`);
      return false;
    }
  };
  /** A run of the report starts. The occurrence's first run sets when its alert is due. */
  const startRun = (reportId: string, startedAt: string) => {
    if (!runs.length && d.alert) memory.alert_due_at = new Date(Date.parse(startedAt) + ALERT_AFTER_MINUTES * MINUTE).toISOString();
    runs.push({ report_id: reportId, started_at: startedAt });
  };
  /**
   * The occurrence's one alert, a day or more after its first run started.
   * True when it was tried now. Tried once at its time: alert_due_at goes
   * either way, and alerted_at is recorded only when it was posted.
   */
  const alertIfLate = async (end: RunEnd | undefined): Promise<boolean> => {
    if (memory.alerted_at || !d.alert || d.dryRun) return false;
    const first = Math.min(...runs.map((r) => Date.parse(r.started_at)).filter(Number.isFinite));
    if (!Number.isFinite(first) || now.getTime() - first < ALERT_AFTER_MINUTES * MINUTE) return false;
    delete memory.alert_due_at;
    const text = stuckReportText({ client: client.name, kind, range: period(), reason: plainReason(end), link: reportsLink(kind, client.id) });
    if (await tell(text)) memory.alerted_at = now.toISOString();
    return true;
  };
  /**
   * When the job is next leased: at the next run, or at the alert's time
   * when that comes first, with the next run's time kept as retry_at.
   */
  const leaseAt = (next: Date, kept: DispatchMemory): string => {
    const due = Date.parse(kept.alert_due_at ?? "");
    if (!Number.isFinite(due) || due >= next.getTime()) return next.toISOString();
    kept.retry_at = next.toISOString();
    return new Date(Math.max(due, now.getTime())).toISOString();
  };

  /** The run with this report ended (why for the logs, end for the alert); the occurrence runs again later, or closes. */
  const runAgain = async (reportId: string | null, why: string, end: RunEnd, run: ReportRun | null = null): Promise<JobOutcome> => {
    const open = reportId ? runs.find((r) => r.report_id === reportId && !r.ended_at) : undefined;
    if (open) Object.assign(open, { ended_at: now.toISOString(), outcome: "stopped" as const, end, note: (run?.error ? `${why}: ${run.error}` : why).slice(0, 300) });
    if (d.dryRun) return { status: "waiting", reason: `dry run: would run again (${why})`, result: keep() };
    if (reportId) {
      await d.store.dropReport(table, reportId);
      if (memory.set_id) await d.store.releaseSet(memory.set_id);
      // A competitive analysis that did not finish never holds the social report.
      if (competitive) await d.store.releaseHeldSocial(client.id);
    }
    // Posted right before the save that keeps alerted_at, so a later run never posts it again.
    await alertIfLate(end);
    const next = nextRunOfOccurrence(runs.length, now, deadline);
    const kept = keep();
    const availableAt = next ? leaseAt(next, kept) : null;
    await d.saveJob({ phase: null, report_id: null, result: kept });
    if (!next) {
      if (schedule) await d.store.close(schedule, moved ? schedule.next_run_at : deadline);
      return { status: "skipped", reason: `No run finished before ${schedule ? "the schedule's next run" : "the manual run's window closed"} (${why}).`, result: kept };
    }
    await note(null);
    // The lease that found this does not count against the job.
    return { status: "queued", reason: `Runs again: ${why}.`, available_at: availableAt!, deferred: true, result: kept };
  };

  /** The report is still running: the job waits, and at the day the one alert says so. */
  const stillRunning = async (): Promise<JobOutcome> => {
    const result = (): DispatchMemory => ({ ...memory, runs });
    // Recorded at once, so a lease that dies after the post does not post it again.
    if (await alertIfLate("still_running")) await d.saveJob({ result: result() });
    return { status: "waiting", reason: "The report is running.", result: result() };
  };

  /** A sent report: done when it finished, waiting while it runs, run again when it stopped. */
  const watch = async (reportId: string): Promise<JobOutcome> => {
    const run = await d.store.reportRun(table, reportId);
    if (run && finished(run.status)) {
      const open = runs.find((r) => r.report_id === reportId && !r.ended_at);
      if (competitive && run.held) {
        // Held: kept for staff, never shown to clients, and made again tomorrow.
        if (open) Object.assign(open, { ended_at: now.toISOString(), outcome: "held" as const, end: "held" as const });
        const held = runs.filter((r) => r.outcome === "held").length;
        const at = Math.min(now.getTime() + HELD_REDO_MINUTES * MINUTE, Date.parse(deadline) - LAST_RUN_LEAD_MINUTES * MINUTE);
        if (held <= HELD_REDOS && at > now.getTime()) {
          if (d.dryRun) return { status: "waiting", reason: "dry run: would make the held analysis again", result: keep() };
          if (memory.set_id) await d.store.releaseSet(memory.set_id);
          // Not shown to clients, so not made yet: held a day or more after the first run, it alerts once.
          await alertIfLate("held");
          const kept = keep();
          const availableAt = leaseAt(new Date(at), kept);
          await d.saveJob({ phase: null, report_id: null, result: kept });
          await note(null);
          return { status: "queued", reason: `The analysis did not pass its checks; it is made again (${held} of ${HELD_REDOS}).`, available_at: availableAt, deferred: true, result: kept };
        }
      } else if (open) {
        Object.assign(open, { ended_at: now.toISOString(), outcome: "ran" as const });
      }
      if (!d.dryRun && schedule) await d.store.advance(schedule, moved ? schedule.next_run_at : followingRun(schedule, occurrence, now), "The report ran.");
      // Made after the alert: one short message says so. A held analysis whose redos ran out was never made.
      if (memory.alerted_at && !(competitive && run.held)) {
        await tell(madeReportText({ client: client.name, kind, range: period(), link: reportsLink(kind, client.id) }));
      }
      return { status: "done", result: { ...memory, runs, report_id: reportId } };
    }
    if (memory.engine === "app" && d.pipelineRun) {
      // Made in the app: the run's own heartbeat, not the report's age, says whether it is stuck.
      const app = await d.pipelineRun(reportId);
      const seen = Date.parse(app?.heartbeat_at ?? "");
      const alive = app?.status === "running" && Number.isFinite(seen) && now.getTime() - seen < STUCK_AFTER_MINUTES * MINUTE;
      if (run && inProgress(run.status) && alive) return stillRunning();
      const [why, end]: [string, RunEnd] = !run ? ["the report was removed", "report_removed"]
        : !app ? ["the in-app pipeline run is gone", "app_gone"]
        : app.status === "stopped" ? [`the in-app pipeline stopped (${app.outcome ?? "no reason recorded"})`, "app_stopped"]
        : app.status === "done" ? ["the in-app pipeline finished without completing the report", "app_ended_without_report"]
        : ["the in-app pipeline stopped answering", "app_stopped_answering"];
      return runAgain(reportId, why, end, run);
    }
    const started = Date.parse(run?.created_at ?? "");
    const stale = !Number.isFinite(started) || now.getTime() - started >= STUCK_AFTER_MINUTES * MINUTE;
    if (run && inProgress(run.status) && !stale) return stillRunning();
    if (!run) return runAgain(reportId, "the report was removed", "report_removed", run);
    return runAgain(reportId, inProgress(run.status) ? "the workflow stopped answering" : "the workflow did not finish the report", "n8n", run);
  };

  if (job.phase === "sent" && job.report_id) return watch(job.report_id);

  if (!job.report_id && job.occurrence && moved) {
    return { status: "skipped", reason: `The schedule moved to ${schedule!.next_run_at} before this run started.` };
  }

  // A manual run that could not start inside its window (tracking that never
  // came, for one) ends quietly; nothing was made, so nothing is shown.
  if (manual && !job.report_id && now.getTime() >= Date.parse(deadline)) {
    return { status: "skipped", reason: `The manual run was asked for ${MANUAL_RUN_DAYS} days ago and could not start.` };
  }

  // Between runs, a lease before the next run's time is the alert's: it checks
  // the alert and puts the job back for that run, starting nothing. Deferred,
  // so the lease is not counted against the job. It comes after the two
  // checks above, so an occurrence a person moved, or a manual run whose
  // window closed, is skipped quietly and never alerted.
  const retryAt = Date.parse(memory.retry_at ?? "");
  if (!job.report_id && !job.phase && Number.isFinite(retryAt) && now.getTime() < retryAt) {
    const tried = await alertIfLate(runs.at(-1)?.end);
    const kept: DispatchMemory = { ...memory, runs };
    const availableAt = leaseAt(new Date(retryAt), kept);
    // Recorded at once, so a lease that dies after the post does not post it again.
    if (tried) await d.saveJob({ result: kept });
    return { status: "queued", reason: `The alert was checked; the report runs again at ${new Date(retryAt).toISOString()}.`, available_at: availableAt, deferred: true, result: kept };
  }

  if (job.attempts > job.max_attempts) {
    const why = `the worker stopped ${job.attempts - 1} times before the request was answered`;
    if (job.report_id) return runAgain(job.report_id, why, "interrupted");
    if (!d.dryRun) await note(`error: ${why}`);
    return { status: "blocked", reason: `The worker stopped ${job.attempts - 1} times before the request was answered.` };
  }

  let reportId: string | null = job.report_id;
  let setId: string | null = memory.set_id ?? null;
  /** Repeating the request a job may already have sent: the same report, range and fence. */
  let repeat = false;
  if (reportId && !d.dryRun) {
    const run = await d.store.reportRun(table, reportId);
    if (job.phase === "posting") {
      const started = Date.parse(run?.created_at ?? "");
      // The workflow may have the request already: its report says so.
      if (!run || !inProgress(run.status)) return watch(reportId);
      if (!Number.isFinite(started) || now.getTime() - started >= STUCK_AFTER_MINUTES * MINUTE) return runAgain(reportId, "the request was never answered", "n8n", run);
      repeat = true;
    } else if (!run || !inProgress(run.status)) {
      // A prepared report that was closed meanwhile is not reused: this run
      // starts over with a new one, and the closed one is taken away.
      if (run) await d.store.dropReport(table, reportId);
      const open = runs.find((r) => r.report_id === reportId && !r.ended_at);
      if (open) Object.assign(open, { ended_at: now.toISOString(), outcome: "stopped" as const, note: "closed before the request was sent" });
      reportId = null;
      setId = null;
      delete memory.set_id;
      delete memory.attempt_started_at;
    }
  }

  /**
   * Where this lease's request goes: the in-app run (app), or the n8n
   * webhook (n8n and shadow, rows set by hand), which only those routes need.
   */
  type Target =
    | { engine: "app"; pipeline?: PipelineDefinition; refused?: string; unreadable?: boolean }
    | { engine: "n8n" | "shadow"; pipeline?: PipelineDefinition; url: string };

  /**
   * The engine switch, read once per lease. n8n and shadow only where a row
   * asks for them; no switch, or one that cannot be read, is app with no
   * pipeline, so nothing goes out and the occurrence runs again later.
   */
  const readRoute = async (): Promise<{ engine: Engine; pipeline?: PipelineDefinition; refused?: string; unreadable?: boolean }> => {
    if (!d.engine) return { engine: "app", refused: "No engine switch is given to this dispatch.", unreadable: true };
    try {
      return await d.engine(kind, client.id);
    } catch (e) {
      const refused = `The engine switch could not be read (${message(e)}).`;
      console.warn(`[dispatch] ${refused}`);
      return { engine: "app", refused, unreadable: true };
    }
  };

  /** What the in-app run is given: the report, its range and the request n8n gets. */
  const pipelineStart = (mode: "shadow" | "app", pipeline: PipelineDefinition, payload: Record<string, unknown>, result: DispatchMemory): ReportPipelineStart => ({
    mode, kind, pipeline, clientId: client.id, reportId: reportId!,
    range: result.range as ReportRange, setId: competitive ? (result.set_id ?? null) : null, request: payload,
  });

  /** The app engine: no request to n8n; the in-app run makes the report and the job watches that run. */
  const startApp = async (pipeline: PipelineDefinition, payload: Record<string, unknown>, result: DispatchMemory): Promise<JobOutcome> => {
    let runId: string;
    try {
      if (!d.startPipeline) throw new Error("nothing can queue it in this dispatch");
      runId = (await d.startPipeline(pipelineStart("app", pipeline, payload, result))).run_id;
    } catch (e) {
      // Nothing started: this run ends and the occurrence runs again.
      Object.assign(memory, result);
      return runAgain(reportId, `the in-app pipeline could not be queued (${message(e)})`, "app_not_queued");
    }
    const open = runs.find((x) => x.report_id === reportId && !x.ended_at);
    if (open) open.engine = "app";
    const started: DispatchMemory = { ...result, runs, engine: "app", pipeline_run_id: runId };
    await d.saveJob({ phase: "sent", result: started });
    await note("The report is running.");
    return { status: "waiting", reason: "The report is running.", result: started };
  };

  /** The shadow: queued once n8n has the request. It never changes this job's outcome. */
  const startShadow = async (pipeline: PipelineDefinition, payload: Record<string, unknown>, result: DispatchMemory) => {
    if (!d.startPipeline) return;
    try {
      await d.startPipeline(pipelineStart("shadow", pipeline, payload, result));
    } catch (e) {
      console.warn(`[dispatch] shadow run not queued for ${reportId}: ${message(e)}`);
    }
  };

  /** Send the request; a confirmed answer moves the job to watching its report. */
  const send = async (target: Target, payload: Record<string, unknown>, result: DispatchMemory): Promise<JobOutcome> => {
    if (target.engine === "app") {
      // A repeated request is made in the app too: the in-app run writes into the same report.
      if (target.pipeline) return startApp(target.pipeline, payload, result);
      // Nothing can make it in the app now: as after a run that stopped, the occurrence runs again later.
      Object.assign(memory, result);
      return runAgain(reportId, `the report could not start in the app (${(target.refused ?? "no in-app pipeline can run").replace(/\.$/, "")})`, target.unreadable ? "engine_unreadable" : "no_pipeline");
    }
    await d.saveJob({ phase: "posting", result });
    let r: { ok: boolean; status: number };
    try {
      r = await d.post(target.url, payload);
    } catch (e) {
      // Unanswered: the workflow may have the request. It is sent again for
      // the same report shortly, which can never make a second report.
      return { status: "queued", reason: `The request was not answered (${message(e)}); it is sent again shortly.`, available_at: new Date(now.getTime() + RETRY_MINUTES * MINUTE).toISOString(), deferred: true, result };
    }
    // Refused: nothing started, so this run ends and the occurrence runs again.
    if (!r.ok) {
      Object.assign(memory, result);
      return runAgain(reportId, `the workflow refused the request (${r.status})`, "n8n");
    }
    await d.saveJob({ phase: "sent", result });
    if (target.engine === "shadow" && target.pipeline) await startShadow(target.pipeline, payload, result);
    await note("The report is running.");
    return { status: "waiting", reason: "The report is running.", result };
  };

  try {
    const hooks = await d.store.webhooks();
    const route = await readRoute();
    const url = competitive ? hooks.competitive : hooks.social;
    let target: Target;
    if (route.engine === "app") target = { engine: "app", pipeline: route.pipeline, refused: route.refused, unreadable: route.unreadable };
    else if (url) target = { engine: route.engine, pipeline: route.pipeline, url };
    // Only a request to n8n needs its webhook. Without it: blocked, before anything is made.
    else throw new Error(competitive ? "competitive webhook URL not configured" : "n8n webhook URL not configured");

    if (competitive) {
      const set = await d.store.competitorSet(client.id);
      if (!set) {
        const reason = "Waiting for a confirmed competitor set. The paired social report goes ahead without it.";
        if (!d.dryRun) {
          await note(reason);
          await d.store.releaseHeldSocial(client.id);
        }
        return { status: "waiting", reason };
      }
      if (!reportId) {
        // Before any report row exists or anything is sent: does RivalIQ
        // track this client? A resumed job already passed this check.
        const tracking = await d.checkLandscape(client, set);
        if (isTrackingProblem(tracking)) {
          // Not set up: wait, rechecked daily, so the report runs once
          // tracking is connected. A linked landscape that disappeared:
          // blocked, which the daily status check alerts on.
          const reason = `${NEEDS_TRACKING}: ${tracking.message}`;
          if (!d.dryRun) {
            await note(reason);
            await d.store.releaseHeldSocial(client.id);
          }
          return { status: tracking.code === LANDSCAPE_MISSING ? "blocked" : "waiting", reason, result: { ...memory, code: tracking.code, set_id: set.id } };
        }
        if (!tracking.ok) {
          // RivalIQ could not be asked. Try again shortly; once the attempts
          // are used up a person looks, and the social report goes ahead.
          if (job.attempts < job.max_attempts) {
            return { status: "queued", reason: tracking.message, available_at: new Date(now.getTime() + RETRY_MINUTES * MINUTE).toISOString() };
          }
          if (!d.dryRun) {
            await note(`error: ${tracking.message}`);
            await d.store.releaseHeldSocial(client.id);
          }
          // Blocked jobs are put back in the queue daily with this memory: the runs and the alert stay.
          return { status: "blocked", reason: tracking.message, result: { ...keep(), code: tracking.code } };
        }
      }
      const range = period();
      const attemptStartedAt = (reportId && memory.attempt_started_at) || now.toISOString();
      if (!reportId) {
        if (d.dryRun) {
          reportId = "dry-run";
        } else {
          reportId = await d.store.insertCompetitiveReport({ created_at: attemptStartedAt, client_id: client.id, set_id: set.id, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end, created_by: createdBy });
          setId = set.id;
          startRun(reportId, attemptStartedAt);
          await d.saveJob({ phase: "prepared", report_id: reportId, result: { ...memory, set_id: set.id, attempt_started_at: attemptStartedAt, range, runs } });
        }
      }
      const result: DispatchMemory = { ...memory, set_id: setId ?? set.id, attempt_started_at: attemptStartedAt, range, runs };
      memory.set_id = result.set_id;
      if (!d.dryRun) {
        // Both guarded, so a resumed job repeats them safely. Only a
        // schedule's analysis holds the due social report.
        if (schedule) await d.store.holdSocial(client.id, reportId, now);
        await d.store.setAnalyzing(set.id);
      }
      const payload = await d.buildCompetitivePayload({ client, reportId, set, range, attemptStartedAt, scheduled: !manual, staggerSeconds: job.stagger_seconds });
      if (d.dryRun) return { status: "done", reason: "dry run: would post", result: { ...result, payload_keys: Object.keys(payload) } };
      return await send(target, payload, result);
    }

    // Social.
    let range = period();
    let wait: string | null = null;
    /** The competitive report this social report is built on, when it is the pinned one. */
    let competitiveReportId: string | undefined;
    /** A pinned competitive report that will not arrive, and what became of it. */
    let without: string | null = null;
    const dependencyId = schedule?.pending_competitive_report_id || undefined;
    if (repeat) {
      // The same request as the one that may already have gone out.
      competitiveReportId = memory.competitive_report_id ?? undefined;
    } else if (dependencyId) {
      const dependency = await d.store.competitiveReport(dependencyId, client.id);
      if (dependency?.status === "complete") {
        if (!dependency.date_range_start || !dependency.date_range_end) throw new Error("The required competitive report has no reporting period.");
        range = { start: dependency.date_range_start, end: dependency.date_range_end };
        competitiveReportId = dependencyId;
      } else if (dependency?.status === "running") {
        // Released by release_ready_dispatches when it finishes; one that
        // stops is taken away by its own dispatch, which releases this one.
        wait = `Waiting for competitive report ${dependencyId} to finish.`;
      } else {
        // Did not finish, or gone. The social report does not wait for a
        // competitive report that is not coming: it uses the latest complete analysis.
        without = `competitive report ${dependencyId} ${dependency ? `(${dependency.status})` : "(no longer available)"}`;
      }
    } else if (schedule && await d.store.pairedCompetitivePending(client.id, now)) {
      wait = "Waiting for the due competitive analysis to start.";
    }
    if (wait && !d.dryRun) {
      await note(wait);
      return { status: "waiting", reason: wait };
    }

    if (!reportId) {
      if (d.dryRun) {
        reportId = "dry-run";
      } else {
        reportId = await d.store.insertSocialReport({ client_id: client.id, status: "running", report_data: {}, created_by: createdBy, date_range_start: range.start, date_range_end: range.end });
        startRun(reportId, now.toISOString());
        await d.saveJob({ phase: "prepared", report_id: reportId, result: { ...memory, range, runs } });
      }
    }
    const sentOn = wait ? undefined : competitiveReportId;
    const result: DispatchMemory = {
      ...memory, range, runs, competitive_report_id: sentOn ?? null,
      ...(without && dependencyId ? { competitive_report_skipped: dependencyId } : {}),
    };
    const payload = await d.buildSocialPayload({ client, reportId, range, scheduled: !manual, staggerSeconds: job.stagger_seconds, competitiveReportId: sentOn, ...(manual?.skip_trends ? { skipTrends: true } : {}) });
    if (d.dryRun) {
      const preview = { range, payload_keys: Object.keys(payload) };
      return wait
        ? { status: "waiting", reason: `dry run: ${wait}`, result: preview }
        : { status: "done", reason: "dry run: would post", result: preview };
    }
    return await send(target, payload, result);
  } catch (err) {
    const msg = message(err);
    if (d.dryRun) return { status: "failed", reason: `dry run: ${msg}` };
    // A report this job opened is taken away and the occurrence runs again.
    if (reportId) return runAgain(reportId, msg, "error");
    await note(`error: ${msg}`);
    return { status: "blocked", reason: msg };
  }
}
