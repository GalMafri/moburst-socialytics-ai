// The real writers of the in-app pipelines in app mode, each through the same
// function n8n's writeback runs, fenced to the report's attempt and written
// only while the report is still running:
//   competitive  the report and its RivalIQ snapshots, as
//                update-competitive-report writes them
//                (_shared/competitive/reportWriter.ts); the attempt is the
//                request's attempt_started_at.
//   social       the report, as update-report writes it
//                (_shared/reports/socialWriter.ts); the attempt is the
//                report's created_at when the run started (input.attempt_started_at).
// A write the fence turns away (the dispatch took the report away) is
// skipped quietly; a refused write throws, and the step is tried again.

import { handleCompetitiveWrite } from "../competitive/reportWriter.ts";
import { handleSocialWrite } from "../reports/socialWriter.ts";
import type { RealWriter } from "./store.ts";
import type { PipelineRun } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const attemptOf = (run: PipelineRun) => String(((run.input ?? {}) as { request?: { attempt_started_at?: unknown } }).request?.attempt_started_at ?? "");

async function write(db: Db, run: PipelineRun, body: Record<string, unknown>): Promise<void> {
  if (run.kind !== "competitive" || run.real_table !== "competitive_reports" || !run.real_id) {
    throw new Error("Only an in-app competitive run that makes a competitive report writes one.");
  }
  const result = await handleCompetitiveWrite(db, { ...body, report_id: run.real_id, attempt_started_at: attemptOf(run) }, { onlyRunning: true });
  if (result.status >= 400) throw new Error(`The competitive ${String(body.op)} was not written (${result.status}): ${String(result.body.error ?? "")}`);
  if (result.body.skipped) console.warn(`[pipeline] ${run.id} ${String(body.op)} skipped: ${String(result.body.skipped)}`);
}

const snapshotWriter = (endpoint: string): RealWriter => (db, run, data) =>
  write(db, run, { op: "snapshot", client_id: run.client_id, endpoint, landscape_id: data.landscape_id, payload: data.payload });

export const COMPETITIVE_WRITERS: Record<string, RealWriter> = {
  /** Mark Report Complete: { status, report_data, duration_minutes }. */
  report: (db, run, data) => write(db, run, { op: "report", status: data.status, report_data: data.report_data, duration_minutes: data.duration_minutes }),
  "snapshot.status": snapshotWriter("status"),
  "snapshot.companies": snapshotWriter("companies"),
  "snapshot.metrics": snapshotWriter("metrics"),
  "snapshot.socialposts": snapshotWriter("socialposts"),
};

/** Mark the report complete: { status, report_data, gamma_url, duration_minutes }, as update-report receives it from n8n. */
export const SOCIAL_WRITERS: Record<string, RealWriter> = {
  async report(db, run, data) {
    if (run.kind !== "social" || run.real_table !== "reports" || !run.real_id) throw new Error("Only an in-app social run that makes a social report writes one.");
    const attempt = ((run.input ?? {}) as { attempt_started_at?: string | null }).attempt_started_at ?? null;
    const result = await handleSocialWrite(db, { ...data, report_id: run.real_id }, { attemptStartedAt: attempt, onlyRunning: true });
    if (result.status >= 400) throw new Error(`The social report was not written (${result.status}): ${String(result.body.error ?? "")}`);
    if (result.body.skipped) console.warn(`[pipeline] ${run.id} report skipped: ${String(result.body.skipped)}`);
  },
};
