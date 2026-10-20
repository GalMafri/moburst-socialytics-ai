// The one way a competitive report and its RivalIQ snapshots are written:
// update-competitive-report (the n8n workflow's writeback) and the in-app
// competitive pipeline in app mode (_shared/pipelines/writers.ts) both call
// handleCompetitiveWrite, so a report the app makes is stored exactly as one
// n8n makes: the same attempt fence, the same evidence limits, the same
// coverage notes and quality check, the same set lifecycle.
//
// Moved here from update-competitive-report on 20 Oct 2026, unchanged, with
// one option the in-app pipeline sets: onlyRunning, which writes only while
// the report is still running (the dispatch may have taken it away and
// started another).
//
//   { op: "snapshot", ... }  append a raw RivalIQ response to rivaliq_snapshots
//   { op: "report", ... }    update a competitive_reports row (status/data/deck)

import { competitiveReportQuality, withCompetitiveEvidenceLimits } from "./reportEvidence.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export interface CompetitiveWriteOptions {
  /** Write only while the report is running or pending (the in-app pipeline's rule). */
  onlyRunning?: boolean;
  now?: () => number;
}

export interface CompetitiveWriteAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** What the post coverage of an attempt says, read from its "socialposts" snapshot. */
export interface PostCoverage {
  expected_windows?: unknown;
  failed_windows?: unknown;
  truncated_pages?: unknown;
}

/**
 * A finished report's data as it is stored, and the status it is stored
 * with: the windows that never loaded and the pages that reached the limit
 * said in the report, then the quality check, which holds (stores as failed)
 * an analysis that does not pass. Pure: the coverage is read by the caller.
 */
export function completedCompetitiveReport(reportData: Any, coverage: PostCoverage | null | undefined): { status: "complete" | "failed"; report_data: Any; gamma_url_cleared: boolean } {
  const rd: Any = reportData;
  const truncated = Number(coverage?.truncated_pages) || 0;
  if (truncated > 0) rd.totals = { ...(rd.totals || {}), truncated_pages: truncated };
  const failed = Number(coverage?.failed_windows) || 0;
  const expected = Number(coverage?.expected_windows) || 0;
  if (failed > 0) {
    const warning =
      `${failed} of ${expected} weekly windows did not load, so this report covers only part of the period ` +
      `and the comparison is incomplete.`;
    const existing = typeof rd.schema_note === "string" ? rd.schema_note.trim() : "";
    rd.schema_note = existing ? `${warning} ${existing}` : warning;
    const totals = (rd.totals && typeof rd.totals === "object" ? rd.totals : {}) as Record<string, unknown>;
    totals.windows_failed = failed;
    totals.windows_expected = expected;
    rd.totals = totals;
  }
  const quality = competitiveReportQuality(rd);
  if (!quality.ready) {
    return { status: "failed", report_data: { ...rd, quality_check: { state: "needs_review", reasons: quality.reasons } }, gamma_url_cleared: true };
  }
  return { status: "complete", report_data: rd, gamma_url_cleared: false };
}

export async function handleCompetitiveWrite(supabase: Db, body: Any, opts: CompetitiveWriteOptions = {}): Promise<CompetitiveWriteAnswer> {
  const now = opts.now ?? Date.now;
  const answer = (b: Record<string, unknown>, status = 200): CompetitiveWriteAnswer => ({ status, body: b });

  if (!body?.report_id || !body.attempt_started_at || !Number.isFinite(Date.parse(body.attempt_started_at))) {
    return answer({ error: "report_id and attempt_started_at are required" }, 400);
  }
  const { data: attempt, error: attemptError } = await supabase.from("competitive_reports")
    .select("id,client_id,created_at,status").eq("id", body.report_id).maybeSingle();
  if (attemptError) throw new Error("Could not verify report attempt");
  // A scheduled run that stopped answering is taken away and started again
  // (run-scheduled-jobs/dispatch.ts); its late writes are superseded too.
  if (!attempt) return answer({ ok: true, skipped: "superseded report attempt" });
  if (Date.parse(attempt.created_at) !== Date.parse(body.attempt_started_at)) {
    return answer({ ok: true, skipped: "superseded report attempt" });
  }
  if (body.client_id && body.client_id !== attempt.client_id) return answer({ error: "report client mismatch" }, 409);
  const running = ["running", "pending"];
  if (opts.onlyRunning && !running.includes(attempt.status)) return answer({ ok: true, skipped: "report is no longer running" });

  if (body.op === "snapshot") {
    const { report_id, landscape_id, endpoint, params_hash, payload } = body;
    if (!landscape_id || !endpoint || payload === undefined) {
      return answer({ error: "landscape_id, endpoint and payload are required" }, 400);
    }
    const { data, error } = await supabase
      .from("rivaliq_snapshots")
      .insert({
        client_id: attempt.client_id,
        attempt_started_at: attempt.created_at,
        report_id: report_id || null,
        landscape_id: String(landscape_id),
        endpoint: String(endpoint).slice(0, 100),
        params_hash: String(params_hash || "").slice(0, 200),
        payload,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return answer({ ok: true, snapshot_id: data.id });
  }

  if (body.op === "report") {
    const { report_id, status, report_data, gamma_url, duration_minutes } = body;
    if (!report_id) return answer({ error: "report_id is required" }, 400);

    const updates: Record<string, unknown> = {};
    if (status !== undefined) {
      if (!["pending", "running", "complete", "failed"].includes(status)) {
        return answer({ error: `invalid status '${status}'` }, 400);
      }
      updates.status = status;
    }
    if (report_data !== undefined) updates.report_data = withCompetitiveEvidenceLimits(report_data);
    if (gamma_url !== undefined) updates.gamma_url = gamma_url;
    if (duration_minutes !== undefined) updates.duration_minutes = duration_minutes;

    // Same as update-report: derive the runtime from created_at when the
    // workflow does not send a real one, because created_at is the only
    // authoritative start and a code node's idea of it has proven wrong.
    if (!Number(duration_minutes)) {
      const { data: row } = await supabase
        .from("competitive_reports")
        .select("created_at")
        .eq("id", report_id)
        .maybeSingle();
      if (row?.created_at) {
        const minutes = Math.round((now() - new Date(row.created_at).getTime()) / 60000);
        if (minutes >= 0 && minutes < 24 * 60) updates.duration_minutes = minutes;
      }
    }

    // Say when the period is only partly covered.
    //
    // Landscape Social Posts runs once per weekly window and is set to
    // continueErrorOutput, so a window that fails routes its own item to
    // Mark Report Failed while the survivors carry on to a complete report.
    // Because a complete report is never downgraded (see below), the
    // completion wins and the failure disappears: the run finishes on
    // partial data and reads as if it covered the whole month.
    //
    // Merge Post Pages now counts the windows that never arrived, and
    // Cache Posts Snapshot stores its whole output against this report, so
    // the count can be read back here rather than by editing two large code
    // nodes in the workflow.
    let effectiveStatus = status;
    if (status === "complete" && report_data && typeof report_data === "object") {
      const { data: snap, error: snapshotError } = await supabase
        .from("rivaliq_snapshots")
        .select("payload")
        .eq("report_id", report_id)
        .eq("endpoint", "socialposts")
        .eq("attempt_started_at", attempt.created_at)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snapshotError) throw new Error("Could not validate saved post coverage");
      if (!snap?.payload || Number(snap.payload.expected_windows) < 1) {
        return answer({ error: "Current attempt source coverage has not been saved" }, 409);
      }
      const done = completedCompetitiveReport(updates.report_data, snap.payload as PostCoverage);
      updates.report_data = done.report_data;
      if (done.status === "failed") {
        effectiveStatus = "failed";
        updates.status = effectiveStatus;
        updates.gamma_url = null;
      }
    } else if (status === "complete") {
      const quality = competitiveReportQuality(updates.report_data);
      if (!quality.ready) {
        effectiveStatus = "failed";
        updates.status = effectiveStatus;
        updates.gamma_url = null;
        updates.report_data = { ...(updates.report_data as Record<string, unknown>), quality_check: { state: "needs_review", reasons: quality.reasons } };
      }
    }

    // A finished report is never downgraded. Every error output in the
    // workflow lands in one "Mark Report Failed" node, including the error
    // output of the POST that writes the finished report, so a timeout on
    // a successful writeback used to replace a complete report with an
    // error stub.
    let query = supabase.from("competitive_reports").update(updates).eq("id", report_id).eq("created_at", attempt.created_at);
    if (status === "failed") query = query.neq("status", "complete");
    if (opts.onlyRunning) query = query.in("status", running);
    const { data, error } = await query.select("id, status");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      if (status === "failed") return answer({ ok: true, skipped: "report already complete" });
      return answer({ ok: true, skipped: "report attempt changed during validation" });
    }

    // Keep the set's lifecycle in step with its latest run. A successful run
    // supersedes an earlier failure (sets are re-runnable by design), so
    // "complete" may roll forward from failed as well; a failure only marks
    // sets that were mid-run, never one that already completed.
    if (effectiveStatus === "complete" || effectiveStatus === "failed") {
      const { data: rep } = await supabase
        .from("competitive_reports")
        .select("set_id")
        .eq("id", report_id)
        .maybeSingle();
      if (rep?.set_id) {
        const from = effectiveStatus === "complete"
          ? ["confirmed", "analyzing", "failed"]
          : ["confirmed", "analyzing"];
        await supabase
          .from("competitor_sets")
          .update({ status: effectiveStatus })
          .eq("id", rep.set_id)
          .in("status", from);
      }
    }
    // A social report held for this one is released by the scheduled-jobs
    // worker, which looks for finished competitive reports every minute.
    return answer({ ok: true, report: data[0] });
  }

  return answer({ error: "op must be 'snapshot' or 'report'" }, 400);
}
