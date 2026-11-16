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
import { FX } from "../../../../fixtures/pipelines/moburst";
import { analysisProblems, analysisRequest, answerWithoutVendors, writerAggregates, ANALYSIS_EXAMPLE, ANALYSIS_INTRO, ANALYSIS_MODEL, ANALYSIS_SCHEMA, FORMAT_INSTRUCTIONS, parseAnswer, preferencesAppendix, repairRequest } from "../../../../functions/_shared/pipelines/competitive/analysis";
import { ANALYSIS_SYSTEM_PROMPT, PROMPT_EDITS } from "../../../../functions/_shared/pipelines/competitive/prompt";

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

  it("opens the user message with an agent text and a prompt that name no data vendor", () => {
    for (const text of [ANALYSIS_INTRO, ANALYSIS_SYSTEM_PROMPT]) expect(text).not.toMatch(/RivalIQ|Rival IQ|Sprout|rivaliq/);
  });

  it("gives the writer the figures with no vendor in a key, a label or a note, and the stored aggregates untouched", () => {
    const stored = {
      metric_scope: "rivaliq_period_totals_with_separate_post_sample",
      metrics_note: "RivalIQ period metrics were not returned for this run.",
      schema_note: "RivalIQ returned zero posts for this landscape and period.",
      companies: [
        { name: "Sprout Social", rivaliq_metrics: { posts: { current: 4 } }, comparison_metrics: { metric_scopes: { impressions: "sprout", audience: "sprout_and_rivaliq", engagement: "rivaliq" }, by_network: { instagram: { source: "sprout" } } } },
      ],
    };
    const before = structuredClone(stored);
    const given = writerAggregates(stored);
    expect(stored).toEqual(before);
    const text = JSON.stringify(given);
    expect(text).not.toMatch(/rivaliq|"sprout"|Rival ?IQ/i);
    expect(given.companies[0].name).toBe("Sprout Social");
    expect(given.companies[0].provider_metrics).toEqual({ posts: { current: 4 } });
    expect(given.companies[0].comparison_metrics.metric_scopes).toEqual({ impressions: "measured", audience: "measured_and_estimated", engagement: "estimated" });
    expect(given.metric_scope).toBe("period_totals_with_separate_post_sample");
    expect(given.schema_note).toBe("The data source returned zero posts for this landscape and period.");
    expect(analysisRequest(stored, []).messages).toBeDefined();
    expect(JSON.stringify(analysisRequest(stored, []))).not.toMatch(/rivaliq|Rival ?IQ/i);
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
    // A stored analysis from before the rule names its data source; its shape is right, and that is no problem.
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
      "recommended_schedule.by_hour must map hours 0 to 23 to whole numbers",
      "gaps_for_client[0].platform must be one of instagram, tiktok, facebook, linkedin, youtube, x, all",
    ]);
    expect(analysisProblems([])).toEqual(["The answer must be a JSON object."]);
  });

  it("asks for posting hours in the report's time zone, never UTC", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("by_hour (hour of the day as a string, in the time zone named by time_zone in the data, or UTC when the data names none");
    expect(ANALYSIS_SYSTEM_PROMPT).not.toContain("UTC hour string");
    expect(JSON.stringify(ANALYSIS_SCHEMA)).not.toContain("UTC hour");
    expect(JSON.stringify(ANALYSIS_EXAMPLE)).not.toMatch(/UTC/);
  });

  it("asks the writer to name no data source, and mends an answer that names one instead of sending it to a paid repair", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("Name no data source, tool or vendor in any field");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const named = (path: (v: Record<string, any>) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = structuredClone(ANALYSIS_EXAMPLE) as Record<string, any>;
      path(v);
      return v;
    };
    const aggregates = { companies: [{ name: "Sprout Social" }] };
    const note = named((v) => { v.competitor_breakdowns[0].platform_notes[0].note = "Captured as actual via Sprout."; v.recommended_schedule.rationale = "RivalIQ shows a midday gap."; v.executive_summary = "Scale gap: the Rival IQ totals show it. Ideas sprout."; });
    // Never a problem: the answer is as valid as it was.
    expect(analysisProblems(note)).toEqual([]);
    const mended = answerWithoutVendors(note, aggregates);
    expect(mended.competitor_breakdowns[0].platform_notes[0].note).toBe("Captured as actual via the data source.");
    expect(mended.recommended_schedule.rationale).toBe("The data source shows a midday gap.");
    expect(mended.executive_summary).toBe("Scale gap: the data source totals show it. Ideas sprout.");
    // A company that shares a vendor's name is a name, not a source.
    const company = named((v) => { v.competitor_breakdowns[0].name = "Sprout Social"; v.competitor_breakdowns[0].copy_style = "Sprout Social writes short hooks."; });
    expect(answerWithoutVendors(company, aggregates).competitor_breakdowns[0]).toMatchObject({ name: "Sprout Social", copy_style: "Sprout Social writes short hooks." });
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
