import { listedRuns, monthlyReportStatus, type Viewer } from "@/lib/display";

// A report run as people see it: how long it takes, the period a run offers,
// and the monthly reports a list shows. A run that does not finish is made
// again by the product (run-scheduled-jobs/dispatch.ts), so nothing here
// offers a retry.

/** Mirrors STUCK_AFTER_MINUTES in supabase/functions/_shared/reports/payloads.ts; a test asserts the two agree. */
export const STUCK_AFTER_MINUTES = 90;
export const RUN_ESTIMATE = "This usually takes about 10 minutes.";

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

/** The first to the last day of the calendar month before the one `today` (YYYY-MM-DD) falls in. */
export function lastCompleteMonth(today: string): { start: string; end: string } {
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

type MonthlyRow = { id?: string; client_id?: string | null; status?: string | null; created_at?: string | null; date_range_start?: string | null; date_range_end?: string | null; duration_minutes?: number | null; report_data?: unknown; report_period?: unknown };

/**
 * The period a stored monthly report covers, as one key with its client: the
 * range columns, or for a report stored without them the period inside its
 * data (report_period.current_month). A report whose period is not known is
 * its own key, so it is never merged into another.
 */
export function monthlyPeriodKey(r: MonthlyRow): string {
  const rd = (Array.isArray(r.report_data) ? r.report_data[0] : r.report_data) as { report_period?: unknown } | null | undefined;
  const stored = (r.report_period ?? rd?.report_period) as { current_month?: { start?: string; end?: string } } | null | undefined;
  const start = String(r.date_range_start || stored?.current_month?.start || "").slice(0, 10);
  const end = String(r.date_range_end || stored?.current_month?.end || "").slice(0, 10);
  if (!start || !end) return `id|${r.id ?? ""}`;
  return `${r.client_id ?? ""}|${start}|${end}`;
}

/**
 * The monthly reports a list shows: the ones this viewer may see, and of the
 * ready reports one per client and period, the newest. A month that was run
 * again is one report, not one per run. A run in progress stays beside it.
 */
export function listedMonthlyReports<T extends MonthlyRow>(rows: T[] | null | undefined, viewer: Viewer) {
  const listed = listedRuns("monthly", rows, viewer);
  const key = (r: MonthlyRow) => monthlyPeriodKey(r);
  const newest = new Map<string, (typeof listed)[number]>();
  for (const r of listed) {
    if (monthlyReportStatus(r, viewer).state !== "ready") continue;
    const best = newest.get(key(r));
    if (!best || String(r.created_at ?? "") > String(best.created_at ?? "")) newest.set(key(r), r);
  }
  return listed.filter((r) => monthlyReportStatus(r, viewer).state !== "ready" || newest.get(key(r)) === r);
}
