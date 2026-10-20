// The social report's two analyses with Claude, ported from the n8n agents
// (SZbRTV7yOdXTNHHf 5f8d3abc):
//   * the brief analysis ("Analyze Client Brief Context", its OpenAI model and
//     "Brief Context Output Parser"): the brief in, seven fields out. In n8n an
//     answer that does not parse leaves the report with the raw brief and a
//     warning; so here.
//   * the synthesis ("AI Synthesis Agent", its OpenAI model and "Structured
//     JSON Output Parser" with its Gemini autofix): the normalized client
//     object in, the analysis out. An answer that does not parse or check goes
//     through the parser's repair prompt (LangChain's, which n8n's autofix
//     uses), then a fresh analysis once.
// The models move from OpenAI and Gemini to Claude Opus 5.5 (owner's decision,
// 20 Oct 2026), as Message Batches (pipelines/claude.ts): a wait is fine for a
// monthly report and a batch costs half. Effort as in the competitive
// analysis: high for the synthesis, low for the repair, and low for the brief,
// which only lifts seven fields out of a page of text.

import { parseAnswer } from "../competitive/analysis.ts";
import { BRIEF_SYSTEM, synthesisSystem, synthesisText } from "./prompt.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export { parseAnswer };

export const SOCIAL_MODEL = "claude-opus-5-5";
export const SYNTHESIS_MAX_TOKENS = 32_000;
export const BRIEF_MAX_TOKENS = 8_000;

const str = { type: "string" };
const strs = { type: "array", items: str };

/** Brief Context Output Parser's schema. Its prompt asks for null where the brief says nothing, so null is accepted too. */
export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    brand_voice: str, target_audience: str, content_themes: strs, brand_values: strs,
    competitive_positioning: str, content_restrictions: strs, campaign_objectives: str,
  },
};

const TRENDS = { type: "object", properties: { overview: str, top_themes: strs, successful_formats: strs, top_hashtags: strs, opportunities_for_client: strs, key_takeaways: strs } };

/** Structured JSON Output Parser's schema (19 Oct 2026: no weekly calendar). */
export const SYNTHESIS_SCHEMA = {
  type: "object",
  required: ["sprout_performance_analysis"],
  properties: {
    sprout_performance_analysis: {
      type: "object",
      properties: {
        month_over_month_summary: str,
        key_insights: strs,
        top_performing_content: strs,
        pillar_alignment: { type: "object", properties: { well_represented: strs, underrepresented: strs, recommendations: strs } },
        platform_breakdown: { type: "array", items: { type: "object", properties: { platform: str, headline: str, insights: strs } } },
      },
    },
    tiktok_trends_analysis: { oneOf: [TRENDS, { type: "null" }] },
    instagram_trends_analysis: { oneOf: [TRENDS, { type: "null" }] },
    competitive_takeaways: strs,
  },
};

/** How an answer must be written, in words (the n8n parsers add their format instructions to the prompt). */
export function formatInstructions(schema: unknown): string {
  return [
    "Return your answer as one JSON object and nothing else: no text before or after it and no code fence.",
    "It must match this JSON Schema:",
    JSON.stringify(schema),
  ].join("\n\n");
}

/** The brief analysis request: the analyst's system message, the brief, the format. */
export function briefRequest(briefText: string): Record<string, unknown> {
  return {
    model: SOCIAL_MODEL,
    max_tokens: BRIEF_MAX_TOKENS,
    system: BRIEF_SYSTEM,
    messages: [{ role: "user", content: `${briefText}\n\n${formatInstructions(BRIEF_SCHEMA)}` }],
    output_config: { effort: "low" },
  };
}

/** The synthesis request, for the normalized client object with its competitive context. */
export function synthesisRequest(json: Any): Record<string, unknown> {
  return {
    model: SOCIAL_MODEL,
    max_tokens: SYNTHESIS_MAX_TOKENS,
    system: synthesisSystem(json),
    messages: [{ role: "user", content: `${synthesisText(json)}\n\n${formatInstructions(SYNTHESIS_SCHEMA)}` }],
    // Opus 5.5 thinks adaptively; effort is the depth (its default is medium).
    output_config: { effort: "high" },
  };
}

/** The autofix's repair prompt (LangChain's, the one n8n's output parser uses). */
export function repairRequest(completion: string, error: string): Record<string, unknown> {
  const text = `Instructions:
--------------
${formatInstructions(SYNTHESIS_SCHEMA)}
--------------
Completion:
--------------
${completion}
--------------

Above, the Completion did not satisfy the constraints given in the Instructions.
Error:
--------------
${error}
--------------

Please try again. Please only respond with an answer that satisfies the constraints laid out in the Instructions:`;
  return { model: SOCIAL_MODEL, max_tokens: SYNTHESIS_MAX_TOKENS, messages: [{ role: "user", content: text }], output_config: { effort: "low" } };
}

const isObj = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
const isStrs = (x: unknown) => Array.isArray(x) && x.every((v) => typeof v === "string");

/**
 * What the brief analysis gives Combine Brief Context with Client Data: the
 * parsed answer as { output }, or { error } when it is not the object asked
 * for (the agent's error item, which n8n passes on).
 */
export function briefAnswer(text: string | null | undefined): Any {
  if (text == null) return { error: "The brief analysis did not answer." };
  const parsed = parseAnswer(text);
  if ("error" in parsed) return { error: parsed.error };
  const v = parsed.value;
  if (!isObj(v)) return { error: "The brief analysis is not an object." };
  for (const k of ["brand_voice", "target_audience", "competitive_positioning", "campaign_objectives"]) {
    if (v[k] != null && typeof v[k] !== "string") return { error: `${k} must be text` };
  }
  for (const k of ["content_themes", "brand_values", "content_restrictions"]) {
    if (v[k] != null && !isStrs(v[k])) return { error: `${k} must be a list of text` };
  }
  return { output: v };
}

/** What in a parsed synthesis does not match its schema; empty when it does. Fields the schema does not name are kept. */
export function synthesisProblems(v: Any): string[] {
  const out: string[] = [];
  if (!isObj(v)) return ["The answer must be a JSON object."];
  const s = v.sprout_performance_analysis;
  if (!isObj(s)) out.push("sprout_performance_analysis must be an object");
  else {
    if (s.month_over_month_summary !== undefined && typeof s.month_over_month_summary !== "string") out.push("sprout_performance_analysis.month_over_month_summary must be a string");
    for (const k of ["key_insights", "top_performing_content"]) if (s[k] !== undefined && !isStrs(s[k])) out.push(`sprout_performance_analysis.${k} must be a list of strings`);
    const p = s.pillar_alignment;
    if (p !== undefined) {
      if (!isObj(p)) out.push("sprout_performance_analysis.pillar_alignment must be an object");
      else for (const k of ["well_represented", "underrepresented", "recommendations"]) if (p[k] !== undefined && !isStrs(p[k])) out.push(`sprout_performance_analysis.pillar_alignment.${k} must be a list of strings`);
    }
    if (s.platform_breakdown !== undefined) {
      if (!Array.isArray(s.platform_breakdown)) out.push("sprout_performance_analysis.platform_breakdown must be an array");
      else s.platform_breakdown.forEach((b: Any, i: number) => {
        if (!isObj(b)) { out.push(`sprout_performance_analysis.platform_breakdown[${i}] must be an object`); return; }
        for (const k of ["platform", "headline"]) if (b[k] !== undefined && typeof b[k] !== "string") out.push(`sprout_performance_analysis.platform_breakdown[${i}].${k} must be a string`);
        if (b.insights !== undefined && !isStrs(b.insights)) out.push(`sprout_performance_analysis.platform_breakdown[${i}].insights must be a list of strings`);
      });
    }
  }
  for (const k of ["tiktok_trends_analysis", "instagram_trends_analysis"]) {
    const t = v[k];
    if (t === undefined || t === null) continue;
    if (!isObj(t)) { out.push(`${k} must be an object or null`); continue; }
    if (t.overview !== undefined && typeof t.overview !== "string") out.push(`${k}.overview must be a string`);
    for (const f of ["top_themes", "successful_formats", "top_hashtags", "opportunities_for_client", "key_takeaways"]) if (t[f] !== undefined && !isStrs(t[f])) out.push(`${k}.${f} must be a list of strings`);
  }
  if (v.competitive_takeaways !== undefined && !isStrs(v.competitive_takeaways)) out.push("competitive_takeaways must be a list of strings");
  return out;
}
