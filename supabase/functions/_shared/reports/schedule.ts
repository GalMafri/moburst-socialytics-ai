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
 * Close out runs that died without saying so.
 *
 * A workflow that fails at an HTTP node never reaches its writeback, so the
 * report row sits on "running" for ever — Wendover's August report sat that
 * way for two days, LegaBot's July one for a month, and nothing in the app
 * or the database said anything was wrong. n8n's error trigger does not
 * carry the report id, so the only reliable place to notice is here, from
 * the clock. The worker runs this every minute.
 *
 * They become ordinary failures with a reason, which is what the Retry
 * control is for.
 */
export async function closeAbandonedRuns(supabase: SupabaseClient, now: Date, dryRun: boolean) {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60000).toISOString();
  const out: Array<{ table: string; id: string }> = [];
  for (const table of ["reports", "competitive_reports"]) {
    try {
      const { data: stale } = await supabase
        .from(table)
        .select("id")
        .eq("status", "running")
        .lt("created_at", cutoff);
      for (const row of (stale || []) as Array<{ id: string }>) {
        out.push({ table, id: row.id });
        if (dryRun) continue;
        await supabase
          .from(table)
          .update({
            status: "failed",
            report_data: {
              error:
                "The workflow stopped without reporting back, so this run was closed automatically. " +
                "Run it again, and if it stops again check the n8n execution for that client.",
            },
          })
          .eq("id", row.id)
          .eq("status", "running");
      }
    } catch (e) {
      console.warn(`[abandoned] ${table}:`, e);
    }
  }
  if (out.length > 0) console.log(`[abandoned] closed ${out.length} run(s) that never reported back`);
  return out;
}
