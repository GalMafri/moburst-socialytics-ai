/** Keep an empty post sample from becoming a claim about a company's strategy.
 * Provider totals remain unchanged, including explicit measured zeros. The raw
 * workflow output/snapshots remain the audit source; this is a derived view.
 */
export function sourceCompetitiveSummary(report: Record<string, any>): string | null {
  const companies = report.aggregates?.companies || [];
  const client = companies.find((c: any) => c.is_client);
  const m = client?.rivaliq_metrics;
  if (!client?.post_count || !m || report.aggregates?.metric_semantics_version !== 2) return null;
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const rate = (n: number) => `${(n * 100).toFixed(2)}%`;
  const lines: string[] = [];
  if (valid(m.posts?.current)) lines.push(`Publishing: ${fmt(m.posts.current)} tracked posts from ${client.name} in this period${valid(m.posts.previous) ? `, compared with ${fmt(m.posts.previous)} in the previous equal-length period` : ""}.`);
  if (valid(m.engagement_rate_per_post?.current)) lines.push(`Engagement: ${rate(m.engagement_rate_per_post.current)} is ${client.name}'s average engagement rate per post${valid(m.engagement_rate_per_post.previous) ? `, versus ${rate(m.engagement_rate_per_post.previous)} previously` : ""}.`);
  if (valid(m.audience?.current)) lines.push(`Audience: ${fmt(m.audience.current)} followers across tracked networks${valid(m.audience.previous) ? `, ${m.audience.current >= m.audience.previous ? "up" : "down"} ${fmt(Math.abs(m.audience.current - m.audience.previous))} from the previous period` : ""}.`);
  const rivals = companies.filter((c: any) => !c.is_client && valid(c.rivaliq_metrics?.posts?.current));
  const leader = [...rivals].sort((a: any, b: any) => b.rivaliq_metrics.posts.current - a.rivaliq_metrics.posts.current)[0];
  if (leader) lines.push(`Peer activity: ${fmt(leader.rivaliq_metrics.posts.current)} tracked posts makes ${leader.name} ${rivals.length > 1 ? "a publishing-volume leader among the selected competitors" : "the selected publishing comparison"} for this period.`);
  return lines.join("\n\n");
}

export function withCompetitiveEvidenceLimits<T>(input: T): T {
  if (!input || typeof input !== "object") return input;
  const source = input as Record<string, any>;
  const summary = sourceCompetitiveSummary(source);
  const report = summary ? { ...source, ai_analysis: { ...source.ai_analysis, executive_summary: summary } } : source;
  const companies = report.aggregates?.companies;
  if (!Array.isArray(companies)) return input;
  const empty = companies.filter(c => c.post_count === 0);
  const mismatches = companies.filter(c => Number.isFinite(c.post_count) &&
    Number.isFinite(c.rivaliq_metrics?.posts?.current) && c.post_count !== c.rivaliq_metrics.posts.current);
  if (!empty.length && !mismatches.length) return report as T;
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
    if (report?.aggregates?.metrics_available === true && !c.rivaliq_metrics) reasons.push(`${c.name}: provider metrics are missing.`);
    for (const [network, metrics] of Object.entries(c.rivaliq_metrics?.by_network || {}) as [string, any][]) {
      const count = c.by_channel?.[network]?.post_count ?? (network === 'twitter' ? c.by_channel?.x?.post_count : undefined) ?? 0;
      if (Number.isFinite(metrics.posts?.current) && count !== metrics.posts.current) reasons.push(`${c.name} / ${network}: ${count} dated posts; ${metrics.posts.current} provider period total.`);
    }
    const observed = c.post_count, total = c.rivaliq_metrics?.posts?.current;
    if (Number.isFinite(observed) && Number.isFinite(total) && observed !== total) {
      reasons.push(`${c.name}: ${observed} dated posts; ${total} provider period total.`);
    }
  }
  // Older narratives may quote the incorrect post-mean rate or summed
  // follower count as reach. Correcting tiles alone would leave contradictory prose.
  if (report?.ai_analysis && report?.aggregates?.metric_semantics_version !== 2) {
    const companies = report?.aggregates?.companies || [];
    if (companies.some((c: any) => Number.isFinite(c.engagement_rate_avg) &&
      Number.isFinite(c.rivaliq_metrics?.engagement_rate_per_post?.current) &&
      Math.abs(c.engagement_rate_avg - c.rivaliq_metrics.engagement_rate_per_post.current) > 0.000051)) {
      reasons.push("Narrative needs regeneration using provider engagement rates.");
    }
    if (companies.some((c: any) => c.reach_total > 0) && /\breach\b/i.test(JSON.stringify(report.ai_analysis))) {
      reasons.push("Narrative needs regeneration with follower counts distinguished from reach.");
    }
  }
  if (report?.quality_check?.state === "needs_review" && !reasons.length) {
    reasons.push(...(report.quality_check.reasons || ["Source validation is incomplete."]));
  }
  return { ready: reasons.length === 0, reasons };
}
