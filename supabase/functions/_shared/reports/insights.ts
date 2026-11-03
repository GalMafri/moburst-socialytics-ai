// supabase/functions/_shared/reports/insights.ts
//
// Report insights from the data (Lital, 3 Nov 2026). Design:
// docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 2.
//
// Code decides what a report says (facts.ts); one Sonnet 5.5 call only words
// the numbered facts (decision 3), through structured outputs at effort
// medium, each insight citing its fact ids. Code checks the answer: the ids
// exist, every number written is a cited fact's number at the precision it
// was written, and "rose", "fell", "up" and "down" match the change's sign.
// A failed answer is asked once more with its problems named; a second
// failure shows the facts as sentences written here. Nothing on screen says
// anything failed.
//
// Same data, same insights: an answer is stored in report_insights under a
// hash of its exact input (the facts, the post sample, the team's verdicts,
// the prompt version and the model); a stored hash is used again with no
// call. Only reports from go-live on get insights (decision 4,
// report_insights_live_from); stored reports keep their text.
//
// The report_insights job (run-scheduled-jobs) is queued when a report's
// report_text job finishes, and when the team's verdict on a competitive
// suggestion changes (20261110220000_data_driven_insights.sql).

import { numbersIn } from "./reportText.ts";
import { competitiveChanges, competitiveFacts, socialChanges, socialFacts, type Fact } from "./facts.ts";
import { GAP_PLATFORMS } from "../pipelines/competitive/analysis.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export type InsightsKind = "social" | "competitive";

/** Lital, 3 Nov 2026 (decision 3): insights are worded by Sonnet 5.5. */
export const INSIGHTS_MODEL = "claude-sonnet-5-5";
/** Raised whenever the prompt or the schema changes, so stored answers are not reused for a different question. */
export const INSIGHTS_PROMPT_VERSION = 1;

export interface Cited { text: string; facts: string[] }
export interface Gap { gap: string; platform: string; why_it_matters: string; suggested_play: string; facts: string[] }

/** What the screens show in place of the model-written fields; null where code has nothing to put there. */
export type InsightFields =
  | { kind: "social"; summary: Cited | null; insights: Cited[]; recommendations: Cited[] | null }
  | { kind: "competitive"; summary: Cited[]; gaps: Gap[] | null };

/** A post the competitive report's style fields describe. */
export interface SamplePost { company: string; platform: string; format: string; text: string; engagement: number }
/** The team's call on a suggestion. */
export interface Verdict { verdict: "up" | "down"; gap: string }

export interface InsightsInput {
  kind: InsightsKind;
  client: string;
  period: string | null;
  facts: Fact[];
  sample: SamplePost[];
  verdicts: Verdict[];
}

const cited = { type: "object", additionalProperties: false, required: ["text", "facts"], properties: { text: { type: "string" }, facts: { type: "array", items: { type: "string" } } } };

export function insightsSchema(kind: InsightsKind): Record<string, unknown> {
  if (kind === "social") {
    return {
      type: "object", additionalProperties: false, required: ["summary", "insights", "recommendations"],
      properties: { summary: cited, insights: { type: "array", items: cited }, recommendations: { type: "array", items: cited } },
    };
  }
  return {
    type: "object", additionalProperties: false, required: ["summary", "gaps"],
    properties: {
      summary: { type: "array", items: cited },
      gaps: { type: "array", items: { type: "object", additionalProperties: false, required: ["gap", "platform", "why_it_matters", "suggested_play", "facts"], properties: {
        gap: { type: "string" }, platform: { type: "string", enum: [...GAP_PLATFORMS] }, why_it_matters: { type: "string" }, suggested_play: { type: "string" }, facts: { type: "array", items: { type: "string" } },
      } } },
    },
  };
}

export const INSIGHTS_SYSTEM = [
  "You write the insights of a client's social media report from facts that were worked out in code.",
  "Each fact has an id (F1, F2). Every piece of text you write cites the ids of the facts it rests on.",
  "Write only what the cited facts say. Every number you write must be one of the cited facts' numbers, written as the fact gives it or rounded (12,437 or 12.4K, 26.5% or 26%). Write no other number: no dates, no years, no counts of facts, no targets.",
  "Say a number went up only when it rose, and down only when it fell.",
  "Plain American English, short sentences, no em dashes or en dashes, no jargon, never mention fact ids, the facts list or how the facts were made.",
].join("\n");

/** The one message the model gets. `problems` are the first answer's, when it is asked again. */
export function insightsPrompt(input: InsightsInput, problems: string[] = []): string {
  const facts = input.facts.map((f) => `${f.id}: ${f.sentence} (${f.basis})`);
  const lines = [
    `Report: ${input.kind === "competitive" ? "competitive analysis" : "monthly social report"} for ${input.client}${input.period ? `, ${input.period}` : ""}.`,
    "",
    "Facts, most important first:",
    ...facts,
  ];
  if (input.kind === "social") {
    lines.push("", "Write:",
      "- summary: two or three sentences on what moved most this period and why it matters, citing the facts it rests on;",
      "- insights: three to six insights, each one or two sentences, each citing at least one fact;",
      "- recommendations: two to four things to do next on social media, each citing at least one fact it acts on.");
  } else {
    if (input.sample.length) {
      lines.push("", "Posts from the period that show how each company writes (for describing style only; never quote numbers from here):",
        ...input.sample.map((p) => `- ${p.company}, ${p.platform} ${p.format}: "${p.text.replace(/\s+/g, " ").slice(0, 220)}"`));
    }
    const up = input.verdicts.filter((v) => v.verdict === "up").map((v) => v.gap);
    const down = input.verdicts.filter((v) => v.verdict === "down").map((v) => v.gap);
    if (up.length) lines.push("", "Suggestions the team chose to implement (keep them in mind):", ...up.map((g) => `- ${g}`));
    if (down.length) lines.push("", "Suggestions the team rejected (never suggest these or anything like them again):", ...down.map((g) => `- ${g}`));
    lines.push("", "Write:",
      "- summary: two to four short paragraphs on where the client stands against its competitors, each citing the facts it rests on;",
      "- gaps: two to four gaps the client can close, each with the gap, its platform, why it matters and a test to run, citing the facts it rests on. A test's target may only be a cited fact's number.");
  }
  if (problems.length) lines.push("", "Your last answer could not be used:", ...problems.map((p) => `- ${p}`), "Answer again with these fixed.");
  return lines.join("\n");
}

function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
const ids = (x: unknown) => (Array.isArray(x) ? [...new Set(x.map((v) => str(v)).filter(Boolean))] : []);
const asCited = (x: Any): Cited => ({ text: str(x?.text), facts: ids(x?.facts) });

/** The answer as fields, or null when it cannot be read. */
export function parseInsights(kind: InsightsKind, text: string): InsightFields | null {
  const data = jsonObject(text);
  if (!data) return null;
  if (kind === "social") {
    if (!data.summary || !Array.isArray(data.insights)) return null;
    return { kind, summary: asCited(data.summary), insights: (data.insights as Any[]).map(asCited), recommendations: Array.isArray(data.recommendations) ? (data.recommendations as Any[]).map(asCited) : [] };
  }
  if (!Array.isArray(data.summary) || !Array.isArray(data.gaps)) return null;
  return {
    kind, summary: (data.summary as Any[]).map(asCited),
    gaps: (data.gaps as Any[]).map((g) => ({ gap: str(g?.gap), platform: str(g?.platform), why_it_matters: str(g?.why_it_matters), suggested_play: str(g?.suggested_play), facts: ids(g?.facts) })),
  };
}

const UP = /\b(rose|rise|rises|risen|rising|up|grew|grow|grows|growing|increased?|increases|increasing|climbed?|gained?)\b/gi;
const DOWN = /\b(fell|fall|falls|fallen|falling|down|dropped|drops?|declined?|declines|declining|decreased?|decreases|decreasing|shrank|shrinks?|slipped|slid)\b/gi;

/** The problems with one piece of text against the facts it cites. */
function textProblems(where: string, text: string, citedIds: string[], byId: Map<string, Fact>): string[] {
  const out: string[] = [];
  if (!text) return [`${where} is empty.`];
  if (/[–—]/.test(text)) out.push(`${where} has a dash; use commas or periods.`);
  if (!citedIds.length) out.push(`${where} cites no fact.`);
  const unknown = citedIds.filter((id) => !byId.has(id));
  if (unknown.length) out.push(`${where} cites ${unknown.join(", ")}, which are not in the facts.`);
  const facts = citedIds.map((id) => byId.get(id)).filter((f): f is Fact => !!f);
  // Every number is one of the cited facts' numbers at the precision it was written.
  for (const n of numbersIn(text)) {
    if (!facts.some((f) => f.numbers.some((v) => Math.abs(Math.abs(v) - n.value) <= n.tolerance))) out.push(`${where} writes ${n.text.trim()}, which is not a number of the facts it cites.`);
  }
  // A direction word next to a change's number agrees with the change's sign.
  for (const f of facts.filter((x) => x.kind === "change")) {
    const own = [Math.abs(f.percent ?? NaN), Math.abs(f.change ?? NaN)].filter(Number.isFinite);
    for (const n of numbersIn(text)) {
      if (!own.some((v) => Math.abs(v - n.value) <= n.tolerance)) continue;
      const words = [...text.matchAll(UP)].map((m) => ({ at: m.index!, up: true })).concat([...text.matchAll(DOWN)].map((m) => ({ at: m.index!, up: false })));
      const sentenceStart = Math.max(text.lastIndexOf(".", n.start - 1), text.lastIndexOf("!", n.start - 1), text.lastIndexOf("?", n.start - 1)) + 1;
      const nextStop = text.slice(n.end).search(/[.!?](\s|$)/);
      const sentenceEnd = nextStop < 0 ? text.length : n.end + nextStop;
      const near = words.filter((w) => w.at >= sentenceStart && w.at <= sentenceEnd).sort((a, b) => Math.abs(a.at - n.start) - Math.abs(b.at - n.start))[0];
      const rose = (f.percent ?? f.change ?? 0) > 0;
      if (near && near.up !== rose) out.push(`${where} says ${f.metric} went ${near.up ? "up" : "down"}, but it ${rose ? "rose" : "fell"}.`);
    }
  }
  return out;
}

/** Why an answer can't be shown, or nothing when it can. */
export function checkInsights(fields: InsightFields | null, facts: Fact[]): string[] {
  if (!fields) return ["The answer could not be read as the JSON asked for."];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: string[] = [];
  if (fields.kind === "social") {
    if (!fields.summary) out.push("The summary is missing.");
    else out.push(...textProblems("The summary", fields.summary.text, fields.summary.facts, byId));
    if (!fields.insights.length) out.push("There are no insights.");
    fields.insights.forEach((c, i) => out.push(...textProblems(`Insight ${i + 1}`, c.text, c.facts, byId)));
    (fields.recommendations ?? []).forEach((c, i) => out.push(...textProblems(`Recommendation ${i + 1}`, c.text, c.facts, byId)));
  } else {
    if (!fields.summary.length) out.push("The summary is missing.");
    fields.summary.forEach((c, i) => out.push(...textProblems(`Summary paragraph ${i + 1}`, c.text, c.facts, byId)));
    (fields.gaps ?? []).forEach((g, i) => {
      if (!(GAP_PLATFORMS as readonly string[]).includes(g.platform)) out.push(`Gap ${i + 1} names a platform that is not one of ${GAP_PLATFORMS.join(", ")}.`);
      for (const [part, text] of [["gap", g.gap], ["why it matters", g.why_it_matters], ["test", g.suggested_play]] as const) out.push(...textProblems(`Gap ${i + 1}'s ${part}`, text, g.facts, byId));
    });
  }
  return [...new Set(out)];
}

/** Insights, recommendations, paragraphs and gaps in the order of the first fact each cites (F1 first). */
export function orderByFacts(fields: InsightFields): InsightFields {
  const first = (c: { facts: string[] }) => Math.min(...c.facts.map((id) => Number(id.slice(1))).filter(Number.isFinite), Infinity);
  const sort = <T extends { facts: string[] }>(xs: T[]) => xs.map((x, i) => ({ x, i })).sort((a, b) => first(a.x) - first(b.x) || a.i - b.i).map(({ x }) => x);
  return fields.kind === "social"
    ? { ...fields, insights: sort(fields.insights), recommendations: fields.recommendations ? sort(fields.recommendations) : null }
    : { ...fields, summary: sort(fields.summary), gaps: fields.gaps ? sort(fields.gaps) : null };
}

/** The facts as sentences written in code: what shows when no answer checks out. Every fact is covered. */
export function templateInsights(kind: InsightsKind, facts: Fact[]): InsightFields {
  const each = facts.map((f) => ({ text: f.sentence, facts: [f.id] }));
  if (kind === "social") {
    const lead = facts.slice(0, 2);
    return { kind, summary: lead.length ? { text: lead.map((f) => f.sentence).join(" "), facts: lead.map((f) => f.id) } : null, insights: each, recommendations: null };
  }
  return { kind, summary: each, gaps: null };
}

/** The stored answer's key: the exact input, the prompt version and the model. */
export async function inputHash(input: InsightsInput, model = INSIGHTS_MODEL): Promise<string> {
  const text = JSON.stringify({ v: INSIGHTS_PROMPT_VERSION, model, kind: input.kind, client: input.client, period: input.period, facts: input.facts, sample: input.sample, verdicts: input.verdicts });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── The job ─────────────────────────────────────────────────────────────────

export interface InsightsJob {
  id: string;
  client_id: string;
  attempts: number;
  max_attempts: number;
  payload?: Record<string, unknown> | null;
}

export interface InsightsOutcome {
  status: "done" | "queued" | "skipped" | "failed";
  reason?: string | null;
  result?: Record<string, unknown> | null;
  available_at?: string;
}

export interface InsightsDeps {
  now(): Date;
  /** One Messages API call (the app's helper, anthropic.ts). */
  complete(body: Record<string, unknown>): Promise<{ text: string; stopReason: string; raw: unknown }>;
}

const TABLES: Record<string, InsightsKind> = { reports: "social", competitive_reports: "competitive" };
const COMPLETE = ["complete", "completed"];
const RETRY_WAITS_MINUTES = [10, 60, 360, 1440];
/** Earlier reports read for the client's usual month-to-month swing. */
const HISTORY_REPORTS = 12;

const reportData = (row: Any) => (Array.isArray(row?.report_data) ? row.report_data[0] : row?.report_data) || {};

/** The posts the competitive report's style fields describe: each company's best three, by engagement. */
export function postSample(rd: Any): SamplePost[] {
  const out: SamplePost[] = [];
  for (const c of (Array.isArray(rd?.aggregates?.companies) ? rd.aggregates.companies : []) as Any[]) {
    const posts = Object.entries(c?.by_channel || {}).flatMap(([channel, b]: [string, Any]) => (Array.isArray(b?.top_posts) ? b.top_posts : []).map((p: Any) => ({ ...p, channel })));
    posts.filter((p) => str(p?.text)).sort((a, b) => (Number(b.engagement) || 0) - (Number(a.engagement) || 0) || String(a.url ?? "").localeCompare(String(b.url ?? ""))).slice(0, 3)
      .forEach((p) => out.push({ company: String(c?.name || ""), platform: String(p.channel), format: String(p.media_type || "post").toLowerCase(), text: str(p.text), engagement: Number(p.engagement) || 0 }));
  }
  return out.sort((a, b) => a.company.localeCompare(b.company) || b.engagement - a.engagement || a.text.localeCompare(b.text));
}

/** The report's facts, its post sample and the team's verdicts: the exact input an answer is stored under. */
export async function insightsInput(db: Db, table: string, row: Any): Promise<InsightsInput> {
  const kind = TABLES[table];
  const { data: earlier, error } = await db.from(table).select("report_data, created_at").eq("client_id", row.client_id).in("status", COMPLETE)
    .lt("created_at", row.created_at).order("created_at", { ascending: false }).limit(HISTORY_REPORTS);
  if (error) throw new Error(`Could not read the client's earlier reports: ${error.message}`);
  const history = ((earlier ?? []) as Any[]).map((r) => (kind === "social" ? socialChanges(reportData(r)) : competitiveChanges(reportData(r))));
  const period = { start: row.date_range_start, end: row.date_range_end };
  const rd = reportData(row);
  const facts = kind === "social" ? socialFacts(rd, { period, history }) : competitiveFacts(rd, { period, history });
  let verdicts: Verdict[] = [];
  if (kind === "competitive") {
    const { data: rows, error: feedbackError } = await db.from("competitive_insight_feedback").select("verdict, gap_text, edited").eq("client_id", row.client_id).not("verdict", "is", null);
    if (feedbackError) throw new Error(`Could not read the team's verdicts: ${feedbackError.message}`);
    verdicts = ((rows ?? []) as Any[]).filter((r) => r.verdict === "up" || r.verdict === "down")
      .map((r) => ({ verdict: r.verdict, gap: str(r.edited?.gap) || str(r.gap_text) })).filter((v) => v.gap)
      .sort((a, b) => a.verdict.localeCompare(b.verdict) || a.gap.localeCompare(b.gap));
  }
  return {
    kind, client: String(row.clients?.name || "the client"), period: row.date_range_start && row.date_range_end ? `${row.date_range_start} to ${row.date_range_end}` : null,
    facts, sample: kind === "competitive" ? postSample(rd) : [], verdicts,
  };
}

/** One answer: asked, checked, asked once more with its problems named, else the facts in code's own words. */
export async function writeInsights(input: InsightsInput, deps: InsightsDeps): Promise<{ fields: InsightFields; source: "model" | "template"; problems: string[]; input_tokens: number; output_tokens: number }> {
  const used = { input: 0, output: 0 };
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await deps.complete({
      model: INSIGHTS_MODEL, max_tokens: 8000, system: INSIGHTS_SYSTEM,
      messages: [{ role: "user", content: insightsPrompt(input, problems) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: insightsSchema(input.kind) } },
    });
    const usage = (result.raw as Any)?.usage;
    used.input += Number(usage?.input_tokens) || 0;
    used.output += Number(usage?.output_tokens) || 0;
    const fields = result.stopReason === "refusal" ? null : parseInsights(input.kind, result.text);
    const found = checkInsights(fields, input.facts);
    if (!found.length && fields) return { fields: orderByFacts(fields), source: "model", problems, input_tokens: used.input, output_tokens: used.output };
    problems = found;
  }
  return { fields: templateInsights(input.kind, input.facts), source: "template", problems, input_tokens: used.input, output_tokens: used.output };
}

export async function runReportInsights(db: Db, job: InsightsJob, deps: InsightsDeps): Promise<InsightsOutcome> {
  const table = String(job.payload?.table || "");
  const reportId = String(job.payload?.report_id || "");
  const retry = (reason: string): InsightsOutcome => job.attempts >= job.max_attempts
    ? { status: "failed", reason }
    : { status: "queued", reason, available_at: new Date(deps.now().getTime() + RETRY_WAITS_MINUTES[Math.min(Math.max(1, job.attempts), RETRY_WAITS_MINUTES.length) - 1] * 60_000).toISOString() };
  if (!TABLES[table] || !reportId) return { status: "skipped", reason: "The job names no report." };
  try {
    const { data: row, error } = await db.from(table).select("id, client_id, status, created_at, date_range_start, date_range_end, report_data, clients(name, archived_at)").eq("id", reportId).maybeSingle();
    if (error) throw new Error(`Could not read the report: ${error.message}`);
    if (!row) return { status: "skipped", reason: "The report no longer exists." };
    if (!COMPLETE.includes(String(row.status))) return { status: "skipped", reason: "The report is not finished." };
    if (row.clients?.archived_at) return { status: "skipped", reason: "The client is archived." };
    // Decision 4: reports stored before insights went live keep their text.
    const { data: liveFrom, error: liveError } = await db.rpc("report_insights_live_from");
    if (liveError) throw new Error(`Could not read when insights went live: ${liveError.message}`);
    if (!liveFrom || Date.parse(String(row.created_at)) < Date.parse(String(liveFrom))) return { status: "skipped", reason: "The report is from before report insights." };

    const input = await insightsInput(db, table, row);
    if (!input.facts.length) return { status: "done", result: { facts: 0 } };
    const hash = await inputHash(input);
    const { data: stored, error: storedError } = await db.from("report_insights").select("id").eq("report_id", reportId).eq("input_hash", hash).limit(1);
    if (storedError) throw new Error(`Could not read the stored insights: ${storedError.message}`);
    if (stored?.length) return { status: "done", result: { facts: input.facts.length, reused: true } };

    const written = await writeInsights(input, deps);
    const { error: saveError } = await db.from("report_insights").upsert({
      report_table: table, report_id: reportId, client_id: row.client_id, kind: input.kind, input_hash: hash, facts: input.facts, fields: written.fields,
      source: written.source, model: INSIGHTS_MODEL, prompt_version: INSIGHTS_PROMPT_VERSION, input_tokens: written.input_tokens, output_tokens: written.output_tokens,
      problems: written.problems, created_at: deps.now().toISOString(),
    }, { onConflict: "report_id,input_hash", ignoreDuplicates: true });
    if (saveError) throw new Error(`Could not save the insights: ${saveError.message}`);
    return { status: "done", result: { facts: input.facts.length, source: written.source, input_tokens: written.input_tokens, output_tokens: written.output_tokens } };
  } catch (e) {
    return retry(e instanceof Error ? e.message : String(e));
  }
}

/** Queue a report's insights (report_insights_queue: at most one waiting per report). A queue that won't take it is logged and left to the next finish; it never fails the caller. */
export async function queueReportInsights(db: Db, table: string, reportId: string): Promise<void> {
  try {
    const { error } = await db.rpc("report_insights_queue", { p_table: table, p_report: reportId });
    if (error) console.warn("[report insights] could not queue:", error.message);
  } catch (e) {
    console.warn("[report insights] could not queue:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * The newest insights of a report as text the week planner reads as its
 * report findings: the insights, then the recommendations. Null when the
 * report has none (stored before go-live), so the planner reads the report's
 * own fields as before.
 */
export async function insightFindings(db: Db, reportId: string): Promise<string[] | null> {
  try {
    const { data, error } = await db.from("report_insights").select("fields, created_at").eq("report_id", reportId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data?.fields || data.fields.kind !== "social") return null;
    const f = data.fields as Extract<InsightFields, { kind: "social" }>;
    return [...f.insights, ...(f.recommendations ?? [])].map((c) => c.text).filter(Boolean);
  } catch {
    return null;
  }
}
