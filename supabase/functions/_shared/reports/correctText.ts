// The report_text job in the scheduled-jobs queue: bring one stored report's
// figures and text in line with what the report shows now.
//
// Queued for every completed report of an active client when a report
// finishes (a trigger on both report tables), and once by migration
// 20261020100000_client_figures_and_text.sql for the reports already stored.
//
//   1. A competitive report whose client figures were stored before the
//      product's rules (ads counted as posts, no YouTube impressions) has
//      them counted again from its own stored posts (storedFigures.ts).
//   2. The sentences of its text that quote a figure it no longer shows are
//      found (reportText.ts staleReportText). None: the job is done, with no
//      model call.
//   3. One model call rewrites those sentences; an answer that adds a number
//      the report does not show is refused and the job tries again later.
//   4. The corrected sentences are written in place. The report's text and
//      client figures as they were before the first change are kept in the
//      row's correction_audit, with a record of every change.
//
// Nothing here is shown to anyone: a job that does not finish is tried again
// with growing waits, and the report keeps showing its figures meanwhile.

import { anthropicMessages } from "../anthropic.ts";
import { clientFiguresFromStoredPosts } from "../competitive/storedFigures.ts";
import {
  applyCorrections, checkCorrection, competitiveFigures, correctionPrompt, CORRECTION_SYSTEM, parseCorrection, socialFigures, staleReportText,
  type Figure, type ReportKind, type StaleSentence,
} from "./reportText.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

/** The Sonnet model the app's text jobs use (voice/load.ts MEMORY_MODEL). */
export const REPORT_TEXT_MODEL = "claude-sonnet-5-5";

export interface ReportTextJob {
  id: string;
  client_id: string;
  attempts: number;
  max_attempts: number;
  payload?: Record<string, unknown> | null;
}

export interface ReportTextOutcome {
  status: "done" | "queued" | "skipped" | "failed";
  reason?: string | null;
  result?: Record<string, unknown> | null;
  available_at?: string;
}

export interface ReportTextDeps {
  now(): Date;
  /** One model call: the system prompt and the message, the reply's text back. */
  complete(system: string, message: string): Promise<string>;
}

/** Waits before a correction is tried again: 10 minutes, an hour, six hours, then once a day. */
const RETRY_WAITS_MINUTES = [10, 60, 360, 1440];
export function reportTextRetryWait(attempts: number): number {
  return RETRY_WAITS_MINUTES[Math.min(Math.max(1, attempts), RETRY_WAITS_MINUTES.length) - 1] * 60_000;
}

const TABLES: Record<string, ReportKind> = { competitive_reports: "competitive", reports: "social" };
const COMPLETE = ["complete", "completed"];

async function read<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return data;
}

/** The client company of a competitive report as it was first stored, before any count was redone. */
function asWritten(reportData: Any, audit: Any): Any {
  const original = audit?.original?.client_company;
  if (!original || !Array.isArray(reportData?.aggregates?.companies)) return reportData;
  return { ...reportData, aggregates: { ...reportData.aggregates, companies: reportData.aggregates.companies.map((c: Any) => (c?.is_client ? original : c)) } };
}

/**
 * The competitive report a monthly report shows beside its own figures: the
 * client's latest finished one written before the monthly report, read as
 * written and as shown now, under a prefix so its figures stay its own.
 */
async function competitiveBeside(db: Db, clientId: string, before: string): Promise<{ stored: Figure[]; shown: Figure[] }> {
  const rows = await read<Any[]>(db.from("competitive_reports").select("report_data, correction_audit").eq("client_id", clientId)
    .eq("status", "complete").lte("created_at", before).order("created_at", { ascending: false }).limit(1), "the competitive report");
  const row = rows?.[0];
  if (!row?.report_data) return { stored: [], shown: [] };
  return {
    stored: competitiveFigures(asWritten(row.report_data, row.correction_audit), "stored", "competitive|"),
    shown: competitiveFigures(row.report_data, "shown", "competitive|"),
  };
}

/** The sentences of one stored report that quote a figure it no longer shows (no writes). */
export async function reportTextCheck(db: Db, table: string, reportId: string): Promise<{ kind: ReportKind; row: Any; stale: StaleSentence[]; shown: Figure[] } | null> {
  const kind = TABLES[table];
  if (!kind) throw new Error(`Unknown report table ${table}`);
  const row = await read<Any>(db.from(table).select("id, client_id, status, created_at, date_range_start, date_range_end, report_data, correction_audit, clients(name, archived_at)").eq("id", reportId).maybeSingle(), "the report");
  if (!row) return null;
  const rd = Array.isArray(row.report_data) ? row.report_data[0] : row.report_data;
  let stored: Figure[], shown: Figure[];
  if (kind === "competitive") {
    stored = competitiveFigures(asWritten(rd, row.correction_audit), "stored");
    shown = competitiveFigures(rd, "shown");
  } else {
    const beside = await competitiveBeside(db, row.client_id, row.created_at);
    stored = [...socialFigures(rd, "stored"), ...beside.stored];
    shown = [...socialFigures(rd, "shown"), ...beside.shown];
  }
  return { kind, row, stale: staleReportText(kind, rd, stored, shown), shown };
}

export async function runReportText(db: Db, job: ReportTextJob, deps: ReportTextDeps): Promise<ReportTextOutcome> {
  const table = String(job.payload?.table || "");
  const reportId = String(job.payload?.report_id || "");
  const retry = (reason: string): ReportTextOutcome => job.attempts >= job.max_attempts
    ? { status: "failed", reason }
    : { status: "queued", reason, available_at: new Date(deps.now().getTime() + reportTextRetryWait(job.attempts)).toISOString() };
  if (!TABLES[table] || !reportId) return { status: "skipped", reason: "The job names no report." };
  try {
    const head = await read<Any>(db.from(table).select("id, status, report_data, correction_audit, clients(archived_at)").eq("id", reportId).maybeSingle(), "the report");
    if (!head) return { status: "skipped", reason: "The report no longer exists." };
    if (!COMPLETE.includes(String(head.status))) return { status: "skipped", reason: "The report is not finished." };
    if (head.clients?.archived_at) return { status: "skipped", reason: "The client is archived." };
    const result: Record<string, unknown> = {};

    // 1. The client's figures, counted again from the report's own stored posts.
    if (TABLES[table] === "competitive") {
      const snapshots = await read<Any[]>(db.from("rivaliq_snapshots").select("payload").eq("report_id", reportId).eq("endpoint", "socialposts")
        .order("fetched_at", { ascending: false }).limit(1), "the report's stored posts");
      const figures = clientFiguresFromStoredPosts(head.report_data, snapshots?.[0]?.payload);
      if (figures.changed) {
        const audit = head.correction_audit || {};
        const nextAudit = {
          ...audit,
          original: { ...(audit.original || {}), client_company: audit.original?.client_company ?? figures.original_client },
          corrections: [...(audit.corrections || []), { at: deps.now().toISOString(), what: "client_figures", from: "stored_posts", changes: figures.changes }],
        };
        const { error } = await db.from(table).update({ report_data: figures.report_data, correction_audit: nextAudit }).eq("id", reportId);
        if (error) throw new Error(`Could not save the counted figures: ${error.message}`);
        result.figures = figures.changes;
      }
    }

    // 2. The sentences that quote a figure the report no longer shows.
    const check = await reportTextCheck(db, table, reportId);
    if (!check) return { status: "skipped", reason: "The report no longer exists." };
    if (!check.stale.length) return { status: "done", result: { ...result, stale_sentences: 0 } };

    // 3. One model call for the report's sentences, checked before anything is written.
    const rd = Array.isArray(check.row.report_data) ? check.row.report_data[0] : check.row.report_data;
    const period = check.row.date_range_start && check.row.date_range_end ? `${check.row.date_range_start} to ${check.row.date_range_end}` : null;
    const reply = await deps.complete(CORRECTION_SYSTEM, correctionPrompt({ client: String(check.row.clients?.name || "the client"), kind: check.kind, period }, check.stale, check.shown));
    const answer = parseCorrection(reply);
    const refused = checkCorrection(check.stale, answer, check.shown);
    if (refused) return retry(refused);

    // 4. The sentences in place, the text as it was kept once.
    const applied = applyCorrections(rd.ai_analysis, check.stale, answer!);
    if (!applied) return retry("The report's text changed while it was being corrected.");
    const audit = check.row.correction_audit || {};
    const nextAudit = {
      ...audit,
      original: { ...(audit.original || {}), ai_analysis: audit.original?.ai_analysis ?? rd.ai_analysis },
      corrections: [...(audit.corrections || []), {
        at: deps.now().toISOString(), what: "text", model: REPORT_TEXT_MODEL,
        sentences: check.stale.map((s) => ({ path: s.path, before: s.sentence, after: answer!.get(s.id), numbers: s.numbers.map((n) => n.text) })),
      }],
    };
    const nextData = { ...rd, ai_analysis: applied.ai };
    const { error } = await db.from(table).update({ report_data: Array.isArray(check.row.report_data) ? [nextData, ...check.row.report_data.slice(1)] : nextData, correction_audit: nextAudit }).eq("id", reportId);
    if (error) throw new Error(`Could not save the corrected text: ${error.message}`);
    return { status: "done", result: { ...result, stale_sentences: check.stale.length, fields: applied.changed.length } };
  } catch (e) {
    return retry(e instanceof Error ? e.message : String(e));
  }
}

/** The model call the worker binds: Sonnet, through the app's Messages API helper. */
export function sonnetCompletion(apiKey: string): ReportTextDeps["complete"] {
  return async (system, message) => (await anthropicMessages({ apiKey, body: { model: REPORT_TEXT_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: message }] } })).text;
}
