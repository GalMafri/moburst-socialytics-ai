// One scheduled report dispatch: one schedule occurrence, one n8n run.
//
// The rules are the ones trigger-scheduled-reports applied inside its single
// request (competitive needs a set in an accepted status; social waits for a
// due paired competitive analysis and then for the competitive report it is
// pinned to; the range comes from that report). What changed is that each
// dispatch is its own job with recorded phases, so an interruption is
// resumed or closed instead of left as a claim someone has to review:
//
//   prepared  the report row exists and its id is on the job. A resumed job
//             reuses it.
//   posting   written immediately before the webhook request. A job found in
//             this phase never posts again: n8n may already have started, so
//             the report is closed as unconfirmed (the Retry control's path).

import { nextRun, rangeForSchedule, type ReportRange } from "../_shared/reports/schedule.ts";
import type { JobOutcome, ScheduledJob } from "./types.ts";

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

/** Everything a dispatch reads and writes, so the rules can run against a fake. */
export interface DispatchStore {
  schedule(id: string): Promise<ScheduleRow | null>;
  client(id: string): Promise<ClientRow | null>;
  /** The client's latest competitor set in confirmed, analyzing, complete or failed. */
  competitorSet(clientId: string): Promise<CompetitorSetRow | null>;
  competitiveReport(id: string, clientId: string): Promise<{ status: string; date_range_start: string | null; date_range_end: string | null } | null>;
  pairedCompetitiveDue(clientId: string, now: Date): Promise<boolean>;
  webhooks(): Promise<{ social: string | null; competitive: string | null }>;
  insertCompetitiveReport(row: NewReportRow & { created_at: string; set_id: string }): Promise<string>;
  insertSocialReport(row: NewReportRow): Promise<string>;
  /** Pin the client's due social schedules (none pinned yet) to this competitive report. */
  holdSocial(clientId: string, competitiveReportId: string, now: Date): Promise<void>;
  setAnalyzing(setId: string): Promise<void>;
  /** Close a report that is still running, with the reason. */
  failReport(table: "reports" | "competitive_reports", id: string, message: string): Promise<void>;
  /** Move a set this dispatch put into analyzing back to failed. */
  failSet(setId: string): Promise<void>;
  /** The occurrence is over: last run, next run, result, pin cleared. */
  advance(schedule: ScheduleRow, now: Date, result: string): Promise<void>;
  /** Record why the schedule has not run yet (shown on the client setup page). */
  note(scheduleId: string, result: string): Promise<void>;
}

export interface DispatchDeps {
  store: DispatchStore;
  now(): Date;
  /** Sends the workflow request. Throws on a network failure. */
  post(url: string, body: unknown): Promise<{ ok: boolean; status: number }>;
  buildSocialPayload(args: { client: ClientRow; reportId: string; range: ReportRange; scheduled: true; staggerSeconds: number; competitiveReportId?: string }): Promise<Record<string, unknown>>;
  buildCompetitivePayload(args: { client: ClientRow; reportId: string; set: CompetitorSetRow; range: ReportRange; attemptStartedAt: string; scheduled: true; staggerSeconds: number }): Promise<Record<string, unknown>>;
  /** Persist the job's phase before the step that depends on it. */
  saveJob(patch: Partial<Pick<ScheduledJob, "phase" | "report_id" | "result">>): Promise<void>;
  /** Read and build everything, write nothing, send nothing. */
  dryRun?: boolean;
}

const UNCONFIRMED = "the worker stopped while sending the request, so n8n may or may not have started";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function makePoster(secret: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)) {
  return async (url: string, body: unknown) => {
    const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret }, body: JSON.stringify(body) });
    await r.body?.cancel().catch(() => {});
    return { ok: r.ok, status: r.status };
  };
}

export async function runDispatch(job: ScheduledJob, d: DispatchDeps): Promise<JobOutcome> {
  const now = d.now();
  const schedule = job.schedule_id ? await d.store.schedule(job.schedule_id) : null;
  if (!schedule || !schedule.is_active) return { status: "skipped", reason: "The schedule was deleted or turned off before it ran." };
  const client = await d.store.client(schedule.client_id);
  if (!client || client.archived_at) return { status: "skipped", reason: "client archived or missing" };
  const competitive = schedule.report_kind === "competitive";
  const table = competitive ? "competitive_reports" : "reports";
  const prior = (job.result ?? {}) as { set_id?: string; attempt_started_at?: string; range?: ReportRange };

  if (job.phase === "posting") {
    if (!d.dryRun) {
      if (job.report_id) await d.store.failReport(table, job.report_id, `Dispatch could not be confirmed: ${UNCONFIRMED}. Check the n8n execution before retrying.`);
      if (prior.set_id) await d.store.failSet(prior.set_id);
      await d.store.advance(schedule, now, `error: dispatch could not be confirmed (${UNCONFIRMED})`);
    }
    return { status: "failed", reason: `Dispatch could not be confirmed: ${UNCONFIRMED}.`, result: { ...prior, report_id: job.report_id } };
  }

  if (!job.report_id && job.occurrence && new Date(schedule.next_run_at).getTime() !== new Date(job.occurrence).getTime()) {
    return { status: "skipped", reason: `The schedule moved to ${schedule.next_run_at} before this run started.` };
  }

  if (job.attempts > job.max_attempts) {
    const why = `stopped ${job.attempts - 1} times before the request was sent`;
    if (job.report_id) {
      if (!d.dryRun) {
        await d.store.failReport(table, job.report_id, `Dispatch could not be completed: the worker ${why}.`);
        if (prior.set_id) await d.store.failSet(prior.set_id);
        await d.store.advance(schedule, now, `error: the worker ${why}`);
      }
      return { status: "failed", reason: `The worker ${why}.`, result: { ...prior, report_id: job.report_id } };
    }
    if (!d.dryRun) await d.store.note(schedule.id, `error: the worker ${why}`);
    return { status: "blocked", reason: `The worker ${why}.` };
  }

  let reportId: string | null = job.report_id;
  let setId: string | null = prior.set_id ?? null;
  try {
    const hooks = await d.store.webhooks();

    if (competitive) {
      if (!hooks.competitive) throw new Error("competitive webhook URL not configured");
      const set = await d.store.competitorSet(client.id);
      if (!set) {
        const reason = "Waiting for a confirmed competitor set; paired social report is held.";
        if (!d.dryRun) await d.store.note(schedule.id, reason);
        return { status: "waiting", reason };
      }
      const range = prior.range ?? rangeForSchedule(schedule.range_mode, now);
      const attemptStartedAt = prior.attempt_started_at ?? now.toISOString();
      const result = { set_id: set.id, attempt_started_at: attemptStartedAt, range };
      if (!reportId) {
        if (d.dryRun) {
          reportId = "dry-run";
        } else {
          reportId = await d.store.insertCompetitiveReport({ created_at: attemptStartedAt, client_id: client.id, set_id: set.id, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end, created_by: schedule.created_by });
          setId = set.id;
          await d.saveJob({ phase: "prepared", report_id: reportId, result });
          await d.store.holdSocial(client.id, reportId, now);
          await d.store.setAnalyzing(set.id);
        }
      }
      const payload = await d.buildCompetitivePayload({ client, reportId, set, range, attemptStartedAt, scheduled: true, staggerSeconds: job.stagger_seconds });
      if (d.dryRun) return { status: "done", reason: "dry run: would post", result: { ...result, payload_keys: Object.keys(payload) } };
      await d.saveJob({ phase: "posting" });
      const r = await d.post(hooks.competitive, payload);
      if (!r.ok) throw new Error(`competitive webhook ${r.status}`);
      await d.store.advance(schedule, now, `triggered competitive report ${reportId}`);
      return { status: "done", result: { ...result, report_id: reportId } };
    }

    // Social.
    if (!hooks.social) throw new Error("n8n webhook URL not configured");
    let range = prior.range ?? rangeForSchedule(schedule.range_mode, now);
    let wait: { reason: string; blocked: boolean } | null = null;
    const dependencyId = schedule.pending_competitive_report_id || undefined;
    if (dependencyId) {
      const dependency = await d.store.competitiveReport(dependencyId, client.id);
      if (dependency?.status !== "complete") {
        wait = {
          reason: `Waiting for competitive report ${dependencyId} (${dependency?.status || "unavailable"}). Retry that report if it failed.`,
          blocked: dependency?.status === "failed" || !dependency,
        };
      } else {
        if (!dependency.date_range_start || !dependency.date_range_end) throw new Error("The required competitive report has no reporting period.");
        range = { start: dependency.date_range_start, end: dependency.date_range_end };
      }
    } else if (await d.store.pairedCompetitiveDue(client.id, now)) {
      wait = { reason: "Waiting for the due competitive analysis to start.", blocked: false };
    }
    if (wait && !d.dryRun) {
      await d.store.note(schedule.id, wait.reason);
      return { status: wait.blocked ? "blocked" : "waiting", reason: wait.reason };
    }

    const result = { range };
    if (!reportId) {
      if (d.dryRun) {
        reportId = "dry-run";
      } else {
        reportId = await d.store.insertSocialReport({ client_id: client.id, status: "running", report_data: {}, created_by: schedule.created_by, date_range_start: range.start, date_range_end: range.end });
        await d.saveJob({ phase: "prepared", report_id: reportId, result });
      }
    }
    const payload = await d.buildSocialPayload({ client, reportId, range, scheduled: true, staggerSeconds: job.stagger_seconds, competitiveReportId: wait ? undefined : dependencyId });
    if (d.dryRun) {
      const preview = { ...result, payload_keys: Object.keys(payload) };
      return wait
        ? { status: wait.blocked ? "blocked" : "waiting", reason: `dry run: ${wait.reason}`, result: preview }
        : { status: "done", reason: "dry run: would post", result: preview };
    }
    await d.saveJob({ phase: "posting" });
    const r = await d.post(hooks.social, payload);
    if (!r.ok) throw new Error(`social webhook ${r.status}`);
    await d.store.advance(schedule, now, `triggered social report ${reportId}`);
    return { status: "done", result: { ...result, report_id: reportId, competitive_report_id: dependencyId ?? null } };
  } catch (err) {
    const msg = message(err);
    if (d.dryRun) return { status: "failed", reason: `dry run: ${msg}` };
    // A report this job opened is closed now, rather than left showing as in
    // progress; both updates are guarded on the status this job set.
    if (reportId) {
      await d.store.failReport(table, reportId, `Dispatch could not be confirmed: ${msg}. Check the n8n execution before retrying.`);
      if (setId) await d.store.failSet(setId);
      await d.store.advance(schedule, now, `error: ${msg}`);
      return { status: "failed", reason: msg, result: { ...prior, report_id: reportId } };
    }
    await d.store.note(schedule.id, `error: ${msg}`);
    return { status: "blocked", reason: msg };
  }
}

/** next_run_at after this occurrence, exported for the store. */
export const followingRun = (schedule: ScheduleRow, now: Date) => nextRun(now, schedule.run_day_of_month, schedule.frequency);
