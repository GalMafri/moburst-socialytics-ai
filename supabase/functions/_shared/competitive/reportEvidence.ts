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
  const emptyNote = empty.length ? `RivalIQ returned no in-period posts for ${empty.map(c => c.name).join(", ")}. This does not establish that these companies did not publish or lack a content strategy. Content-style assessments are unavailable for them; verify tracking and source coverage before drawing conclusions.` : "";
  const sampleNote = mismatches.length ? `The returned post sample differs from RivalIQ's period totals: ${mismatches.map(c => `${c.name}: ${c.post_count} posts returned, ${c.rivaliq_metrics.posts.current} in period metrics`).join("; ")}. Content examples, posting rhythm and share of voice describe returned posts, not a complete publishing census.` : "";
  const note = [emptyNote, sampleNote].filter(Boolean).join(" ");
  const originalNote = String(report.schema_note || "");
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
  return { ...report, schema_note: originalNote.includes(note) ? originalNote : [originalNote, note].filter(Boolean).join(" "), ai_analysis: ai } as T;
}
