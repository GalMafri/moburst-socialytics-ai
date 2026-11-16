// One reading of a report (design part 2, "Part 2 on today's main", point
// 3): its insights' fields where it has an insights row, its own fields
// otherwise, field by field, and a competitive report always through the
// evidence limits. Every reader (screens, planner, briefs, payloads, the
// connector) reads through these.

import { describe, expect, it, vi } from "vitest";
import type { Fact } from "../../../functions/_shared/reports/facts";
import type { InsightFields } from "../../../functions/_shared/reports/insights";
import { withCompetitiveEvidenceLimits } from "../../../functions/_shared/competitive/reportEvidence";
import { normalizedCompetitiveMetrics } from "../../../functions/_shared/competitive/reportMetrics";
import {
  basedOn, readShownInsights, SHOWN_INSIGHT_COLUMNS, shownCompetitive, shownSocial, type ShownInsightsRow,
} from "../../../functions/_shared/reports/shownFields";

const fact = (over: Partial<Fact>): Fact => ({
  id: "F1", key: "change|all|impressions|", kind: "change", platform: "all", metric: "impressions", unit: "count", value: 12400, previous: 9800, change: 2600, percent: 26.5,
  score: 2.6, numbers: [12400, 9800, 2600, 26.5], sentence: "Impressions rose 26.5% to 12,400.", basis: "Impressions 12,400 in October against 9,800 in September, +26.5%", sources: ["sprout"], ...over,
});
const FACTS: Fact[] = [
  fact({}),
  fact({ id: "F2", key: "ranking|all|followers|Moburst", kind: "ranking", metric: "followers", company: "Moburst", value: 14900, rank: 2, of: 2, leader: "Rival Co", leaderValue: 680000, numbers: [14900, 680000, 347450, 2, 2], basis: "Followers: Moburst 14,900, Rival Co 680,000 (highest), median 347,450 across 2 companies", sources: ["sprout", "rivaliq"] }),
];
const row = (fields: InsightFields): ShownInsightsRow => ({ report_id: "r1", facts: FACTS, fields, confirmed_at: "2026-11-09T11:00:00Z" });

describe("readShownInsights", () => {
  /** A supabase-js stand-in that records the one query and answers with `rows`. */
  function recording(rows: unknown[], error: { message: string } | null = null) {
    const calls: Array<[string, ...unknown[]]> = [];
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const op of ["select", "eq", "in", "order", "limit"]) q[op] = (...a: unknown[]) => { calls.push([op, ...a]); return q; };
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error });
    return { db: { from: (t: string) => { calls.push(["from", t]); return q; } }, calls };
  }

  it("reads the report's newest confirmed row, by the shown columns only", async () => {
    const { db, calls } = recording([{ report_id: "r1", facts: [], fields: { kind: "social" }, confirmed_at: "x" }]);
    expect(await readShownInsights(db, "reports", "r1")).toMatchObject({ report_id: "r1" });
    expect(calls).toEqual([
      ["from", "report_insights"], ["select", SHOWN_INSIGHT_COLUMNS], ["eq", "report_table", "reports"], ["eq", "report_id", "r1"],
      ["order", "confirmed_at", { ascending: false }], ["limit", 1],
    ]);
    // Explicit columns a person may read (the migration's column grant), never * or what is the service role's.
    expect(SHOWN_INSIGHT_COLUMNS).not.toMatch(/\*|problems|model|tokens/);
  });

  it("is null for a report with none or no id", async () => {
    expect(await readShownInsights(recording([]).db, "competitive_reports", "r1")).toBeNull();
    expect(await readShownInsights(recording([]).db, "reports", null)).toBeNull();
  });

  it("never fails its reader: insights that can't be read are warned about and read as none, so the report's own fields show", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readShownInsights(recording([], { message: "permission denied" }).db, "reports", "r1")).toBeNull();
    const throwing = { from: () => { throw new Error("relation report_insights does not exist"); } };
    expect(await readShownInsights(throwing, "competitive_reports", "r1")).toBeNull();
    expect(warn.mock.calls.map((c) => c.join(" "))).toEqual([
      expect.stringMatching(/report insights.*permission denied/), expect.stringMatching(/report insights.*does not exist/),
    ]);
    warn.mockRestore();
  });
});

describe("basedOn", () => {
  it("joins the cited facts' basis in the order cited, names no vendor to a client, and names the source to staff", () => {
    expect(basedOn(FACTS, ["F2", "F9", "F1"])).toBe(`${FACTS[1].basis}; ${FACTS[0].basis}`);
    expect(basedOn(FACTS, ["F2", "F1"])).not.toMatch(/Sprout|Rival ?IQ/);
    expect(basedOn(FACTS, ["F2", "F1"], true)).toBe(`${FACTS[1].basis}, from Sprout and RivalIQ; ${FACTS[0].basis}, from Sprout`);
  });
});

describe("shownSocial", () => {
  const ai = {
    sprout_performance_analysis: { month_over_month_summary: "The model's summary.", key_insights: ["The model's insight."], pillar_alignment: { recommendations: ["The model's recommendation."], well_represented: ["A"] } },
    competitive_takeaways: ["Rival Co posts daily."],
    content_recommendations: [{ platform: "Instagram" }],
  };

  it("reads the insights' fields where the row has them and the report's own otherwise, field by field", () => {
    const shown = shownSocial(ai, row({ kind: "social", summary: { text: "Reach grew.", facts: ["F1"] }, insights: [{ text: "Impressions rose 26.5%.", facts: ["F1"] }], recommendations: null }));
    expect(shown.summary).toEqual({ text: "Reach grew.", basedOn: FACTS[0].basis });
    expect(shown.insights).toEqual([{ text: "Impressions rose 26.5%.", basedOn: FACTS[0].basis }]);
    // Code wrote no recommendations, and the insights carry no takeaways: the report's own stay.
    expect(shown.recommendations).toEqual([{ text: "The model's recommendation.", basedOn: "" }]);
    expect(shown.takeaways).toEqual(["Rival Co posts daily."]);
    expect(shown.analysis).toEqual({
      ...ai,
      sprout_performance_analysis: { ...ai.sprout_performance_analysis, month_over_month_summary: "Reach grew.", key_insights: ["Impressions rose 26.5%."] },
    });
  });

  it("is the report's own without a row, or with a competitive one", () => {
    for (const r of [null, row({ kind: "competitive", summary: [], gaps: null })]) {
      const shown = shownSocial(ai, r);
      expect(shown.summary).toEqual({ text: "The model's summary.", basedOn: "" });
      expect(shown.insights.map((i) => i.text)).toEqual(["The model's insight."]);
      expect(shown.analysis).toEqual(ai);
    }
    expect(shownSocial(null, null)).toEqual({ summary: null, insights: [], recommendations: [], takeaways: [], analysis: null });
  });

  it("names the source to staff only", () => {
    const fields: InsightFields = { kind: "social", summary: null, insights: [{ text: "Moburst trails on followers.", facts: ["F2"] }], recommendations: [] };
    expect(shownSocial(ai, row(fields)).insights[0].basedOn).not.toMatch(/Sprout|Rival ?IQ/);
    expect(shownSocial(ai, row(fields), { staff: true }).insights[0].basedOn).toContain("from Sprout and RivalIQ");
  });
});

/** A competitive report the evidence limits act on (metric_semantics_version 4): both companies posted on Instagram only. */
function competitive(clientPosts = 6) {
  const company = (name: string, is_client: boolean, posts: number) => ({
    name, is_client, post_count: posts, observed_post_count: posts,
    rivaliq_metrics: { posts: { current: posts, previous: 5 }, by_network: { instagram: { posts: { current: posts, previous: 5 } } } },
    by_channel: { instagram: { post_count: posts, observed_post_count: posts, top_posts: [] } },
  });
  return {
    period: { start: "2026-10-01", end: "2026-10-31" },
    aggregates: { metric_semantics_version: 4, period: { start: "2026-10-01", end: "2026-10-31", days: 31 }, companies: [company("Moburst", true, clientPosts), company("Rival Co", false, 9)] },
    ai_analysis: {
      executive_summary: "The model's summary.",
      gaps_for_client: [{ gap: "The model's gap", platform: "instagram", why_it_matters: "w", suggested_play: "s" }, { gap: "A TikTok gap", platform: "tiktok", why_it_matters: "w", suggested_play: "s" }],
      winner_teardown: [{ competitor: "Rival Co", pattern: "Daily Reels" }],
    },
  };
}
const INSIGHTS: InsightFields = {
  kind: "competitive",
  summary: [{ text: "Moburst ranks 2nd of 2 on followers.", facts: ["F2"] }, { text: "Impressions rose 26.5%.", facts: ["F1"] }],
  gaps: [
    { gap: "Followers trail the field", platform: "instagram", why_it_matters: "Rival Co has 680,000.", suggested_play: "Test weekly Reels.", facts: ["F2"] },
    { gap: "No TikTok yet", platform: "tiktok", why_it_matters: "Rival Co leads.", suggested_play: "Test TikTok.", facts: ["F2"] },
  ],
};

describe("shownCompetitive names no data vendor in the narrative, for every reader", () => {
  const withVendors = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report: any = competitive();
    report.ai_analysis = {
      ...report.ai_analysis,
      executive_summary: "Cadence: RivalIQ's totals show 12 posts a week.\n\nReach: captured as actual via Sprout.",
      competitor_breakdowns: [{ name: "Sprout Social", is_client: false, copy_style: "Short hooks.", platform_notes: [{ platform: "instagram", note: "Captured as actual via Sprout." }] }],
      recommended_schedule: { by_weekday: { Mon: 1 }, by_hour: { "12": 1 }, rationale: "RivalIQ shows a midday gap." },
      gaps_for_client: [{ gap: "Weekly Reels", platform: "instagram", why_it_matters: "Per Sprout, Reels lead.", suggested_play: "Post one a week." }],
    };
    return report;
  };
  const strings = (x: unknown): string[] => (typeof x === "string" ? [x] : x && typeof x === "object" ? Object.entries(x).filter(([k]) => k !== "name" && k !== "based_on").flatMap(([, v]) => strings(v)) : []);

  it("replaces the names in every narrative string of ai_analysis, for staff and clients", () => {
    for (const staff of [false, true]) {
      const shown = shownCompetitive(withVendors(), null, { staff });
      const text = strings(shown.report.ai_analysis).join("\n");
      expect(text).not.toMatch(/RivalIQ|Rival IQ|Sprout/);
      expect(shown.report.ai_analysis.competitor_breakdowns[0].platform_notes[0].note).toBe("Captured as actual via the data source.");
      expect(shown.report.ai_analysis.recommended_schedule.rationale).toBe("The data source shows a midday gap.");
      expect(shown.gaps[0].why_it_matters).toBe("Per the data source, Reels lead.");
      // A company's own name is a name, not a source.
      expect(shown.report.ai_analysis.competitor_breakdowns[0].name).toBe("Sprout Social");
    }
  });

  it("reads a report's own summary with no vendor named, as one paragraph", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report: any = withVendors();
    delete report.aggregates.metric_semantics_version;
    const shown = shownCompetitive(report, null);
    expect(shown.summary[0].text).toContain("The data source's totals show 12 posts a week.");
    expect(shown.summary[0].text).not.toMatch(/RivalIQ|Sprout/);
  });

  it("keeps what staff are told a figure rests on", () => {
    expect(shownCompetitive(competitive(), row(INSIGHTS), { staff: true }).gaps[0].based_on).toContain("Sprout and RivalIQ");
  });

  it("leaves the ordinary word 'sprout' alone and a competitor called Sprout Social named in prose", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report: any = competitive();
    report.aggregates.companies.push({ name: "Sprout Social", is_client: false, post_count: 3, observed_post_count: 3 });
    report.ai_analysis = { ...report.ai_analysis, recommended_schedule: { by_weekday: { Mon: 1 }, by_hour: { "12": 1 }, rationale: "Ideas sprout in comments.\n\nSprout Social posts daily, and RivalIQ shows it." } };
    const text = shownCompetitive(report, null).report.ai_analysis.recommended_schedule.rationale;
    expect(text).toContain("Ideas sprout in comments.");
    expect(text).toContain("Sprout Social posts daily, and the data source shows it.");
  });

  it("names no vendor however the writer spells it", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report: any = competitive();
    report.ai_analysis = { ...report.ai_analysis, recommended_schedule: { by_weekday: { Mon: 1 }, by_hour: { "12": 1 }, rationale: "Rivaliq shows it.\n\nPer rivalIQ and RivalIq, and sprout social, Reels lead. Ideas sprout in comments." } };
    const text = shownCompetitive(report, null).report.ai_analysis.recommended_schedule.rationale;
    expect(text).not.toMatch(/rival ?iq|sprout social/i);
    expect(text).toContain("Ideas sprout in comments.");
  });

  it("cleans the summary paragraphs taken from an older insights row", () => {
    const old: InsightFields = { kind: "competitive", summary: [{ text: "RivalIQ shows Moburst ranks 2nd of 2 on followers.", facts: ["F2"] }], gaps: null };
    const shown = shownCompetitive(competitive(), row(old));
    expect(shown.summary.map((p) => p.text).join(" ")).not.toMatch(/RivalIQ|Rival IQ|Sprout/);
    expect(shown.summary[0].text).toBe("The data source shows Moburst ranks 2nd of 2 on followers.");
  });
});

describe("shownCompetitive", () => {
  it("is main's reading of the report without a row: normalized, through the evidence limits", () => {
    const shown = shownCompetitive(competitive(), null);
    expect(shown.report).toEqual(withCompetitiveEvidenceLimits(normalizedCompetitiveMetrics(competitive())));
    expect(shown.gaps.map((g) => g.gap)).toEqual(["The model's gap"]);
    expect(shown.summary).toEqual([{ text: shown.report.ai_analysis.executive_summary, basedOn: "" }]);
  });

  it("shows the insights' summary and gaps, each with what it rests on, still through the evidence limits", () => {
    const shown = shownCompetitive(competitive(), row(INSIGHTS));
    expect(shown.summary).toEqual([{ text: "Moburst ranks 2nd of 2 on followers.", basedOn: FACTS[1].basis }, { text: "Impressions rose 26.5%.", basedOn: FACTS[0].basis }]);
    // The TikTok gap has no TikTok posts behind it: the limits drop it, as they drop the model's.
    expect(shown.gaps).toEqual([{ gap: "Followers trail the field", platform: "instagram", why_it_matters: "Rival Co has 680,000.", suggested_play: "Test weekly Reels.", based_on: FACTS[1].basis }]);
    expect(shown.report.ai_analysis.gaps_for_client).toEqual(shown.gaps);
    expect(shown.report.ai_analysis.executive_summary).toBe("Moburst ranks 2nd of 2 on followers.\n\nImpressions rose 26.5%.");
    // Fields the insights don't carry stay the report's own.
    expect(shown.report.ai_analysis.winner_teardown).toEqual([{ competitor: "Rival Co", pattern: "Daily Reels" }]);
    expect(JSON.stringify(shown)).not.toMatch(/"F\d+"/);
    expect(shownCompetitive(competitive(), row(INSIGHTS), { staff: true }).gaps[0].based_on).toBe(`${FACTS[1].basis}, from Sprout and RivalIQ`);
  });

  it("keeps the report's own gaps where the insights have none (the facts in code's words)", () => {
    const shown = shownCompetitive(competitive(), row({ ...INSIGHTS, gaps: null }));
    expect(shown.gaps.map((g) => g.gap)).toEqual(["The model's gap"]);
    expect(shown.summary[0].text).toBe("Moburst ranks 2nd of 2 on followers.");
  });

  it("withholds the summary and every gap when the client has no posts, insights or not", () => {
    const shown = shownCompetitive(competitive(0), row(INSIGHTS));
    expect(shown.gaps).toEqual([]);
    expect(shown.summary).toEqual([{ text: expect.stringMatching(/^No posts for Moburst were returned/), basedOn: "" }]);
  });
});
