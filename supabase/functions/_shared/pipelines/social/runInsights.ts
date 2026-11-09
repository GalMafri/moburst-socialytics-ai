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
// The answer, in order: this run's own kept answer for the same input (a try
// cut off after the call), the row already stored for the report under the
// same input, else the call the job makes (asked again once when the answer
// does not check out, then the facts in code's own words).

import { inputHash, insightsInput, insightsRow, INSIGHTS_REPORT_COLUMNS, writeInsights, type InsightsDeps, type InsightsRow } from "../../reports/insights.ts";

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

/** The insights of the report the run makes, from the report data it will write. db: read only. */
export async function runInsights(a: {
  db: Db; reportId: string | null; reportData: Any; kept: InsightsRow | null; complete: InsightsDeps["complete"]; now: () => Date;
}): Promise<RunInsights> {
  if (!a.reportId) return { row: null, from: "none", reason: "The run makes no report." };
  const { data: report, error } = await a.db.from("reports").select(INSIGHTS_REPORT_COLUMNS).eq("id", a.reportId).maybeSingle();
  if (error) throw new Error(`Could not read the report: ${error.message}`);
  if (!report) return { row: null, from: "none", reason: "The report no longer exists." };
  if (report.clients?.archived_at) return { row: null, from: "none", reason: "The client is archived." };
  // The job reads the report as written; the run reads the same row with the data it is about to write.
  const input = await insightsInput(a.db, "reports", { ...report, report_data: a.reportData });
  if (!input.facts.length) return { row: null, from: "none", reason: "The report has no facts to word." };
  const hash = await inputHash(input);
  if (a.kept?.input_hash === hash) return { row: a.kept, from: "kept" };
  const { data: stored, error: storedError } = await a.db.from("report_insights").select(STORED_COLUMNS).eq("report_id", a.reportId).eq("input_hash", hash).limit(1);
  if (storedError) throw new Error(`Could not read the stored insights: ${storedError.message}`);
  if (stored?.length) return { row: stored[0] as InsightsRow, from: "stored" };
  const at = a.now().toISOString();
  const written = await writeInsights(input, { now: a.now, complete: a.complete });
  return { row: insightsRow("reports", a.reportId, report.client_id, input, hash, written, at), from: "model" };
}
