// supabase/functions/_shared/reports/insights.ts
//
// Report insights from the data (Lital, 3 Nov 2026). Design:
// docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 2.
//
// Code decides what a report says (facts.ts); one Sonnet 5.5 call only words
// the numbered facts (decision 3), through structured outputs at effort
// medium, each insight citing its fact ids. Code checks the answer: the ids
// exist, every number written (one after a currency sign included) is a
// cited fact's number at the precision it was written, a direction word
// ("rose", "fell", "dropped", "doubled" and their kin) sits only in a
// sentence citing a change that moved that way, a comparison ("leads",
// "behind", "top", "most", "every rival") cites a ranking, share or outlier
// fact (a monthly report has no rankings: its top post is an outlier),
// no word sizes a change in place of its number ("sharply"), no fact id is
// written, and a competitive answer with no gaps is refused when the facts
// show the client behind a competitor. The prompt states the same rules.
// A failed answer is asked once more with its problems named; a second
// failure shows the facts as sentences written here. Nothing on screen says
// anything failed.
//
// Same data, same insights: an answer is stored in report_insights under a
// hash of its exact input (the facts, the post sample, the prompt version
// and the model, and for a competitive report the suggestions the team
// rejected and its learned preferences, which shape gaps as they shape the
// model's on main: competitive prompt.ts, aggregate.ts suppressed_insights,
// analysis.ts team_preferences); a stored hash is used again with no call.
// Those are read once, when the job runs: no vote queues or re-words a
// report. A rejected suggestion is refused by the check too, and verdicts
// apply again when a report is read, keyed by a gap's words (insightKey).
// The row shown is a report's newest confirmed one: meeting a stored input
// again stamps it confirmed, so a report whose input returns to an earlier
// one (an undone change) shows that earlier answer again.
// Only reports from go-live on get insights (decision 4,
// report_insights_live_from); stored reports keep their text.
//
// The report_insights job (run-scheduled-jobs) is queued when a report's
// report_text job finishes (20261110220000_data_driven_insights.sql).

import { numbersIn, sentences } from "./reportText.ts";
import { competitiveChanges, competitiveFacts, socialChanges, socialFacts, type Fact } from "./facts.ts";
import { GAP_PLATFORMS } from "../pipelines/competitive/analysis.ts";
import { insightKey } from "./payloads.ts";
import { type CompetitiveLearning, learningLines } from "../competitive/suggestionEdits.ts";

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
/** A suggestion the team rejected (a thumbs-down): its key (insightKey) and its words. */
export interface Rejected { key: string; gap: string }

export interface InsightsInput {
  kind: InsightsKind;
  client: string;
  period: string | null;
  facts: Fact[];
  sample: SamplePost[];
  /** Competitive only: the suggestions the team rejected, by key. Never proposed again. */
  rejected: Rejected[];
  /** Competitive only: the team's standing preferences, learned from its edits (learningLines). */
  preferences: string[];
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
  "A number after a currency sign ($, €, £) is a number too: it must be one of the cited facts' numbers.",
  "Write rose, fell, dropped or doubled (or any other word for which way a change went: grew, climbed, slipped, halved, up 12%, down from) only in a sentence that cites a change fact that moved that way. Doubled, tripled and halved must be what the cited change was.",
  "Never size a change with a word in place of its number, such as sharply or significantly: give the number.",
  "Compare (leads, behind, ahead, top, most, best, every rival, more than) only in text that cites a ranking, share or outlier fact.",
  "Plain American English, short sentences, no em dashes or en dashes, no jargon, never write fact ids (F1) in the text, never mention the facts list or how the facts were made.",
  "Never name where the data comes from (no tool or vendor names such as Sprout, RivalIQ, Apify or Gamma), and never write AI, model, prompt, score, pipeline or gate.",
].join("\n");

/** The one message the model gets. `problems` are the first answer's, when it is asked again. */
export function insightsPrompt(input: InsightsInput, problems: string[] = []): string {
  const facts = input.facts.map((f) => `${f.id} (${f.kind}): ${f.sentence} (${f.basis})`);
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
    if (input.rejected.length) lines.push("", "Suggestions the account team rejected (never propose any of these or a rephrasing of one):", ...input.rejected.map((r) => `- ${r.gap}`));
    if (input.preferences.length) lines.push("", "The account team's standing preferences for this client's suggestions, learned from their edits to earlier reports. Follow every one when you write gaps:", ...input.preferences.map((p) => `- ${p}`));
    lines.push("", "Write:",
      "- summary: two to four short paragraphs on where the client stands against its competitors, each citing the facts it rests on;",
      "- gaps: two to four gaps the client can close, each with the gap, its platform, why it matters and a test to run, citing the facts it rests on. A test's target may only be a cited fact's number. When the facts show the client behind a competitor on any compared metric, write at least one gap.");
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

/**
 * Words a client must not read (src/test/competitive/clientFacing.test.tsx):
 * a data vendor's name and the words of how the product is built. Dashes are
 * refused on their own.
 */
const CLIENT_WORDS = /\bAI\b|\b(?:prompts?|models?|scores?|pipelines?|gates?)\b|Socialytics|Rival ?IQ|Sprout|Apify|Gamma/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words for which way a change went, anywhere in a sentence: past forms, and "up" or "down" before a number or "from". */
const RISE = /\b(?:rose|risen|rising|grew|grown|growing|increased|climbed|gained|jumped|surged|soared|rebounded)\b|\bup\b(?=\s+(?:by\s+)?[$€£¥]?\d|\s+from\b)/gi;
const FALL = /\b(?:fell|fallen|falling|dropped|declined|declining|decreased|shrank|shrunk|slipped|slid|sank|plunged|plummeted|dipped|slumped)\b|\bdown\b(?=\s+(?:by\s+)?[$€£¥]?\d|\s+from\b)/gi;
/** Words that claim a multiple: checked as the number they are. */
const MULTIPLES: Record<string, number> = { doubled: 2, tripled: 3, quadrupled: 4, halved: 0.5 };
const MULTIPLE = /\b(?:doubled|tripled|quadrupled|halved)\b/gi;
/** Words that size a change in place of its number. */
const SIZE = /\b(?:sharp(?:ly)?|steep(?:ly)?|significant(?:ly)?|dramatic(?:ally)?|substantial(?:ly)?|considerabl[ey]|massive(?:ly)?|huge(?:ly)?|enormous(?:ly)?|tremendous(?:ly)?|slight(?:ly)?|marginal(?:ly)?|modest(?:ly)?|greatly|rapid(?:ly)?|vastly|sizable|sizeable)\b/i;
/** Words that compare the client with others, a part with the whole, or a post with the rest: they need a ranking, share or outlier fact. */
const COMPARE = /\b(?:leads?|leading|leader|behind|trails?|trailing|ahead|top|most|least|highest|lowest|best|worst|outperform(?:s|ed|ing)?|outpace[sd]?|outpacing|ranks?|ranked|every (?:rival|competitor)|all (?:rivals|competitors))\b|\b(?:more|less|fewer|higher|lower|better|worse|bigger|smaller) than\b(?!\s*[$€£¥]?\d)/i;
const FACT_ID = /\bF\d+\b/;

/**
 * Every number in a text, one after a currency sign included: numbersIn
 * (reportText.ts) skips those for its own callers, so the sign is blanked
 * here (positions kept) and put back in the number's text.
 */
function numbersOf(text: string) {
  return numbersIn(text.replace(/[$€£¥](?=\s?\d)/g, " ")).map((n) => {
    const sign = /[$€£¥]\s?$/.exec(text.slice(Math.max(0, n.start - 2), n.start))?.[0] ?? "";
    return { ...n, text: `${sign.trim()}${n.text.trim()}` };
  });
}

const UP = /\b(rose|rise|rises|risen|rising|up|grew|grow|grows|growing|increased?|increases|increasing|climbed?|gained?)\b/gi;
const DOWN = /\b(fell|fall|falls|fallen|falling|down|dropped|drops?|declined?|declines|declining|decreased?|decreases|decreasing|shrank|shrinks?|slipped|slid)\b/gi;

/** The problems with one piece of text against the facts it cites. */
function textProblems(where: string, text: string, citedIds: string[], byId: Map<string, Fact>, names: RegExp | null): string[] {
  const out: string[] = [];
  if (!text) return [`${where} is empty.`];
  if (/[–—]/.test(text)) out.push(`${where} has a dash; use commas or periods.`);
  // A company's own name ("Acme AI") is no such word.
  const banned = (names ? text.replace(names, " ") : text).match(CLIENT_WORDS);
  if (banned) out.push(`${where} uses "${banned[0]}", a word the client must not read.`);
  if (!citedIds.length) out.push(`${where} cites no fact.`);
  const unknown = citedIds.filter((id) => !byId.has(id));
  if (unknown.length) out.push(`${where} cites ${unknown.join(", ")}, which are not in the facts.`);
  const facts = citedIds.map((id) => byId.get(id)).filter((f): f is Fact => !!f);
  // Every number is one of the cited facts' numbers at the precision it was written.
  for (const n of numbersOf(text)) {
    if (!facts.some((f) => f.numbers.some((v) => Math.abs(Math.abs(v) - n.value) <= n.tolerance))) out.push(`${where} writes ${n.text}, which is not a number of the facts it cites.`);
  }
  // The words, without the companies' own names ("Top Shelf Co" is no comparison).
  const words = names ? text.replace(names, " ") : text;
  const id = FACT_ID.exec(words);
  if (id) out.push(`${where} writes a fact id (${id[0]}); never write them.`);
  const size = SIZE.exec(words);
  if (size) out.push(`${where} sizes a change with "${size[0]}"; give its number instead.`);
  const compare = COMPARE.exec(words);
  if (compare && !facts.some((f) => f.kind === "ranking" || f.kind === "share" || f.kind === "outlier")) out.push(`${where} compares ("${compare[0]}"), but cites no ranking, share or outlier fact.`);
  // A direction word, anywhere in its sentence, needs a cited change that went that way; a multiple, a change of that size.
  const changes = facts.filter((f) => f.kind === "change");
  const went = (up: boolean) => changes.some((f) => (up ? 1 : -1) * (f.percent ?? f.change ?? 0) > 0);
  for (const s of sentences(words)) {
    const multiples = [...s.text.matchAll(MULTIPLE)].map((m) => ({ word: m[0], times: MULTIPLES[m[0].toLowerCase()] }));
    const rise = [...s.text.matchAll(RISE)].map((m) => m[0]).concat(multiples.filter((m) => m.times > 1).map((m) => m.word))[0];
    const fall = [...s.text.matchAll(FALL)].map((m) => m[0]).concat(multiples.filter((m) => m.times < 1).map((m) => m.word))[0];
    if (rise && !went(true)) out.push(`${where} says ${rise}, but no change it cites went up.`);
    if (fall && !went(false)) out.push(`${where} says ${fall}, but no change it cites went down.`);
    for (const m of multiples) {
      if (!changes.some((f) => f.previous && Math.abs(f.value / f.previous - m.times) <= 0.05 * m.times)) out.push(`${where} says ${m.word}, but no change it cites is ${m.times}x.`);
    }
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

/**
 * Why an answer can't be shown, or nothing when it can. `client` is the
 * report's client, whose name may hold any word; `rejected`, the keys
 * (insightKey) of the suggestions the team rejected.
 */
export function checkInsights(fields: InsightFields | null, facts: Fact[], opts: { client?: string; rejected?: string[] } = {}): string[] {
  const client = opts.client ?? "";
  const rejected = new Set(opts.rejected ?? []);
  if (!fields) return ["The answer could not be read as the JSON asked for."];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const companies = [...new Set([client, ...facts.flatMap((f) => [f.company, f.leader])].map((n) => String(n ?? "").trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const names = companies.length ? new RegExp(companies.map(escapeRe).join("|"), "gi") : null;
  const check = (where: string, text: string, cited: string[]) => textProblems(where, text, cited, byId, names);
  const out: string[] = [];
  if (fields.kind === "social") {
    if (!fields.summary) out.push("The summary is missing.");
    else out.push(...check("The summary", fields.summary.text, fields.summary.facts));
    if (!fields.insights.length) out.push("There are no insights.");
    fields.insights.forEach((c, i) => out.push(...check(`Insight ${i + 1}`, c.text, c.facts)));
    (fields.recommendations ?? []).forEach((c, i) => out.push(...check(`Recommendation ${i + 1}`, c.text, c.facts)));
  } else {
    if (!fields.summary.length) out.push("The summary is missing.");
    fields.summary.forEach((c, i) => out.push(...check(`Summary paragraph ${i + 1}`, c.text, c.facts)));
    (fields.gaps ?? []).forEach((g, i) => {
      if (!(GAP_PLATFORMS as readonly string[]).includes(g.platform)) out.push(`Gap ${i + 1} names a platform that is not one of ${GAP_PLATFORMS.join(", ")}.`);
      if (rejected.has(insightKey(g.gap))) out.push(`Gap ${i + 1} is a suggestion the team rejected; never propose it again.`);
      for (const [part, text] of [["gap", g.gap], ["why it matters", g.why_it_matters], ["test", g.suggested_play]] as const) out.push(...check(`Gap ${i + 1}'s ${part}`, text, g.facts));
    });
    // An answer with no gaps leaves the client nothing to close, though the facts show it behind.
    const behind = facts.filter((f) => f.kind === "ranking" && (f.rank ?? 1) > 1).map((f) => f.id);
    if (fields.gaps && !fields.gaps.length && behind.length) out.push(`There are no gaps, but ${behind.join(", ")} ${behind.length === 1 ? "shows" : "show"} the client behind a competitor; write at least one gap.`);
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
  const text = JSON.stringify({ v: INSIGHTS_PROMPT_VERSION, model, kind: input.kind, client: input.client, period: input.period, facts: input.facts, sample: input.sample, rejected: input.rejected, preferences: input.preferences });
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

/** The report's facts, its post sample, and for a competitive report the team's rejected suggestions and preferences: the exact input an answer is stored under. */
export async function insightsInput(db: Db, table: string, row: Any): Promise<InsightsInput> {
  const kind = TABLES[table];
  const { data: earlier, error } = await db.from(table).select("report_data, created_at").eq("client_id", row.client_id).in("status", COMPLETE)
    .lt("created_at", row.created_at).order("created_at", { ascending: false }).limit(HISTORY_REPORTS);
  if (error) throw new Error(`Could not read the client's earlier reports: ${error.message}`);
  const history = ((earlier ?? []) as Any[]).map((r) => (kind === "social" ? socialChanges(reportData(r)) : competitiveChanges(reportData(r))));
  const period = { start: row.date_range_start, end: row.date_range_end };
  const rd = reportData(row);
  const facts = kind === "social" ? socialFacts(rd, { period, history }) : competitiveFacts(rd, { period, history });
  let rejected: Rejected[] = [];
  let preferences: string[] = [];
  if (kind === "competitive") {
    // As the competitive analysis gets them (payloads.ts buildCompetitivePayload): the thumbs-down suggestions and the newest twenty learnings.
    const { data: down, error: downError } = await db.from("competitive_insight_feedback").select("insight_key, gap_text").eq("client_id", row.client_id).eq("verdict", "down");
    if (downError) throw new Error(`Could not read the suggestions the team rejected: ${downError.message}`);
    rejected = [...new Map(((down ?? []) as Any[])
      .map((r) => ({ key: str(r.insight_key) || insightKey(r.gap_text), gap: str(r.gap_text) || str(r.insight_key) }))
      .filter((r) => r.gap).map((r) => [r.key, r] as const)).values()]
      .sort((a, b) => a.key.localeCompare(b.key));
    const { data: learned, error: learnedError } = await db.from("competitive_learnings").select("kind, text").eq("client_id", row.client_id).order("created_at", { ascending: false }).limit(20);
    if (learnedError) throw new Error(`Could not read the team's preferences: ${learnedError.message}`);
    preferences = learningLines((learned ?? []) as CompetitiveLearning[]);
  }
  return {
    kind, client: String(row.clients?.name || "the client"), period: row.date_range_start && row.date_range_end ? `${row.date_range_start} to ${row.date_range_end}` : null,
    facts, sample: kind === "competitive" ? postSample(rd) : [], rejected, preferences,
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
    const found = checkInsights(fields, input.facts, { client: input.client, rejected: input.rejected.map((r) => r.key) });
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
    const confirmedAt = deps.now().toISOString();
    const { data: stored, error: storedError } = await db.from("report_insights").select("id").eq("report_id", reportId).eq("input_hash", hash).limit(1);
    if (storedError) throw new Error(`Could not read the stored insights: ${storedError.message}`);
    if (stored?.length) {
      // The same words again, and the ones shown: stamped as the newest confirmed.
      const { error: stampError } = await db.from("report_insights").update({ confirmed_at: confirmedAt }).eq("report_id", reportId).eq("input_hash", hash);
      if (stampError) throw new Error(`Could not confirm the stored insights: ${stampError.message}`);
      return { status: "done", result: { facts: input.facts.length, reused: true } };
    }

    const written = await writeInsights(input, deps);
    const { error: saveError } = await db.from("report_insights").upsert({
      report_table: table, report_id: reportId, client_id: row.client_id, kind: input.kind, input_hash: hash, facts: input.facts, fields: written.fields,
      source: written.source, model: INSIGHTS_MODEL, prompt_version: INSIGHTS_PROMPT_VERSION, input_tokens: written.input_tokens, output_tokens: written.output_tokens,
      problems: written.problems, created_at: confirmedAt, confirmed_at: confirmedAt,
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
