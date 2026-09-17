const cfg = $("Run Config").first().json;
const landscape = $("Resolve Landscape").first().json;
const aggregates = $("Aggregate Competitive Data").first().json;
const pages = Number(($("Merge Post Pages").first().json || {}).pages) || 0;
const aiRaw = $input.first().json.output || $input.first().json;
const sanitizeStr = (s) => String(s)
  .replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, "")
  .replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, "$1")
  .replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u")
  .replace(/[\u0000-\b\u000b\f\u000e-\u001f]/g, " ");
const sanitize = (v) => {
  if (typeof v === "string") return sanitizeStr(v);
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[sanitizeStr(k)] = sanitize(v[k]); return o; }
  return v;
};
const startedAt = new Date(cfg.started_at);
const durationMinutes = Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60000));
const reportData = sanitize(normalizedCompetitiveMetrics({
  source: "rivaliq",
  landscape: { id: landscape.landscape_id, name: landscape.landscape_name, matched_by: landscape.matched_by, focus_company_id: landscape.focus_company_id, companies: landscape.companies },
  period: aggregates.period,
  // rivaliq_calls: landscapes list + status + companies + one socialposts call per weekly window.
  totals: { posts_analyzed: aggregates.total_posts_analyzed, post_windows: pages, rivaliq_calls: 3 + pages },
  aggregates: aggregates,
  ai_analysis: aiRaw,
  generated_at: new Date().toISOString(),
  schema_note: aggregates.schema_note || ""
}));
const body = { op: "report", report_id: cfg.report_id, status: "complete", report_data: JSON.parse(JSON.stringify(reportData)), duration_minutes: durationMinutes };
const bodyString = JSON.stringify(body);
return [{ json: { report_id: cfg.report_id, status: "complete", duration_minutes: durationMinutes, body_bytes: bodyString.length, body_string: bodyString } }];
