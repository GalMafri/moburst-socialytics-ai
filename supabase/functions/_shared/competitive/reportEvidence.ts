/** Keep an empty post sample from becoming a claim about a company's strategy.
 * Provider totals remain unchanged, including explicit measured zeros. The raw
 * workflow output/snapshots remain the audit source; this is a derived view.
 */
export function withCompetitiveEvidenceLimits<T>(input: T): T {
  if (!input || typeof input !== "object") return input;
  const report = input as Record<string, any>;
  const companies = report.aggregates?.companies;
  if (!Array.isArray(companies)) return input;
  const empty = companies.filter(c => c.post_count === 0);
  const mismatches = companies.filter(c => Number.isFinite(c.post_count) &&
    Number.isFinite(c.rivaliq_metrics?.posts?.current) && c.post_count !== c.rivaliq_metrics.posts.current);
  if (!empty.length && !mismatches.length) return input;
  const names = new Set(empty.map(c => String(c.name || "").trim().toLowerCase()));
  const client = empty.find(c => c.is_client);
  // Coverage diagnostics belong to internal validation, never the report narrative.
  const originalNote = String(report.schema_note || "");
  const cleanNote = originalNote.replace(/(?:RivalIQ returned no in-period posts for |The returned post sample differs from RivalIQ's period totals:)[\s\S]*$/, "").trim();
  const ai = { ...(report.ai_analysis || {}) };
  if (Array.isArray(ai.competitor_breakdowns)) {
    ai.competitor_breakdowns = ai.competitor_breakdowns.filter((b: any) =>
      !names.has(String(b.name || "").trim().toLowerCase()) && !(client && b.is_client));
  }
  if (client) {
    ai.executive_summary = `No posts for ${client.name} were returned for the selected period. The report retains RivalIQ's supplied metrics and the observed competitor posts. Client content gaps, strategy assessments and posting recommendations are withheld because there is no client post sample to support them.`;
    ai.gaps_for_client = [];
    ai.recommended_schedule = null;
    ai.posting_time_insights = null;
    // The provider values still appear in the factual comparison. An AI
    // performance score is not a substitute for missing content evidence.
    ai.benchmark_scorecard = { ...(ai.benchmark_scorecard || {}), client_score: null };
  }
  return { ...report, schema_note: cleanNote, ai_analysis: ai } as T;
}

/** An incomplete analysis must not be delivered, exported or reused as context. */
export function competitiveReportQuality(input: unknown): { ready: boolean; reasons: string[] } {
  const report = input as Record<string, any> | null;
  const reasons: string[] = [];
  if (report?.aggregates?.metrics_available === false) reasons.push("Provider period metrics did not load.");
  if (Number(report?.totals?.windows_failed) > 0) reasons.push("Some reporting windows did not load.");
  if (Number(report?.totals?.truncated_pages) > 0) reasons.push("Some reporting windows exceeded the retrieval limit.");
  for (const c of report?.aggregates?.companies || []) {
    const observed = c.post_count, total = c.rivaliq_metrics?.posts?.current;
    if (Number.isFinite(observed) && Number.isFinite(total) && observed !== total) {
      reasons.push(`${c.name}: ${observed} dated posts; ${total} provider period total.`);
    }
  }
  if (report?.quality_check?.state === "needs_review" && !reasons.length) {
    reasons.push(...(report.quality_check.reasons || ["Source validation is incomplete."]));
  }
  return { ready: reasons.length === 0, reasons };
}
