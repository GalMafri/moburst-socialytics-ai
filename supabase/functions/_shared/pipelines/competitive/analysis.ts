// The competitive analysis with Claude, ported from the n8n agent
// (EBiAwSay3H2R8krv: Competitive Analysis Agent, its Analysis Model,
// Competitive Output Parser and Schema Repair Model).
//
// What came from where:
//   * the system message: the repo's n8n/code/competitive-analysis-prompt.txt
//     (prompt.ts), which is newer than the live node's: it names the rate
//     the aggregate now stores (engagement_rate, compared on likes, comments
//     and shares) where the live text still names engagement_rate_per_post;
//     with the owner's writing rules applied (PROMPT_EDITS);
//   * the user message: the repo's agent text (n8n/competitive-metric-
//     coverage.mjs), the aggregated data, and the live node's appendix of the
//     team's learned preferences (team_preferences, version 079ef9fd), which
//     the repo text does not have yet;
//   * the output format: the output parser's JSON example (Americanized),
//     given as a JSON Schema and an example, parsed and checked here; an
//     answer that does not parse or check goes through the same repair
//     prompt the n8n parser's autoFix used.
// The models move from OpenAI (gpt-5.2) to Claude (owner's decision, 20 Oct
// 2026); the calls go through the Message Batches API (pipelines/claude.ts),
// so a long answer never meets a step's time limit.

import { ANALYSIS_SYSTEM_PROMPT } from "./prompt.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export const ANALYSIS_MODEL = "claude-opus-5-5";
/** Room for the thinking and the JSON answer; a batch request has no time limit to fit. */
export const ANALYSIS_MAX_TOKENS = 32_000;

/**
 * The output parser's example, as n8n's Competitive Output Parser holds it,
 * with American spelling, and its two mentions of the rate written the way
 * the system message now asks ("engagement rate per post" is a name the
 * product no longer uses, and 0.006 is not how a person says 0.6%).
 */
export const ANALYSIS_EXAMPLE = {
  executive_summary: "Scale gap: Rival Co leads on followers at 680K against the client's 14.9K, and the distance grew this period.\n\nCadence: The client publishes 12.6 posts a week, level with the field, but 56% of them land in one hour.\n\nEfficiency: Rival Co's engagement rate, compared on likes, comments and shares, is seven times the client's, driven by Reels rather than volume.\n\nWhat is winning: Question-hook Reels with on-screen captions, repeatable weekly by a two-person team.",
  competitor_breakdowns: [{
    name: "Rival Co", is_client: false,
    copy_style: "Question-led hooks in the first line, one CTA, no hashtag walls.",
    hashtag_strategy: "Five niche tags per post, reused across a series.",
    posting_frequency: "Weekday mornings, heaviest Tuesday to Thursday.",
    design_look: "Flat illustration, bold type, consistent brand color.",
    engagement_level: "Carousels outperform stills; Reels carry the account.",
    content_type_mix: "Reels first, carousels second, stills as filler.",
    platform_notes: [{ platform: "instagram", note: "Reels carry most of the engagement on this account." }],
  }],
  winner_teardown: [{
    competitor: "Rival Co",
    pattern: "Question hook in the first two seconds, story-format caption, CTA to comment.",
    evidence: "Three of their five best posts follow it and nothing else they publish comes close.",
    example_post_urls: ["https://www.instagram.com/p/abc123/", "https://www.tiktok.com/@rival/video/1"],
  }],
  posting_time_insights: {
    summary: "The field owns 15:00-21:00 UTC; the client's single 18:00 slot competes head-on for attention it does not need to.",
    empty_airtime: "Weekday middays and weekends are uncontested across every account in the set.",
  },
  recommended_schedule: {
    by_weekday: { Mon: 1, Tue: 2, Wed: 1, Thu: 2, Fri: 1, Sat: 0, Sun: 0 },
    by_hour: { "12": 2, "18": 3, "22": 2 },
    rationale: "Keeps the 18:00 anchor that already performs and moves three posts a week into midday, where no competitor publishes. Target: same engagement from fewer posts in the crowded hour.",
  },
  gaps_for_client: [{
    gap: "No repeatable Reels series", platform: "instagram",
    why_it_matters: "Both leaders earn their top engagement from a recurring Reels format, and the client has none.",
    suggested_play: "Ship one 20-second question-hook Reel a week for six weeks; target an Instagram engagement rate of 0.6%, up from 0.31%.",
  }],
  benchmark_scorecard: { client_score: 62, dimensions: [{ dimension: "Posting cadence", client: 50, competitor_avg: 80, note: "1.2 a week against a set average of 4.1." }] },
};

const str = { type: "string" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const GAP_PLATFORMS = ["instagram", "tiktok", "facebook", "linkedin", "youtube", "x", "all"] as const;

/** The schema the parser derived from the example, every field required. */
export const ANALYSIS_SCHEMA = {
  type: "object",
  required: ["executive_summary", "competitor_breakdowns", "winner_teardown", "posting_time_insights", "recommended_schedule", "gaps_for_client", "benchmark_scorecard"],
  properties: {
    executive_summary: str,
    competitor_breakdowns: { type: "array", items: { type: "object", required: ["name", "is_client", "copy_style", "hashtag_strategy", "posting_frequency", "design_look", "engagement_level", "content_type_mix", "platform_notes"], properties: {
      name: str, is_client: { type: "boolean" }, copy_style: str, hashtag_strategy: str, posting_frequency: str, design_look: str, engagement_level: str, content_type_mix: str,
      platform_notes: { type: "array", items: { type: "object", required: ["platform", "note"], properties: { platform: str, note: str } } },
    } } },
    winner_teardown: { type: "array", items: { type: "object", required: ["competitor", "pattern", "evidence", "example_post_urls"], properties: { competitor: str, pattern: str, evidence: str, example_post_urls: { type: "array", items: str } } } },
    posting_time_insights: { type: "object", required: ["summary", "empty_airtime"], properties: { summary: str, empty_airtime: str } },
    recommended_schedule: { type: "object", required: ["by_weekday", "by_hour", "rationale"], properties: {
      by_weekday: { type: "object", required: [...WEEKDAYS], properties: Object.fromEntries(WEEKDAYS.map((d) => [d, { type: "integer" }])) },
      by_hour: { type: "object", description: "UTC hour (\"0\" to \"23\") to posts per week", additionalProperties: { type: "integer" } },
      rationale: str,
    } },
    gaps_for_client: { type: "array", items: { type: "object", required: ["gap", "platform", "why_it_matters", "suggested_play"], properties: { gap: str, platform: { type: "string", enum: [...GAP_PLATFORMS] }, why_it_matters: str, suggested_play: str } } },
    benchmark_scorecard: { type: "object", required: ["client_score", "dimensions"], properties: {
      client_score: { type: "number", minimum: 0, maximum: 100 },
      dimensions: { type: "array", items: { type: "object", required: ["dimension", "client", "competitor_avg", "note"], properties: { dimension: str, client: { type: "number" }, competitor_avg: { type: "number" }, note: str } } },
    } },
  },
};

/** How the answer must be written: the parser's format instructions, in words. */
export const FORMAT_INSTRUCTIONS = [
  "Return your answer as one JSON object and nothing else: no text before or after it and no code fence.",
  "It must match this JSON Schema, with every field present:",
  JSON.stringify(ANALYSIS_SCHEMA),
  "This example shows the shape; its values are illustrative only:",
  JSON.stringify(ANALYSIS_EXAMPLE),
].join("\n\n");

/** The repo's agent text (n8n/competitive-metric-coverage.mjs), before the data. */
export const ANALYSIS_INTRO = "Analyze this aggregated competitor data for the client and produce the exact JSON the schema requires.\n\ncomparison_metrics hold every company's figures. The client's come from its own Sprout profiles (measured, ads left out) on every platform Sprout covers, and from RivalIQ on a platform it does not; competitors' come from RivalIQ and verified public LinkedIn posts. Engagements are reactions or likes, comments and shares (not on Instagram or YouTube) for every company: never clicks, saves or views. The engagement rate is engagements divided by impressions (views on TikTok and YouTube); across networks it leaves out LinkedIn. Audience in the cross-network benchmark excludes LinkedIn. Current audience snapshots carry audience_as_of and must never be described as historical growth. A competitor's impressions are RivalIQ estimates; the client's are measured.";

/** The live node's appendix (version 079ef9fd): the team's learned preferences, when the request carries any. */
export function preferencesAppendix(prefs: unknown): string {
  return Array.isArray(prefs) && prefs.length
    ? "\n\nThe account team's standing preferences for this client's suggestions, learned from their edits to earlier reports. Follow every one when you write gaps_for_client:\n" + prefs.map((p) => "- " + p).join("\n")
    : "";
}

/** The analysis request: the system message, then the data, the preferences and the format. */
export function analysisRequest(aggregates: Any, teamPreferences: unknown): Record<string, unknown> {
  const text = `${ANALYSIS_INTRO}\n\n${JSON.stringify(aggregates)}${preferencesAppendix(teamPreferences)}\n\n${FORMAT_INSTRUCTIONS}`;
  return {
    model: ANALYSIS_MODEL,
    max_tokens: ANALYSIS_MAX_TOKENS,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
    // Opus 5.5 thinks adaptively; effort is the depth (its default is medium).
    output_config: { effort: "high" },
  };
}

/** The n8n output parser's repair prompt (autoFix with its custom retry prompt). */
export function repairRequest(completion: string, error: string): Record<string, unknown> {
  const text = "Repair only the JSON structure to match the schema. Preserve all supplied factual values and source URLs; do not invent missing research. Correct field-name typos such as why_itmatters to why_it_matters.\n"
    + `Instructions: ${FORMAT_INSTRUCTIONS}\nCompletion: ${completion}\nValidation error: ${error}`;
  return {
    model: ANALYSIS_MODEL,
    max_tokens: ANALYSIS_MAX_TOKENS,
    messages: [{ role: "user", content: text }],
    output_config: { effort: "low" },
  };
}

/** The JSON object in an answer: the whole text, or the span from its first "{" to its last "}". */
export function parseAnswer(text: string): { value: Any } | { error: string } {
  const t = String(text ?? "").trim();
  if (!t) return { error: "The answer is empty." };
  const tries = [t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)];
  for (const candidate of tries) {
    if (!candidate) continue;
    try {
      return { value: JSON.parse(candidate) };
    } catch {
      // try the next form
    }
  }
  return { error: "The answer is not valid JSON." };
}

/**
 * What in a parsed answer does not match the schema; empty when it does.
 * Three fields may be null, as the app itself stores them when the evidence
 * does not support them (reportEvidence.ts): posting_time_insights
 * .empty_airtime, recommended_schedule and benchmark_scorecard.client_score.
 */
export function analysisProblems(v: Any): string[] {
  const out: string[] = [];
  const isObj = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
  const isStr = (x: unknown) => typeof x === "string";
  const isInt = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;
  const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const fields = (where: string, item: Any, keys: string[], test: (x: unknown) => boolean, kind: string) => {
    for (const k of keys) if (!test(item?.[k])) out.push(`${where}.${k} must be ${kind}`);
  };
  if (!isObj(v)) return ["The answer must be a JSON object."];
  if (!isStr(v.executive_summary)) out.push("executive_summary must be a string");
  for (const k of ["competitor_breakdowns", "winner_teardown", "gaps_for_client"]) if (!Array.isArray(v[k])) out.push(`${k} must be an array`);
  (Array.isArray(v.competitor_breakdowns) ? v.competitor_breakdowns : []).forEach((b: Any, i: number) => {
    fields(`competitor_breakdowns[${i}]`, b, ["name", "copy_style", "hashtag_strategy", "posting_frequency", "design_look", "engagement_level", "content_type_mix"], isStr, "a string");
    if (typeof b?.is_client !== "boolean") out.push(`competitor_breakdowns[${i}].is_client must be true or false`);
    if (!Array.isArray(b?.platform_notes)) out.push(`competitor_breakdowns[${i}].platform_notes must be an array`);
    else b.platform_notes.forEach((n: Any, j: number) => fields(`competitor_breakdowns[${i}].platform_notes[${j}]`, n, ["platform", "note"], isStr, "a string"));
  });
  (Array.isArray(v.winner_teardown) ? v.winner_teardown : []).forEach((w: Any, i: number) => {
    fields(`winner_teardown[${i}]`, w, ["competitor", "pattern", "evidence"], isStr, "a string");
    if (!Array.isArray(w?.example_post_urls) || !w.example_post_urls.every(isStr)) out.push(`winner_teardown[${i}].example_post_urls must be a list of URLs`);
  });
  if (!isObj(v.posting_time_insights)) out.push("posting_time_insights must be an object");
  else {
    fields("posting_time_insights", v.posting_time_insights, ["summary"], isStr, "a string");
    if (v.posting_time_insights.empty_airtime !== null) fields("posting_time_insights", v.posting_time_insights, ["empty_airtime"], isStr, "a string or null");
  }
  const s = v.recommended_schedule;
  if (s === null) {
    // Withheld: the evidence does not support a schedule.
  } else if (!isObj(s)) out.push("recommended_schedule must be an object or null");
  else {
    if (!isObj(s.by_weekday) || !WEEKDAYS.every((d) => isInt(s.by_weekday[d]))) out.push("recommended_schedule.by_weekday must give Mon to Sun as whole numbers");
    if (!isObj(s.by_hour) || !Object.entries(s.by_hour).every(([h, n]) => /^(?:[0-9]|1[0-9]|2[0-3])$/.test(h) && isInt(n))) out.push("recommended_schedule.by_hour must map UTC hours 0 to 23 to whole numbers");
    if (!isStr(s.rationale)) out.push("recommended_schedule.rationale must be a string");
  }
  (Array.isArray(v.gaps_for_client) ? v.gaps_for_client : []).forEach((g: Any, i: number) => {
    fields(`gaps_for_client[${i}]`, g, ["gap", "why_it_matters", "suggested_play"], isStr, "a string");
    if (!(GAP_PLATFORMS as readonly string[]).includes(g?.platform)) out.push(`gaps_for_client[${i}].platform must be one of ${GAP_PLATFORMS.join(", ")}`);
  });
  const b = v.benchmark_scorecard;
  if (!isObj(b)) out.push("benchmark_scorecard must be an object");
  else {
    if (b.client_score !== null && !(isNum(b.client_score) && b.client_score >= 0 && b.client_score <= 100)) out.push("benchmark_scorecard.client_score must be a number from 0 to 100, or null");
    if (!Array.isArray(b.dimensions)) out.push("benchmark_scorecard.dimensions must be an array");
  }
  return out;
}
