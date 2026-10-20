// The one way a social report (public.reports) is written: update-report
// (the n8n workflow's writeback) and the in-app social pipeline in app mode
// (_shared/pipelines/writers.ts) both call handleSocialWrite, so a report the
// app makes is stored exactly as one n8n makes: the same fields, the same
// runtime rule, the same rule that a finished report is never failed.
//
// Moved here from update-report on 20 Oct 2026, unchanged for n8n, with two
// options the in-app pipeline sets:
//   attemptStartedAt  the report's created_at when the run was started: a
//                     report the dispatch has since taken away and made
//                     again (a new row) is never written by the old run;
//   onlyRunning       writes only while the report is running or pending.
// A write either option turns away is answered as skipped, as update-report
// answers a late writeback today.

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export interface SocialWriteOptions {
  /** The attempt the writer may write: the report's created_at when the in-app run started. */
  attemptStartedAt?: string | null;
  /** Write only while the report is running or pending (the in-app pipeline's rule). */
  onlyRunning?: boolean;
  now?: () => number;
}

export interface SocialWriteAnswer {
  status: number;
  body: Record<string, unknown>;
}

const RUNNING = ["running", "pending"];

export async function handleSocialWrite(supabase: Db, body: Any, opts: SocialWriteOptions = {}): Promise<SocialWriteAnswer> {
  const now = opts.now ?? Date.now;
  const { report_id, status, report_data, gamma_url, duration_minutes } = body ?? {};
  if (!report_id) return { status: 400, body: { error: "report_id is required" } };

  // The in-app run's fence: the attempt it was started for, still running.
  const fenced = opts.attemptStartedAt !== undefined;
  if (fenced) {
    if (!opts.attemptStartedAt || !Number.isFinite(Date.parse(String(opts.attemptStartedAt)))) {
      return { status: 400, body: { error: "attempt_started_at is required" } };
    }
    const { data: attempt, error } = await supabase.from("reports").select("id, created_at, status").eq("id", report_id).maybeSingle();
    if (error) throw new Error("Could not verify report attempt");
    if (!attempt || Date.parse(attempt.created_at) !== Date.parse(String(opts.attemptStartedAt))) {
      return { status: 200, body: { ok: true, skipped: "superseded report attempt" } };
    }
    if (opts.onlyRunning && !RUNNING.includes(attempt.status)) return { status: 200, body: { ok: true, skipped: "report is no longer running" } };
  }

  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (report_data !== undefined) updates.report_data = report_data;
  if (gamma_url !== undefined) updates.gamma_url = gamma_url;
  if (duration_minutes !== undefined) updates.duration_minutes = duration_minutes;

  // Every one of the 69 reports stored duration_minutes = 0, including a run
  // that took 34 minutes. The workflow's summary node reads a start time that
  // nothing ever writes, so it falls back to "now" at the moment the LAST
  // node runs and subtracts it from itself.
  //
  // Computing it here instead fixes both pipelines at once and uses the only
  // authoritative start there is: reports.created_at, which is set when the
  // row is created and reset on every re-run. A workflow that sends a real
  // number still wins; this only fills in the zero.
  if (!Number(duration_minutes)) {
    const { data: row } = await supabase
      .from("reports")
      .select("created_at")
      .eq("id", report_id)
      .maybeSingle();
    if (row?.created_at) {
      const minutes = Math.round((now() - new Date(row.created_at).getTime()) / 60000);
      // A clock skew or a re-used id could produce a negative or absurd
      // figure; better to leave it unset than to print a lie on the report.
      if (minutes >= 0 && minutes < 24 * 60) updates.duration_minutes = minutes;
    }
  }

  let query = supabase.from("reports").update(updates).eq("id", report_id);
  if (status === "failed") query = query.neq("status", "completed");
  if (fenced) query = query.eq("created_at", opts.attemptStartedAt);
  if (opts.onlyRunning) query = query.in("status", RUNNING);
  const { data, error } = await query.select();

  if (error) throw error;

  // No row: a scheduled run that stopped answering was taken away and its
  // occurrence started again (run-scheduled-jobs/dispatch.ts). A late
  // writeback from it is answered as done, so the workflow does not stop
  // with an error over a run nobody is waiting for.
  if (!data || data.length === 0) {
    const skipped = status === "failed" ? "No unfinished report to fail" : "This run was replaced by a newer one";
    return { status: 200, body: { ok: true, skipped } };
  }

  return { status: 200, body: data[0] };
}
