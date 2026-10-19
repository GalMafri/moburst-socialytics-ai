// Schedule arithmetic and the abandoned-run sweep, shared by the enqueue
// endpoint and the scheduled-jobs worker. Moved unchanged from
// trigger-scheduled-reports when scheduled reports became a queue (2026-10-06).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { STUCK_AFTER_MINUTES } from "./payloads.ts";

export interface ReportRange {
  start: string;
  end: string;
}

/** The first to the last day of the previous calendar month. */
export function previousMonthRange(now: Date): ReportRange {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

/** The first of this month to today. */
export function currentMonthRange(now: Date): ReportRange {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: first.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export function rangeForSchedule(rangeMode: string | null | undefined, now: Date): ReportRange {
  return rangeMode === "previous_month" ? previousMonthRange(now) : currentMonthRange(now);
}

/** The next occurrence: run_day_of_month of next month at 07:15 UTC, or a week or two out. */
export function nextRun(now: Date, runDay: number | null | undefined, frequency: string | null | undefined): string {
  if (frequency === "weekly") return new Date(now.getTime() + 7 * 86400000).toISOString();
  if (frequency === "biweekly") return new Date(now.getTime() + 14 * 86400000).toISOString();
  const day = Math.min(Math.max(runDay || 7, 1), 28);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, 7, 15, 0)).toISOString();
}

/**
 * The first run after a moment: a monthly schedule's run day at 07:15 UTC,
 * this month when that is still ahead, else next month; a weekly or biweekly
 * one a week or two later. Used when a schedule starts again (a client
 * unarchived), so a run day still ahead this month is not skipped. Mirrored
 * by public.report_schedule_first_run (migration 20261019200000).
 */
export function firstRunFrom(from: Date, runDay: number | null | undefined, frequency: string | null | undefined): string {
  if (frequency === "weekly" || frequency === "biweekly") return nextRun(from, runDay, frequency);
  const day = Math.min(Math.max(runDay || 7, 1), 28);
  const thisMonth = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day, 7, 15, 0);
  return thisMonth > from.getTime() ? new Date(thisMonth).toISOString() : nextRun(from, runDay, frequency);
}

/**
 * Close out runs that died without saying so.
 *
 * A workflow that fails at an HTTP node never reaches its writeback, so the
 * report row sits on "running" for ever — Wendover's August report sat that
 * way for two days, LegaBot's July one for a month, and nothing in the app
 * or the database said anything was wrong. n8n's error trigger does not
 * carry the report id, so the only reliable place to notice is here, from
 * the clock. The worker runs this every minute.
 *
 * A scheduled run is left to its own dispatch job, which watches the same
 * clock, takes the run away and starts the occurrence again
 * (run-scheduled-jobs/dispatch.ts). Every other run is closed here.
 */
export async function closeAbandonedRuns(supabase: SupabaseClient, now: Date, dryRun: boolean) {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60000).toISOString();
  const out: Array<{ table: string; id: string }> = [];
  for (const table of ["reports", "competitive_reports"]) {
    try {
      const { data: stale } = await supabase
        .from(table)
        .select(table === "competitive_reports" ? "id, set_id" : "id")
        .eq("status", "running")
        .lt("created_at", cutoff);
      const rows = (stale || []) as unknown as Array<{ id: string; set_id?: string | null }>;
      const { data: owned } = rows.length
        ? await supabase.from("scheduled_jobs").select("report_id").eq("kind", "dispatch")
          .in("status", ["queued", "running", "waiting"]).in("report_id", rows.map((r) => r.id))
        : { data: [] };
      const scheduled = new Set(((owned || []) as Array<{ report_id: string }>).map((r) => r.report_id));
      for (const row of rows) {
        if (scheduled.has(row.id)) continue;
        out.push({ table, id: row.id });
        if (dryRun) continue;
        await supabase
          .from(table)
          .update({
            status: "failed",
            report_data: { error: "The run stopped before it finished, so it was closed." },
          })
          .eq("id", row.id)
          .eq("status", "running");
        // The set followed the run into 'analyzing', and only the workflow's
        // callback ever moved it out. Left there, the set could not be
        // reopened or connected to tracking until another run completed.
        // Released only when no other run on the set is still going.
        if (row.set_id) {
          const { data: others } = await supabase
            .from("competitive_reports")
            .select("id")
            .eq("set_id", row.set_id)
            .eq("status", "running")
            .limit(1);
          if (!(others || []).length) {
            await supabase.from("competitor_sets").update({ status: "failed" }).eq("id", row.set_id).eq("status", "analyzing");
          }
        }
      }
    } catch (e) {
      console.warn(`[abandoned] ${table}:`, e);
    }
  }
  if (out.length > 0) console.log(`[abandoned] closed ${out.length} run(s) that never reported back`);
  return out;
}
