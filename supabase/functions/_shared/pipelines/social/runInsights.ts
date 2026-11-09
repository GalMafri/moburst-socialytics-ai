// The monthly report's insights, worded in the run (Trends plan, Phase 3
// point 2). After the analysis is accepted and before the deck, the run
// builds the report data it will write (its run summary without the deck),
// works out the facts and words them with the code and the input the
// report_insights job uses (reports/insights.ts): the same report row, the
// client's earlier reports, the same hash. So the deck says what the
// screens, the API and the planner say (shownFields.ts shownSocial), and the
// job report_text queues once the report is written meets the same input
// and only stamps it confirmed, since report_text changes no figure of a
// social report.
//
// Nothing is paid for a report that can't have insights: before any call,
// the report must be from insights' go-live on (report_insights_live_from,
// as the job and the writer read it), its client not archived, and in app
// mode the report must still be the run's attempt and running (the writer's
// fence). The client's earlier reports are read once per run and kept by the
// step, so a retry words the same input even when another report finished
// in between.
//
// The answer, in order: this run's own answer for the same input (a try
// that failed after the call), the row already stored for the report under
// the same input, else the call the job makes (asked again once when the
// answer does not check out, then the facts in code's own words).

import {
  inputHash, insightsInput, insightsRow, INSIGHTS_REPORT_COLUMNS, readInsightsHistory, writeInsights,
  type InsightsDeps, type InsightsHistory, type InsightsRow,
} from "../../reports/insights.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export interface RunInsights {
  row: InsightsRow | null;
  /** Where the row came from; none when the report has no insights to word. */
  from: "kept" | "stored" | "model" | "none";
  reason?: string;
}

/** Every column of a stored row, for a row met again. */
const STORED_COLUMNS = "report_table, report_id, client_id, kind, input_hash, facts, fields, source, model, prompt_version, input_tokens, output_tokens, problems, created_at, confirmed_at";
const RUNNING = ["running", "pending"];

/** The insights of the report the run makes, from the report data it will write. db: read only (it may call report_insights_live_from). */
export async function runInsights(a: {
  db: Db; reportId: string | null; reportData: Any;
  /** App mode: the report's created_at when the run started; the report must still be that attempt, and running. */
  attemptStartedAt?: string | null;
  /** The earlier reports' changes this run read before, if it did. */
  history?: InsightsHistory | null;
  /** Called with the earlier reports' changes when they are read, so the run keeps them. */
  onHistory?: (history: InsightsHistory) => Promise<void>;
  /** This run's own answer from a try before. */
  answered: InsightsRow | null;
  complete: InsightsDeps["complete"];
  now: () => Date;
}): Promise<RunInsights> {
  const none = (reason: string): RunInsights => ({ row: null, from: "none", reason });
  if (!a.reportId) return none("The run makes no report.");
  const { data: report, error } = await a.db.from("reports").select(INSIGHTS_REPORT_COLUMNS).eq("id", a.reportId).maybeSingle();
  if (error) throw new Error(`Could not read the report: ${error.message}`);
  if (!report) return none("The report no longer exists.");
  if (report.clients?.archived_at) return none("The client is archived.");
  if (a.attemptStartedAt !== undefined) {
    if (!a.attemptStartedAt || Date.parse(String(report.created_at)) !== Date.parse(String(a.attemptStartedAt))) return none("The report was made again since the run started.");
    if (!RUNNING.includes(String(report.status))) return none("The report is no longer running.");
  }
  // Decision 4 (insights.ts): only reports from go-live on get insights.
  const { data: liveFrom, error: liveError } = await a.db.rpc("report_insights_live_from");
  if (liveError) throw new Error(`Could not read when insights went live: ${liveError.message}`);
  if (!liveFrom || Date.parse(String(report.created_at)) < Date.parse(String(liveFrom))) return none("The report is from before report insights.");

  let history = a.history ?? null;
  if (!history) {
    history = await readInsightsHistory(a.db, "reports", report);
    await a.onHistory?.(history);
  }
  // The job reads the report as written; the run reads the same row with the data it is about to write.
  const input = await insightsInput(a.db, "reports", { ...report, report_data: a.reportData }, history);
  if (!input.facts.length) return none("The report has no facts to word.");
  const hash = await inputHash(input);
  if (a.answered?.input_hash === hash) return { row: a.answered, from: "kept" };
  const { data: stored, error: storedError } = await a.db.from("report_insights").select(STORED_COLUMNS).eq("report_id", a.reportId).eq("input_hash", hash).limit(1);
  if (storedError) throw new Error(`Could not read the stored insights: ${storedError.message}`);
  if (stored?.length) return { row: stored[0] as InsightsRow, from: "stored" };
  const at = a.now().toISOString();
  const written = await writeInsights(input, { now: a.now, complete: a.complete });
  return { row: insightsRow("reports", a.reportId, report.client_id, input, hash, written, at), from: "model" };
}
