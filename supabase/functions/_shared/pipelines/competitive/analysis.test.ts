// @vitest-environment node
// The analysis request and its answer: the system message is the repo's n8n
// prompt with the owner's writing rules applied and nothing else changed;
// the user message carries the repo's agent text, the data, the live node's
// learned-preferences appendix and the output format; answers are parsed and
// checked as the n8n output parser did, and repaired with its prompt.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FX } from "../fixtures/moburst";
import { analysisProblems, analysisRequest, ANALYSIS_EXAMPLE, ANALYSIS_INTRO, ANALYSIS_MODEL, FORMAT_INSTRUCTIONS, parseAnswer, preferencesAppendix, repairRequest } from "./analysis";
import { ANALYSIS_SYSTEM_PROMPT, PROMPT_EDITS } from "./prompt";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const repoPrompt = readFileSync(join(root, "n8n", "code", "competitive-analysis-prompt.txt"), "utf8");
const coverage = readFileSync(join(root, "n8n", "competitive-metric-coverage.mjs"), "utf8");

describe("the analysis prompt", () => {
  it("is the repo's n8n prompt with exactly the listed edits", () => {
    let expected = repoPrompt;
    for (const [from, to] of PROMPT_EDITS) {
      expect(expected.split(from)).toHaveLength(2);
      expected = expected.replace(from, to);
    }
    expect(ANALYSIS_SYSTEM_PROMPT).toBe(expected);
  });

  it("has no em or en dash, and asks for American English without them", () => {
    for (const text of [ANALYSIS_SYSTEM_PROMPT, ANALYSIS_INTRO, FORMAT_INSTRUCTIONS, JSON.stringify(ANALYSIS_EXAMPLE)]) expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("- Write in American English, and never use an em dash or an en dash.");
    expect(JSON.stringify(ANALYSIS_EXAMPLE)).not.toMatch(/colour|per post of/);
  });

  it("opens the user message with the repo's agent text", () => {
    expect(coverage).toContain(JSON.stringify(ANALYSIS_INTRO).slice(1, -1).replace(/'/g, "\\'"));
  });

  it("adds the team's learned preferences as the live node does, and nothing when there are none", () => {
    expect(preferencesAppendix(["Prefer: LinkedIn ideas", "Avoid: giveaways"])).toBe("\n\nThe account team's standing preferences for this client's suggestions, learned from their edits to earlier reports. Follow every one when you write gaps_for_client:\n- Prefer: LinkedIn ideas\n- Avoid: giveaways");
    expect(preferencesAppendix([])).toBe("");
    expect(preferencesAppendix(undefined)).toBe("");
  });

  it("asks Opus 5.5 at high effort, with no sampling parameter and no prefill", () => {
    const body = analysisRequest({ client_name: "Moburst" }, ["Prefer: x"]);
    expect(body).toMatchObject({ model: ANALYSIS_MODEL, max_tokens: 32000, system: ANALYSIS_SYSTEM_PROMPT, output_config: { effort: "high" } });
    expect(ANALYSIS_MODEL).toBe("claude-opus-5-5");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(["user"]);
    expect(messages[0].content).toBe(`${ANALYSIS_INTRO}\n\n{"client_name":"Moburst"}${preferencesAppendix(["Prefer: x"])}\n\n${FORMAT_INSTRUCTIONS}`);
  });
});

describe("the answer", () => {
  it("parses a bare object, one wrapped in prose or a code fence, and refuses the rest", () => {
    expect(parseAnswer('{"a":1}')).toEqual({ value: { a: 1 } });
    expect(parseAnswer('Here it is:\n```json\n{"a":1}\n```')).toEqual({ value: { a: 1 } });
    expect(parseAnswer("")).toEqual({ error: "The answer is empty." });
    expect(parseAnswer("no json here")).toEqual({ error: "The answer is not valid JSON." });
  });

  it("checks the parser's schema: the example and a stored analysis pass", () => {
    expect(analysisProblems(ANALYSIS_EXAMPLE)).toEqual([]);
    expect(analysisProblems(FX.real_analysis)).toEqual([]);
  });

  it("names what does not match", () => {
    const bad = structuredClone(ANALYSIS_EXAMPLE) as Record<string, any>;
    bad.gaps_for_client[0].platform = "Instagram Reels";
    bad.recommended_schedule.by_hour = { "25": 1 };
    delete bad.winner_teardown[0].example_post_urls;
    bad.competitor_breakdowns[0].is_client = "no";
    expect(analysisProblems(bad)).toEqual([
      "competitor_breakdowns[0].is_client must be true or false",
      "winner_teardown[0].example_post_urls must be a list of URLs",
      "recommended_schedule.by_hour must map UTC hours 0 to 23 to whole numbers",
      "gaps_for_client[0].platform must be one of instagram, tiktok, facebook, linkedin, youtube, x, all",
    ]);
    expect(analysisProblems([])).toEqual(["The answer must be a JSON object."]);
  });

  it("asks for client_score on 0 to 100 and sends a score outside it to the repair", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("client_score is a qualitative AI assessment on a scale of 0 to 100");
    const scored = (client_score: unknown) => {
      const v = structuredClone(ANALYSIS_EXAMPLE) as Record<string, any>;
      v.benchmark_scorecard.client_score = client_score;
      return analysisProblems(v);
    };
    for (const ok of [0, 42, 100, null]) expect(scored(ok)).toEqual([]);
    for (const bad of [420, -1, "62"]) expect(scored(bad)).toEqual(["benchmark_scorecard.client_score must be a number from 0 to 100, or null"]);
  });

  it("is repaired with the n8n parser's own repair prompt", () => {
    const body = repairRequest("{broken", "executive_summary must be a string");
    const text = (body.messages as Array<{ content: string }>)[0].content;
    expect(text).toBe(`Repair only the JSON structure to match the schema. Preserve all supplied factual values and source URLs; do not invent missing research. Correct field-name typos such as why_itmatters to why_it_matters.\nInstructions: ${FORMAT_INSTRUCTIONS}\nCompletion: {broken\nValidation error: executive_summary must be a string`);
    expect(body).toMatchObject({ model: ANALYSIS_MODEL, output_config: { effort: "low" } });
  });
});
