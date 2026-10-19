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
// Each dispatch is its own job with recorded phases:
//
//   prepared  the report row exists and its id is on the job. A resumed job
//             reuses it.
//   posting   written immediately before the webhook request. A job found in
//             this phase sends the same request again: the workflow writes
//             into that one report (a competitive one is also fenced by
//             attempt_started_at), so a repeat never makes a second report.
//   sent      the workflow accepted the request. From here the job only
//             watches its report.

import { nextRun, rangeForSchedule, type ReportRange } from "../_shared/reports/schedule.ts";
import { STUCK_AFTER_MINUTES } from "../_shared/reports/payloads.ts";
import { isTrackingProblem, LANDSCAPE_MISSING, type LandscapeCheck } from "../_shared/competitive/landscapeCheck.ts";
import type { JobOutcome, ScheduledJob } from "./types.ts";
import { RETRY_MINUTES } from "./worker.ts";

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
  buildSocialPayload(args: { client: ClientRow; reportId: string; range: ReportRange; scheduled: true; staggerSeconds: number; competitiveReportId?: string }): Promise<Record<string, unknown>>;
  buildCompetitivePayload(args: { client: ClientRow; reportId: string; set: CompetitorSetRow; range: ReportRange; attemptStartedAt: string; scheduled: true; staggerSeconds: number }): Promise<Record<string, unknown>>;
  /** The shared RivalIQ landscape check (landscapeCheck.ts), bound to the project's key. One provider read. */
  checkLandscape(client: ClientRow, set: CompetitorSetRow): Promise<LandscapeCheck>;
  /** Persist the job's phase before the step that depends on it. */
  saveJob(patch: Partial<Pick<ScheduledJob, "phase" | "report_id" | "result">>): Promise<void>;
  /** Read and build everything, write nothing, send nothing. */
  dryRun?: boolean;
}

/** One run of an occurrence, kept on the job for the logs. */
export interface DispatchRun {
  report_id: string;
  started_at: string;
  ended_at?: string;
  outcome?: "ran" | "stopped";
  note?: string;
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
  [key: string]: unknown;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MINUTE = 60_000;

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
  const schedule = job.schedule_id ? await d.store.schedule(job.schedule_id) : null;
  if (!schedule || !schedule.is_active) return { status: "skipped", reason: "The schedule was deleted or turned off before it ran." };
  const client = await d.store.client(schedule.client_id);
  if (!client || client.archived_at) return { status: "skipped", reason: "client archived or missing" };
  const competitive = schedule.report_kind === "competitive";
  const table = competitive ? "competitive_reports" : "reports";
  const memory: DispatchMemory = { ...((job.result ?? {}) as DispatchMemory) };
  const runs: DispatchRun[] = Array.isArray(memory.runs) ? memory.runs.map((r) => ({ ...r })) : [];
  const occurrence = job.occurrence ?? schedule.next_run_at;
  // A person who changed the schedule meanwhile keeps the next run they chose.
  const moved = new Date(schedule.next_run_at).getTime() !== new Date(occurrence).getTime();
  const deadline = nextRun(new Date(occurrence), schedule.run_day_of_month, schedule.frequency);

  /** The run with this report ended; the occurrence runs again later, or closes. */
  const runAgain = async (reportId: string | null, why: string, run: ReportRun | null = null): Promise<JobOutcome> => {
    const open = reportId ? runs.find((r) => r.report_id === reportId && !r.ended_at) : undefined;
    if (open) Object.assign(open, { ended_at: now.toISOString(), outcome: "stopped" as const, note: (run?.error ? `${why}: ${run.error}` : why).slice(0, 300) });
    const kept: DispatchMemory = { range: memory.range, runs };
    if (d.dryRun) return { status: "waiting", reason: `dry run: would run again (${why})`, result: kept };
    if (reportId) {
      await d.store.dropReport(table, reportId);
      if (memory.set_id) await d.store.releaseSet(memory.set_id);
      // A competitive analysis that did not finish never holds the social report.
      if (competitive) await d.store.releaseHeldSocial(client.id);
    }
    await d.saveJob({ phase: null, report_id: null, result: kept });
    const next = nextRunOfOccurrence(runs.length, now, deadline);
    if (!next) {
      await d.store.close(schedule, moved ? schedule.next_run_at : deadline);
      return { status: "skipped", reason: `No run finished before the schedule's next run (${why}).`, result: kept };
    }
    await d.store.note(schedule.id, null);
    // The lease that found this does not count against the job.
    return { status: "queued", reason: `Runs again: ${why}.`, available_at: next.toISOString(), deferred: true, result: kept };
  };

  /** A sent report: done when it finished, waiting while it runs, run again when it stopped. */
  const watch = async (reportId: string): Promise<JobOutcome> => {
    const run = await d.store.reportRun(table, reportId);
    if (run && finished(run.status)) {
      const open = runs.find((r) => r.report_id === reportId && !r.ended_at);
      if (open) Object.assign(open, { ended_at: now.toISOString(), outcome: "ran" as const });
      if (!d.dryRun) await d.store.advance(schedule, moved ? schedule.next_run_at : followingRun(schedule, occurrence, now), "The report ran.");
      return { status: "done", result: { ...memory, runs, report_id: reportId } };
    }
    const started = Date.parse(run?.created_at ?? "");
    const stale = !Number.isFinite(started) || now.getTime() - started >= STUCK_AFTER_MINUTES * MINUTE;
    if (run && inProgress(run.status) && !stale) return { status: "waiting", reason: "The report is running.", result: { ...memory, runs } };
    return runAgain(reportId, !run ? "the report was removed" : inProgress(run.status) ? "the workflow stopped answering" : "the workflow did not finish the report", run);
  };

  if (job.phase === "sent" && job.report_id) return watch(job.report_id);

  if (!job.report_id && job.occurrence && moved) {
    return { status: "skipped", reason: `The schedule moved to ${schedule.next_run_at} before this run started.` };
  }

  if (job.attempts > job.max_attempts) {
    const why = `the worker stopped ${job.attempts - 1} times before the request was answered`;
    if (job.report_id) return runAgain(job.report_id, why);
    if (!d.dryRun) await d.store.note(schedule.id, `error: ${why}`);
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
      if (!Number.isFinite(started) || now.getTime() - started >= STUCK_AFTER_MINUTES * MINUTE) return runAgain(reportId, "the request was never answered", run);
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

  /** Send the request; a confirmed answer moves the job to watching its report. */
  const send = async (url: string, payload: Record<string, unknown>, result: DispatchMemory): Promise<JobOutcome> => {
    await d.saveJob({ phase: "posting", result });
    let r: { ok: boolean; status: number };
    try {
      r = await d.post(url, payload);
    } catch (e) {
      // Unanswered: the workflow may have the request. It is sent again for
      // the same report shortly, which can never make a second report.
      return { status: "queued", reason: `The request was not answered (${message(e)}); it is sent again shortly.`, available_at: new Date(now.getTime() + RETRY_MINUTES * MINUTE).toISOString(), deferred: true, result };
    }
    // Refused: nothing started, so this run ends and the occurrence runs again.
    if (!r.ok) {
      Object.assign(memory, result);
      return runAgain(reportId, `the workflow refused the request (${r.status})`);
    }
    await d.saveJob({ phase: "sent", result });
    await d.store.note(schedule.id, "The report is running.");
    return { status: "waiting", reason: "The report is running.", result };
  };

  try {
    const hooks = await d.store.webhooks();

    if (competitive) {
      if (!hooks.competitive) throw new Error("competitive webhook URL not configured");
      const set = await d.store.competitorSet(client.id);
      if (!set) {
        const reason = "Waiting for a confirmed competitor set. The paired social report goes ahead without it.";
        if (!d.dryRun) {
          await d.store.note(schedule.id, reason);
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
            await d.store.note(schedule.id, reason);
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
            await d.store.note(schedule.id, `error: ${tracking.message}`);
            await d.store.releaseHeldSocial(client.id);
          }
          return { status: "blocked", reason: tracking.message, result: { code: tracking.code } };
        }
      }
      const range = memory.range ?? rangeForSchedule(schedule.range_mode, now);
      const attemptStartedAt = (reportId && memory.attempt_started_at) || now.toISOString();
      if (!reportId) {
        if (d.dryRun) {
          reportId = "dry-run";
        } else {
          reportId = await d.store.insertCompetitiveReport({ created_at: attemptStartedAt, client_id: client.id, set_id: set.id, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end, created_by: schedule.created_by });
          setId = set.id;
          runs.push({ report_id: reportId, started_at: attemptStartedAt });
          await d.saveJob({ phase: "prepared", report_id: reportId, result: { ...memory, set_id: set.id, attempt_started_at: attemptStartedAt, range, runs } });
        }
      }
      const result: DispatchMemory = { ...memory, set_id: setId ?? set.id, attempt_started_at: attemptStartedAt, range, runs };
      memory.set_id = result.set_id;
      if (!d.dryRun) {
        // Both guarded, so a resumed job repeats them safely.
        await d.store.holdSocial(client.id, reportId, now);
        await d.store.setAnalyzing(set.id);
      }
      const payload = await d.buildCompetitivePayload({ client, reportId, set, range, attemptStartedAt, scheduled: true, staggerSeconds: job.stagger_seconds });
      if (d.dryRun) return { status: "done", reason: "dry run: would post", result: { ...result, payload_keys: Object.keys(payload) } };
      return await send(hooks.competitive, payload, result);
    }

    // Social.
    if (!hooks.social) throw new Error("n8n webhook URL not configured");
    let range = memory.range ?? rangeForSchedule(schedule.range_mode, now);
    let wait: string | null = null;
    /** The competitive report this social report is built on, when it is the pinned one. */
    let competitiveReportId: string | undefined;
    /** A pinned competitive report that will not arrive, and what became of it. */
    let without: string | null = null;
    const dependencyId = schedule.pending_competitive_report_id || undefined;
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
    } else if (await d.store.pairedCompetitivePending(client.id, now)) {
      wait = "Waiting for the due competitive analysis to start.";
    }
    if (wait && !d.dryRun) {
      await d.store.note(schedule.id, wait);
      return { status: "waiting", reason: wait };
    }

    if (!reportId) {
      if (d.dryRun) {
        reportId = "dry-run";
      } else {
        reportId = await d.store.insertSocialReport({ client_id: client.id, status: "running", report_data: {}, created_by: schedule.created_by, date_range_start: range.start, date_range_end: range.end });
        runs.push({ report_id: reportId, started_at: now.toISOString() });
        await d.saveJob({ phase: "prepared", report_id: reportId, result: { ...memory, range, runs } });
      }
    }
    const sentOn = wait ? undefined : competitiveReportId;
    const result: DispatchMemory = {
      ...memory, range, runs, competitive_report_id: sentOn ?? null,
      ...(without && dependencyId ? { competitive_report_skipped: dependencyId } : {}),
    };
    const payload = await d.buildSocialPayload({ client, reportId, range, scheduled: true, staggerSeconds: job.stagger_seconds, competitiveReportId: sentOn });
    if (d.dryRun) {
      const preview = { range, payload_keys: Object.keys(payload) };
      return wait
        ? { status: "waiting", reason: `dry run: ${wait}`, result: preview }
        : { status: "done", reason: "dry run: would post", result: preview };
    }
    return await send(hooks.social, payload, result);
  } catch (err) {
    const msg = message(err);
    if (d.dryRun) return { status: "failed", reason: `dry run: ${msg}` };
    // A report this job opened is taken away and the occurrence runs again.
    if (reportId) return runAgain(reportId, msg);
    await d.store.note(schedule.id, `error: ${msg}`);
    return { status: "blocked", reason: msg };
  }
}
