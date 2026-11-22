// QA 22 Nov 2026 (P47-02): a client or competitor whose name holds a number
// ("Studio 54", "7 Cups", "5W Public Relations") had every model answer
// refused, the number check reading the name's digits as a figure.
import { describe, expect, it } from "vitest";
import { checkInsights, type InsightFields } from "../../../functions/_shared/reports/insights";
import type { Fact } from "../../../functions/_shared/reports/facts";

const ranking: Fact = {
  id: "F1", key: "ranking|all|compared_rate|Studio 54", kind: "ranking", platform: "all", metric: "compared_rate", company: "Studio 54",
  unit: "percent", value: 3.2, rank: 1, of: 3, leader: "Studio 54", leaderValue: 3.2, median: 2.1, score: 2,
  numbers: [3.2, 3.2, 2.1, 1, 3], sources: ["sprout", "rivaliq"],
  sentence: "Studio 54 leads on engagement rate compared on likes, comments and shares with 3.2%; the median is 2.1%.",
  basis: "Engagement rate compared on likes, comments and shares: Studio 54 3.2%, Studio 54 3.2% (highest), median 2.1% across 3 companies",
};

describe("P47-02 company names with digits", () => {
  it("accepts a sentence that names the client and cites only the fact's numbers", () => {
    const fields: InsightFields = { kind: "competitive", summary: [{ text: "Studio 54 leads its rivals on engagement rate, at 3.2% against a median of 2.1%.", facts: ["F1"] }], gaps: [] };
    // The words check already strips company names ("Top Shelf Co" is no comparison); the number check does not.
    expect(checkInsights(fields, [ranking], { client: "Studio 54" })).toEqual([]);
  });

  it("still refuses a figure no fact holds beside such a name", () => {
    const fields: InsightFields = { kind: "competitive", summary: [{ text: "Studio 54 leads its rivals on engagement rate, at 4.5% against a median of 2.1%.", facts: ["F1"] }], gaps: [] };
    expect(checkInsights(fields, [ranking], { client: "Studio 54" })).toEqual(["Summary paragraph 1 writes 4.5%, which is not a number of the facts it cites."]);
  });
});
