// How long a report run takes, as people are told it. A run that does not
// finish is made again by the product (run-scheduled-jobs/dispatch.ts), so
// nothing here offers a retry.

/** Mirrors STUCK_AFTER_MINUTES in supabase/functions/_shared/reports/payloads.ts; a test asserts the two agree. */
export const STUCK_AFTER_MINUTES = 90;
export const RUN_ESTIMATE = "Allow up to 90 minutes for analysis. You can leave this page and return later; the run continues.";

export type RunnableReport = {
  status?: string | null;
  created_at?: string | null;
};

export function minutesRunning(report: RunnableReport, now = Date.now()): number {
  if (!report.created_at) return 0;
  const started = new Date(report.created_at).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, (now - started) / 60000);
}
