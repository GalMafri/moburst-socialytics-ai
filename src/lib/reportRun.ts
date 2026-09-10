// When a report run can be started again.
//
// A run ends one of three ways: it finishes, the workflow writes a failure,
// or it dies without telling anyone — a crash before the writeback node
// leaves the row on "running" for ever. The third is invisible in the
// database, so it is inferred from the clock: nothing here takes close to
// an hour, so a row still running after that is not running.

/** Longest any run legitimately takes, with room to spare. */
export const STUCK_AFTER_MINUTES = 45;

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

/** True when the run stopped without ever saying so. */
export function isStuck(report: RunnableReport, now = Date.now()): boolean {
  return report.status === "running" && minutesRunning(report, now) > STUCK_AFTER_MINUTES;
}

/** True when the report is worth offering a retry on. */
export function canRetry(report: RunnableReport, now = Date.now()): boolean {
  return report.status === "failed" || isStuck(report, now);
}

/** What to call the control, so a stuck run does not read as a failure. */
export function retryLabel(report: RunnableReport, now = Date.now()): string {
  return isStuck(report, now) ? "Stuck — run again" : "Retry";
}
