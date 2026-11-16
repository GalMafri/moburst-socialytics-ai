/* eslint-disable @typescript-eslint/no-explicit-any -- stored report JSON and database doubles are untyped. */
// The stored-report repair: one explicitly invoked action that brings social
// reports written before REPORTS-20 and REPORTS-21 in line with the code that
// writes reports now. Nothing calls it on its own; it runs only when someone
// POSTs {"mode":"repair_stored_reports"} to run-scheduled-jobs, and without
// "apply": true it is a dry run that writes nothing and lists every change it
// would make.
//
//   Figures (REPORTS-20). The code now floors each period total (overall and
//   per platform) once and each post's lifetime count once, so the figure it
//   would have stored is max(0, the stored figure). A stored count below zero
//   is floored at zero, and only what follows from it is rebuilt: that
//   metric's change (absolute, percent), its summary line and its
//   metrics_summary change, with the same functions aggregateSprout and the
//   run summary use (nodes.ts metricChange, changeSummaryLine,
//   metricsSummaryChanges). Every other figure, top posts included, stays as
//   stored. No provider is called.
//
//   Spelling (REPORTS-21). The analysis text a client reads in every stored
//   shape (REPAIR_TEXT_FIELDS: the three fields the engine writes now, and the
//   TikTok and Instagram trend analyses reports stored before 9 Nov show) and
//   the report's insights are checked by the rule the pipeline uses now
//   (britishSpelling, with the report's own words left out as exemptPattern
//   leaves them out). Only a string that fails is rewritten, by the word map
//   americanSpelling. No model is called.
//
// Each repaired report keeps what it held before in correction_audit
// (original.sprout_performance, original.metrics_summary, original.ai_analysis,
// once) with a record of every change, as the report_text job keeps its
// corrections. Writing report_data never queues a job: the report_text
// trigger fires only on a status change. Sentences that quote a figure the
// repair changed are listed (stale_sentences) and left as written. Rewording
// them is one Sonnet call per report through the report_text job, which reads
// the figures the text was written from in correction_audit; it is queued
// only with "reword": true next to "apply": true.
//
// One request checks at most `limit` reports in created_at order and returns
// next_after, the created_at to pass as "after" to continue (null when it
// reached the end). A report that cannot be written is listed with its error
// and the request goes on with the next one; the report row and its insights
// rows are separate writes, and a second run finishes a report left half done.

import { changeSummaryLine, metricChange, metricsSummaryChanges, SUMMARY_CHANGE_METRICS } from "../pipelines/social/nodes.ts";
import { SHOWN_TEXT_FIELDS } from "../pipelines/social/analysis.ts";
import { americanSpelling, britishSpelling, exemptPattern, socialFigures, staleReportText } from "./reportText.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

export interface Change { path: string; before: unknown; after: unknown }

const COUNTS = ["impressions", "reactions", "likes", "link_clicks", "video_views", "comments", "shares", "engagements", "engagement", "post_count", "previous_post_count"];
/** The parts of sprout_performance that hold figures. */
const FIGURE_FIELDS = ["overall_totals", "month_comparison", "platform_breakdown", "platform_metrics", "top_posts", "top_posts_by_platform"] as const;
/** The analysis a client reads, in every stored shape. The trend analyses of reports stored before 9 Nov are shown on the Trends tab (ReportView TrendsSection); their hashtags stay as written. */
const TREND_TEXT_KEYS = ["overview", "top_themes", "successful_formats", "opportunities_for_client", "key_takeaways"];
const REPAIR_TEXT_FIELDS: Record<string, string[] | null> = {
  ...Object.fromEntries(SHOWN_TEXT_FIELDS.map((f) => [f, null])),
  tiktok_trends_analysis: TREND_TEXT_KEYS,
  instagram_trends_analysis: TREND_TEXT_KEYS,
};
const COMPLETE = ["complete", "completed"];
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const dataOf = (row: Any): Any => (Array.isArray(row?.report_data) ? row.report_data[0] : row?.report_data) || {};
const withData = (row: Any, rd: Any): Any => (Array.isArray(row?.report_data) ? [rd, ...row.report_data.slice(1)] : rd);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Every leaf that differs between two values, by path. */
function diff(before: unknown, after: unknown, path: string, out: Change[] = []): Change[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.max(before.length, after.length); i++) diff(before[i], after[i], `${path}[${i}]`, out);
  } else if (isObj(before) && isObj(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[k], after[k], `${path}.${k}`, out);
  } else if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ path, before: before ?? null, after: after ?? null });
  }
  return out;
}

/** A value with every count below zero floored at zero. A change's absolute and percent may be negative and are left. */
function floorCounts(v: unknown, key: string): unknown {
  if (typeof v === "number") return COUNTS.includes(key) && v < 0 ? 0 : v;
  if (Array.isArray(v)) return v.map((x) => floorCounts(x, key));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "absolute" || k === "percent" ? x : floorCounts(x, COUNTS.includes(k) ? k : key)]));
  return v;
}

/** The stored counts below zero in a report's Sprout figures, by path. */
export function negativeCounts(rd: Any): string[] {
  const sp = rd?.sprout_performance || {};
  const changes = FIGURE_FIELDS.flatMap((f) => diff(sp[f], floorCounts(sp[f], ""), `sprout_performance.${f}`));
  return changes.map((c) => c.path);
}

/** The metrics of one comparison (current, previous, changes) that hold a count below zero. */
function negativeMetrics(cur: Any, prev: Any, changes: Any): string[] {
  const metrics = new Set([...Object.keys(cur || {}), ...Object.keys(prev || {}), ...Object.keys(changes || {})]);
  return [...metrics].filter((m) => [cur?.[m], prev?.[m], changes?.[m]?.current, changes?.[m]?.previous].some((v) => typeof v === "number" && v < 0));
}

/** A comparison's change for one metric from its floored stored counts (the change's own, else the period totals). */
function flooredChange(cur: Any, prev: Any, change: Any, m: string) {
  const side = (own: unknown, total: unknown) => Math.max(0, typeof own === "number" ? own : num(total));
  return metricChange(side(change?.current, cur?.[m]), side(change?.previous, prev?.[m]));
}

/**
 * A stored report with every count below zero floored at zero, as the code
 * computes it now, and what follows from those counts rebuilt: the metric's
 * change, its summary line and its metrics_summary figure. Nothing else
 * changes.
 */
export function floorStoredFigures(rd: Any): { report_data: Any; changes: Change[] } {
  const sp: Any = rd?.sprout_performance;
  if (!isObj(sp) || !negativeCounts(rd).length) return { report_data: rd, changes: [] };
  const nextSp: Any = { ...sp };
  for (const f of FIGURE_FIELDS) if (f in sp) nextSp[f] = floorCounts(sp[f], "");
  const next: Any = { ...rd, sprout_performance: nextSp };

  const mc: Any = sp.month_comparison;
  if (isObj(mc)) {
    const moved = negativeMetrics(mc.current_month, mc.previous_month, mc.changes);
    const nextMc: Any = nextSp.month_comparison;
    for (const m of moved) {
      const change = flooredChange(mc.current_month, mc.previous_month, (mc.changes as Any)?.[m], m);
      if (isObj(nextMc.changes)) nextMc.changes = { ...nextMc.changes, [m]: change };
      if (Array.isArray(nextMc.summary)) {
        const label = `${m.replace(/_/g, " ")}:`;
        nextMc.summary = nextMc.summary.map((line: unknown) => (typeof line === "string" && line.startsWith(label) ? changeSummaryLine(m, change) : line));
      }
    }
    if (isObj(rd.metrics_summary) && isObj(nextMc.changes)) {
      const summary = metricsSummaryChanges(nextMc.changes);
      next.metrics_summary = { ...rd.metrics_summary };
      for (const m of moved) {
        const key = `${m}_change`;
        if ((SUMMARY_CHANGE_METRICS as readonly string[]).includes(m) && key in rd.metrics_summary) next.metrics_summary[key] = summary[key];
      }
    }
  }
  const breakdown: Any[] | null = Array.isArray(rd.sprout_performance.platform_breakdown) ? rd.sprout_performance.platform_breakdown : null;
  if (breakdown) {
    nextSp.platform_breakdown = nextSp.platform_breakdown.map((p: Any, i: number) => {
      const stored = breakdown[i];
      const moved = negativeMetrics(stored?.current, stored?.previous, stored?.changes);
      if (!moved.length || !isObj(p?.changes)) return p;
      return { ...p, changes: { ...p.changes, ...Object.fromEntries(moved.map((m) => [m, flooredChange(stored.current, stored.previous, stored.changes?.[m], m)])) } };
    });
  }
  const changes = [
    ...FIGURE_FIELDS.flatMap((f) => diff(sp[f], nextSp[f], `sprout_performance.${f}`)),
    ...diff(rd.metrics_summary, next.metrics_summary, "metrics_summary"),
  ];
  return { report_data: next, changes };
}

/** The companies a stored social report names: the client and its profiles. */
function storedNames(rd: Any, client: string | null): string[] {
  const profiles: Any[] = Array.isArray(rd?.sprout_performance?.profiles) ? rd.sprout_performance.profiles : [];
  return [client, rd?.client_name, ...profiles.map((p) => p?.name)].filter((n): n is string => typeof n === "string" && !!n.trim());
}

/** Every string in a value, with its path. */
function strings(v: unknown, path: string, out: Array<{ path: string; text: string }> = []): Array<{ path: string; text: string }> {
  if (typeof v === "string") out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
  return out;
}

/** A value with each string passed through fix, and what changed. */
function mapStrings(v: unknown, path: string, fix: (text: string) => string, changes: Change[]): unknown {
  if (typeof v === "string") {
    const after = fix(v);
    if (after !== v) changes.push({ path, before: v, after });
    return after;
  }
  if (Array.isArray(v)) return v.map((x, i) => mapStrings(x, `${path}[${i}]`, fix, changes));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, `${path}.${k}`, fix, changes)]));
  return v;
}

/**
 * The analysis text a client reads (REPAIR_TEXT_FIELDS), in American spelling: only strings the
 * check fails are rewritten. The report's own words (its client and profile
 * names, and every text it stores outside the analysis: posts, trends,
 * pillars) are left out, as the pipeline leaves the input's words out.
 */
export function spellingFixes(rd: Any, client: string | null): { report_data: Any; changes: Change[] } {
  const ai = rd?.ai_analysis;
  if (!isObj(ai)) return { report_data: rd, changes: [] };
  const sources = strings(Object.fromEntries(Object.entries(rd).filter(([k]) => k !== "ai_analysis")), "report").map((s) => s.text);
  const exempt = exemptPattern(storedNames(rd, client), sources);
  const changes: Change[] = [];
  const fix = (text: string) => (britishSpelling(text, exempt) ? americanSpelling(text, exempt) : text);
  const nextAi: Any = { ...ai };
  for (const [field, keys] of Object.entries(REPAIR_TEXT_FIELDS)) {
    if (!(field in ai)) continue;
    const value = ai[field];
    if (keys && isObj(value)) {
      nextAi[field] = Object.fromEntries(Object.entries(value).map(([k, x]) => [k, keys.includes(k) ? mapStrings(x, `ai_analysis.${field}.${k}`, fix, changes) : x]));
    } else if (!keys) nextAi[field] = mapStrings(value, `ai_analysis.${field}`, fix, changes);
  }
  return { report_data: changes.length ? { ...rd, ai_analysis: nextAi } : rd, changes };
}

/** One stored insights row's text in American spelling, its facts' sentences and the companies left out as checkInsights leaves them out. */
export function insightsSpellingFixes(row: { fields: Any; facts: Any }, client: string | null): { fields: Any; changes: Change[] } {
  const facts: Any[] = Array.isArray(row.facts) ? row.facts : [];
  const companies = [client, ...facts.flatMap((f) => [f?.company, f?.leader])].filter((n): n is string => typeof n === "string" && !!n.trim());
  const exempt = exemptPattern(companies, facts.map((f) => String(f?.sentence ?? "")));
  const changes: Change[] = [];
  // Only the words a client reads: each text, and a gap's three parts.
  const fix = (text: string) => (britishSpelling(text, exempt) ? americanSpelling(text, exempt) : text);
  const walk = (v: unknown, path: string, key: string): unknown => {
    if (typeof v === "string") return ["text", "gap", "why_it_matters", "suggested_play"].includes(key) ? mapStrings(v, path, fix, changes) : v;
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, key));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, `${path}.${k}`, k)]));
    return v;
  };
  const fields = walk(row.fields, "fields", "");
  return { fields: changes.length ? fields : row.fields, changes };
}

export interface RepairEntry {
  report_id: string;
  client: string | null;
  created_at: string;
  /** "repaired" only once the report row is written; "not repaired" when that write failed (see error). */
  figures: { negative: string[]; status: "none" | "would repair" | "repaired" | "not repaired"; changes?: Change[] };
  spelling: Change[];
  insights: Array<{ id: string; changes: Change[] }>;
  /** Sentences that quote a figure the repair changes (or an earlier apply changed): left as written unless rewording is asked for. A dry run lists them, which is what reword would queue. */
  stale_sentences: string[];
  /** With reword: "queued" when a report_text job was written now, "already queued" when one is still open, "not queued" when the queue wrote none. */
  reword?: "queued" | "already queued" | "not queued";
  /** Why this report could not be written; the request went on with the next one. */
  error?: string;
}

export interface RepairResult {
  dry_run: boolean;
  cost: string;
  checked: number;
  /** The created_at to pass as "after" to continue; null when every report was checked. */
  next_after: string | null;
  reports: RepairEntry[];
}

async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return data;
}

/** The reports one request checks at most, unless the caller says otherwise. */
export const REPAIR_LIMIT = 40;

/**
 * Checks the finished social reports of active clients (or the ones named),
 * in created_at order after `after`, at most `limit` of them, and with apply
 * writes the repairs. Never calls a provider or a model; with reword (and
 * apply) it queues the report_text job, one Sonnet call, for each repaired
 * report whose text quotes a figure the repair changed.
 */
export async function repairStoredReports(db: Db, opts: { apply?: boolean; reword?: boolean; reportIds?: string[]; after?: string; limit?: number; now?: () => Date } = {}): Promise<RepairResult> {
  const apply = opts.apply === true;
  const reword = opts.reword === true;
  if (reword && !apply) throw new Error("reword needs apply: the text is reworded against the repaired figures.");
  const now = opts.now ?? (() => new Date());
  const limit = Math.max(1, Math.floor(opts.limit ?? REPAIR_LIMIT));
  const out: RepairEntry[] = [];
  let checked = 0;
  let last: string | null = null;
  let more = false;
  const PAGE = 20;
  outer: for (let from = 0; ; from += PAGE) {
    let q = db.from("reports").select("id, client_id, status, created_at, report_data, correction_audit, clients(name, archived_at)").in("status", COMPLETE);
    if (opts.after) q = q.gt("created_at", opts.after);
    if (opts.reportIds?.length) q = q.in("id", opts.reportIds);
    const rows = await must<Any[]>(q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1), "the reports");
    for (const row of rows ?? []) {
      // Reports that share a created_at are checked in one request, so the cursor never splits them.
      if (checked >= limit && String(row.created_at) !== last) { more = true; break outer; }
      last = String(row.created_at);
      if (row.clients?.archived_at) continue;
      checked++;
      const entry = await repairOne(db, row, { apply, reword, now });
      if (entry) out.push(entry);
    }
    if (!rows || rows.length < PAGE) break;
  }
  return {
    dry_run: !apply,
    cost: reword
      ? "Figures and spelling: no provider or model cost. Rewording: one Sonnet call per report queued (reword \"queued\"), up to 7 attempts each."
      : "No provider or model cost: figures follow from each report's own stored figures, spelling from a word map.",
    checked,
    next_after: more ? last : null,
    reports: out,
  };
}

/** One report checked and, with apply, written. Null when it needs nothing. */
async function repairOne(db: Db, row: Any, o: { apply: boolean; reword: boolean; now: () => Date }): Promise<RepairEntry | null> {
  const client = typeof row.clients?.name === "string" ? row.clients.name : null;
  const rd = dataOf(row);
  const entry: RepairEntry = { report_id: row.id, client, created_at: String(row.created_at), figures: { negative: negativeCounts(rd), status: "none" }, spelling: [], insights: [], stale_sentences: [] };
  try {
    const floored = floorStoredFigures(rd);
    let next = floored.report_data;
    if (floored.changes.length) entry.figures = { ...entry.figures, status: "would repair", changes: floored.changes };
    // The figures the text was written from: kept in correction_audit by an earlier repair, else the report as stored.
    const original: Any = isObj(row.correction_audit) ? (row.correction_audit as Any).original : null;
    const written = original?.sprout_performance !== undefined || original?.metrics_summary !== undefined
      ? { ...rd, ...(original.sprout_performance !== undefined ? { sprout_performance: original.sprout_performance } : {}), ...(original.metrics_summary !== undefined ? { metrics_summary: original.metrics_summary } : {}) }
      : rd;
    if (floored.changes.length || written !== rd) entry.stale_sentences = staleReportText("social", next, socialFigures(written), socialFigures(next)).map((s) => s.sentence);
    const spelled = spellingFixes(next, client);
    next = spelled.report_data;
    entry.spelling = spelled.changes;
    const insightRows = await must<Any[]>(db.from("report_insights").select("id, fields, facts").eq("report_table", "reports").eq("report_id", row.id), "the report's insights");
    const insightFixes = (insightRows ?? []).map((r) => ({ id: String(r.id), ...insightsSpellingFixes(r, client) })).filter((r) => r.changes.length);
    entry.insights = insightFixes.map((r) => ({ id: r.id, changes: r.changes }));
    const figureChanges = floored.changes.length;
    if (!figureChanges && !entry.spelling.length && !entry.insights.length && !entry.stale_sentences.length) return null;
    if (!o.apply) return entry;

    if (figureChanges || entry.spelling.length || entry.insights.length) {
      // The report row carries the record of every change, its insights' included.
      const audit = isObj(row.correction_audit) ? row.correction_audit : {};
      const original: Any = { ...(audit.original as Any || {}) };
      if (figureChanges && original.sprout_performance === undefined) original.sprout_performance = rd.sprout_performance ?? null;
      if (figureChanges && original.metrics_summary === undefined) original.metrics_summary = rd.metrics_summary ?? null;
      if (entry.spelling.length && original.ai_analysis === undefined) original.ai_analysis = rd.ai_analysis ?? null;
      const at = o.now().toISOString();
      const corrections = [...((audit.corrections as Any[]) || [])];
      if (figureChanges) corrections.push({ at, what: "sprout_figures", from: "stored_figures_floored", changes: floored.changes });
      if (entry.spelling.length) corrections.push({ at, what: "spelling", from: "word_map", changes: entry.spelling });
      for (const r of entry.insights) corrections.push({ at, what: "insights_spelling", from: "word_map", insight_id: r.id, changes: r.changes });
      const { error } = await db.from("reports").update({ report_data: withData(row, next), correction_audit: { ...audit, original, corrections } }).eq("id", row.id).in("status", COMPLETE);
      if (error) throw new Error(`Could not save report ${row.id}: ${error.message}`);
      if (figureChanges) entry.figures.status = "repaired";
    }
    for (const r of insightFixes) {
      const { error } = await db.from("report_insights").update({ fields: r.fields }).eq("id", r.id);
      if (error) throw new Error(`Could not save insights ${r.id}: ${error.message}`);
    }
    if (o.reword && entry.stale_sentences.length) entry.reword = await queueReword(db, row.id, o.now());
  } catch (e) {
    entry.error = e instanceof Error ? e.message : String(e);
    if (o.apply && entry.figures.status === "would repair") entry.figures.status = "not repaired";
  }
  return entry;
}

const REWORD_KEY = "figures-repair";
/** report_text_enqueue writes the job under report_text:<report>:<key>. */
const jobKey = (reportId: string, key: string) => `report_text:${reportId}:${key}`;

/**
 * Queues the report_text job that rewords a repaired report's stale
 * sentences, and says what happened. While an earlier rewording of the report
 * is still open nothing is queued; otherwise the job is keyed by this
 * request's time, so a rewording asked for again after one that failed is a
 * new job, and it is read back to tell whether the queue wrote it
 * (report_text_enqueue writes nothing for an archived client).
 */
async function queueReword(db: Db, reportId: string, at: Date): Promise<"queued" | "already queued" | "not queued"> {
  const open = await must<Any[]>(db.from("scheduled_jobs").select("id").eq("kind", "report_text").like("dedupe_key", `${jobKey(reportId, REWORD_KEY)}%`).in("status", ["queued", "running", "waiting"]), "the open rewording jobs");
  if ((open ?? []).length) return "already queued";
  const key = `${REWORD_KEY}:${at.toISOString()}`;
  const { error } = await db.rpc("report_text_enqueue", { p_table: "reports", p_report: reportId, p_key: key });
  if (error) throw new Error(`Could not queue the rewording of ${reportId}: ${error.message}`);
  const written = await must<Any[]>(db.from("scheduled_jobs").select("id").eq("dedupe_key", jobKey(reportId, key)), "the queued rewording job");
  return (written ?? []).length ? "queued" : "not queued";
}
