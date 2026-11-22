// QA 22 Nov 2026 (P47-07): the monthly prompt asked for "what moved most", a
// comparison word the check refuses unless the text cites a ranking, share or
// outlier fact. A single-platform client with no outlier post has only change
// facts, so a summary that followed the prompt was refused, and two refusals
// fell back to the template.
import { describe, expect, it } from "vitest";
import { checkInsights, insightsPrompt, type InsightsInput } from "../../../functions/_shared/reports/insights";
import type { Fact } from "../../../functions/_shared/reports/facts";

const change: Fact = {
  id: "F1", key: "change|all|impressions|", kind: "change", platform: "all", metric: "impressions", unit: "count", value: 12400, previous: 9800, change: 2600, percent: 26.5,
  score: 2, numbers: [12400, 9800, 2600, 26.5], sources: ["sprout"],
  sentence: "Impressions rose 26.5% to 12,400.", basis: "Impressions 12,400 in October against 9,800 in September, +26.5%",
};
const input: InsightsInput = { kind: "social", client: "Moburst", period: "2026-10-01 to 2026-10-31", facts: [change], sample: [], rejected: [], preferences: [] };

describe("P47-07 the monthly prompt's own words", () => {
  it("asks for nothing the check refuses when the facts are all changes", () => {
    const line = insightsPrompt(input).split("\n").find((l) => l.startsWith("- summary:"))!;
    const ask = /on (.+?) this period/.exec(line)?.[1] ?? "";
    expect(ask).not.toBe("");
    // A summary in the prompt's own words, citing the change it rests on.
    const summary = { text: `Impressions rose 26.5% to 12,400, which is ${ask} this period.`, facts: ["F1"] };
    const problems = checkInsights({ kind: "social", summary, insights: [{ text: "Impressions rose 26.5% to 12,400.", facts: ["F1"] }], recommendations: [] }, [change]);
    expect(problems.filter((p) => /compares/.test(p))).toEqual([]);
  });
});
