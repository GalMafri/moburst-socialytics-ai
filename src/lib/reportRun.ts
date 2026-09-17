// Elapsed time permits a manual retry; it does not prove the workflow stopped.
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

/** True when a running report is old enough to review for a manual retry. */
export function isStuck(report: RunnableReport, now = Date.now()): boolean {
  return report.status === "running" && minutesRunning(report, now) >= STUCK_AFTER_MINUTES;
}

/** True when the report is worth offering a retry on. */
export function canRetry(report: RunnableReport, now = Date.now()): boolean {
  return (report.status === "failed" || report.status === "running") && minutesRunning(report, now) >= STUCK_AFTER_MINUTES;
}

/** What to call the control, so a stuck run does not read as a failure. */
export function retryLabel(report: RunnableReport, now = Date.now()): string {
  return isStuck(report, now) ? "Review retry" : "Retry";
}
