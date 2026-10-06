// scheduled_jobs and the report tables over supabase-js, as the worker and the
// dispatch rules need them. Every write that can race a callback is guarded
// on the status this worker set, as the single-request scheduler did.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { followingRun, type ClientRow, type CompetitorSetRow, type DispatchStore, type ScheduleRow } from "./dispatch.ts";
import { TERMINAL, type JobOutcome, type ScheduledJob } from "./types.ts";
import type { ScheduleGap } from "./worker.ts";

const SCHEDULE_COLUMNS = "id, client_id, report_kind, is_active, next_run_at, run_day_of_month, frequency, range_mode, created_by, pending_competitive_report_id";
const SET_STATUSES = ["confirmed", "analyzing", "complete", "failed"];

type Result<T> = { data: T; error: { message: string } | null };
async function must<T>(p: PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export interface JobStore {
  lease(leaseSeconds: number): Promise<ScheduledJob | null>;
  saveJob(id: string, patch: Partial<Pick<ScheduledJob, "phase" | "report_id" | "result">>): Promise<void>;
  finish(job: ScheduledJob, outcome: JobOutcome): Promise<void>;
  /** Jobs the daily check looks at: everything open, and everything finished in the last day and a half. */
  statusRows(now: Date): Promise<ScheduledJob[]>;
  /** Held social jobs whose competitive report finished, back in the queue. */
  releaseReady(): Promise<number>;
  /** Due schedule occurrences with no job (scheduled_report_gaps). */
  gaps(now: Date): Promise<ScheduleGap[]>;
  enqueue(dryRun: boolean): Promise<{ dry_run: boolean; released: number; enqueued: Array<{ kind: string; client_id: string; schedule_id: string | null; detail: string; priority: number; stagger_seconds: number }> }>;
}

export function makeJobStore(db: SupabaseClient): JobStore {
  return {
    async lease(leaseSeconds) {
      const rows = await must(db.rpc("scheduled_jobs_lease", { p_lease_seconds: leaseSeconds }) as unknown as PromiseLike<Result<ScheduledJob[] | null>>);
      return rows?.[0] ?? null;
    },
    async saveJob(id, patch) {
      await must(db.from("scheduled_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
    },
    async finish(job, outcome) {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: outcome.status,
        reason: outcome.reason ?? null,
        lease_until: null,
        updated_at: now,
      };
      if (outcome.result !== undefined) patch.result = outcome.result;
      if (outcome.available_at) patch.available_at = outcome.available_at;
      if (TERMINAL.has(outcome.status)) patch.finished_at = now;
      // Attempts count consecutive interruptions. A job parked to wait for a
      // dependency starts counting again when it is released.
      if (outcome.status === "waiting" || outcome.status === "blocked") patch.attempts = 0;
      await must(db.from("scheduled_jobs").update(patch).eq("id", job.id));
    },
    async statusRows(now) {
      const since = new Date(now.getTime() - 36 * 3_600_000).toISOString();
      const rows = await must(db.from("scheduled_jobs").select("*, clients(name), report_schedules(report_kind)").or(`status.in.(queued,running,waiting,blocked),finished_at.gte."${since}"`).order("created_at", { ascending: false }).limit(1000));
      return (rows ?? []) as ScheduledJob[];
    },
    async gaps(now) {
      return ((await must(db.rpc("scheduled_report_gaps", { p_now: now.toISOString() }) as unknown as PromiseLike<Result<ScheduleGap[] | null>>)) ?? []);
    },
    async releaseReady() {
      return (await must(db.rpc("release_ready_dispatches") as unknown as PromiseLike<Result<number | null>>)) ?? 0;
    },
    async enqueue(dryRun) {
      return await must(db.rpc("enqueue_scheduled_report_jobs", { p_dry_run: dryRun }) as unknown as PromiseLike<Result<Awaited<ReturnType<JobStore["enqueue"]>>>>);
    },
  };
}

export function makeDispatchStore(db: SupabaseClient): DispatchStore {
  return {
    async schedule(id) {
      return (await must(db.from("report_schedules").select(SCHEDULE_COLUMNS).eq("id", id).maybeSingle())) as ScheduleRow | null;
    },
    async client(id) {
      return (await must(db.from("clients").select("*").eq("id", id).maybeSingle())) as ClientRow | null;
    },
    async competitorSet(clientId) {
      // Same statuses every other consumer accepts. Restricting the scheduler to
      // confirmed|complete meant a client whose last run failed, or whose set
      // was left mid-analysis, silently stopped being scheduled altogether.
      return (await must(db.from("competitor_sets").select("*").eq("client_id", clientId).in("status", SET_STATUSES)
        .order("confirmed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle())) as CompetitorSetRow | null;
    },
    async competitiveReport(id, clientId) {
      return (await must(db.from("competitive_reports").select("status, date_range_start, date_range_end").eq("id", id).eq("client_id", clientId).maybeSingle())) as
        { status: string; date_range_start: string | null; date_range_end: string | null } | null;
    },
    async reportStatus(table, id) {
      const r = (await must(db.from(table).select("status").eq("id", id).maybeSingle())) as { status: string } | null;
      return r?.status ?? null;
    },
    async pairedCompetitiveDue(clientId, now) {
      const rows = await must(db.from("report_schedules").select("id").eq("client_id", clientId).eq("report_kind", "competitive").eq("is_active", true).lte("next_run_at", now.toISOString()).limit(1));
      return ((rows ?? []) as unknown[]).length > 0;
    },
    async webhooks() {
      const rows = (await must(db.from("app_settings").select("key, value").in("key", ["n8n_webhook_url", "competitive_n8n_webhook_url"]))) as Array<{ key: string; value: string | null }> | null;
      const get = (k: string) => rows?.find((r) => r.key === k)?.value || null;
      return { social: get("n8n_webhook_url"), competitive: get("competitive_n8n_webhook_url") };
    },
    async insertCompetitiveReport(row) {
      const r = (await must(db.from("competitive_reports").insert(row).select("id").single())) as { id: string };
      return r.id;
    },
    async insertSocialReport(row) {
      const r = (await must(db.from("reports").insert(row).select("id").single())) as { id: string };
      return r.id;
    },
    async holdSocial(clientId, competitiveReportId, now) {
      await must(db.from("report_schedules")
        .update({ pending_competitive_report_id: competitiveReportId, last_result: `Waiting for competitive report ${competitiveReportId}` })
        .eq("client_id", clientId).eq("report_kind", "social").eq("is_active", true)
        .lte("next_run_at", now.toISOString()).is("pending_competitive_report_id", null));
    },
    async setAnalyzing(setId) {
      await must(db.from("competitor_sets").update({ status: "analyzing" }).eq("id", setId).in("status", ["confirmed", "complete", "failed"]));
    },
    async failReport(table, id, message) {
      await must(db.from(table).update({ status: "failed", report_data: { error: message } }).eq("id", id).eq("status", "running"));
    },
    async failSet(setId) {
      await must(db.from("competitor_sets").update({ status: "failed" }).eq("id", setId).eq("status", "analyzing"));
    },
    async advance(schedule, now, result) {
      await must(db.from("report_schedules").update({
        last_run_at: now.toISOString(),
        next_run_at: followingRun(schedule, now),
        last_result: result.slice(0, 500),
        dispatch_claimed_at: null,
        pending_competitive_report_id: null,
      }).eq("id", schedule.id));
    },
    async note(scheduleId, result) {
      await must(db.from("report_schedules").update({ last_result: result.slice(0, 500) }).eq("id", scheduleId));
    },
  };
}
