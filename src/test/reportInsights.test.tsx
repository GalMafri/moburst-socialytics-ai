// Report insights on screen (Lital, 3 Nov 2026): a report's insights show
// with a "Based on" line built in code, never their fact ids; a report with
// none shows its own fields; a gap's verdict keys on its own words, as
// every other gap's does (insightKey).
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InsightGrid } from "@/components/ui/insight-card";
import { insightKey, partitionGaps, type InsightFeedbackRow } from "@/hooks/useInsightFeedback";
import { basedOn, competitiveInsights, socialInsights, type ReportInsightsRow } from "@/lib/reportInsights";
import type { Fact } from "../../supabase/functions/_shared/reports/facts";

afterEach(cleanup);

const fact = (id: string, key: string, basis: string): Fact => ({ id, key, kind: "change", platform: "all", metric: "impressions", unit: "count", value: 1, score: 1, numbers: [1], sentence: "", basis, sources: ["sprout"] });
const FACTS = [
  fact("F1", "change|all|impressions|", "Impressions 12,400 in October against 9,800 in September, +26.5%, from Sprout"),
  fact("F2", "ranking|all|compared_rate|Moburst", "Engagement rate compared on likes, comments and shares: Moburst 0.31%, Rival Co 2.1% (highest), median 0.6% across 3 companies, from Sprout and RivalIQ"),
  fact("F3", "share|LinkedIn|engagements|", "LinkedIn 521 of 542 engagements, from Sprout"),
];
const row = (fields: ReportInsightsRow["fields"]): ReportInsightsRow => ({ id: "i1", report_id: "r1", kind: fields.kind, facts: FACTS, fields, source: "model", created_at: "2026-11-09T11:00:00Z" });

describe("the report's insights", () => {
  it("joins the cited facts' basis lines, in the order cited, and skips an id it doesn't know", () => {
    expect(basedOn(FACTS, ["F3", "F9", "F1"])).toBe("LinkedIn 521 of 542 engagements, from Sprout; Impressions 12,400 in October against 9,800 in September, +26.5%, from Sprout");
  });

  it("gives the monthly report's summary, insights and recommendations with their Based on lines, and nothing without a row", () => {
    const view = socialInsights(row({ kind: "social", summary: { text: "Reach grew.", facts: ["F1"] }, insights: [{ text: "LinkedIn leads.", facts: ["F3"] }], recommendations: null }))!;
    expect(view.summary).toEqual({ text: "Reach grew.", basedOn: FACTS[0].basis });
    expect(view.insights).toEqual([{ text: "LinkedIn leads.", basedOn: FACTS[2].basis }]);
    // Code wrote no recommendations: the report's own stay on screen.
    expect(view.recommendations).toBeNull();
    expect(socialInsights(null)).toBeNull();
    expect(competitiveInsights(row({ kind: "social", summary: null, insights: [], recommendations: [] }))).toBeNull();
  });

  it("gives a competitive gap what it rests on, and no fact ids or keys", () => {
    const view = competitiveInsights(row({ kind: "competitive", summary: [{ text: "Moburst trails on rate.", facts: ["F2"] }], gaps: [{ gap: "Rate trails", platform: "instagram", why_it_matters: "It does.", suggested_play: "Test Reels.", facts: ["F3", "F2"] }] }))!;
    expect(view.gaps![0]).toEqual({ gap: "Rate trails", platform: "instagram", why_it_matters: "It does.", suggested_play: "Test Reels.", basedOn: `${FACTS[2].basis}; ${FACTS[1].basis}` });
    expect(view.summary[0].basedOn).toBe(FACTS[1].basis);
  });

  it("shows each insight with its Based on line and no fact ids", () => {
    render(<InsightGrid items={["LinkedIn leads the account."]} basedOn={[FACTS[2].basis]} />);
    expect(screen.getByText(`Based on ${FACTS[2].basis}.`)).toBeInTheDocument();
    expect(screen.queryByText(/\bF\d\b/)).not.toBeInTheDocument();
    cleanup();
    render(<InsightGrid items={["An older insight."]} />);
    expect(screen.queryByText(/^Based on/)).not.toBeInTheDocument();
  });
});

describe("a gap's verdict", () => {
  const verdict = (key: string, v: "up" | "down"): InsightFeedbackRow => ({ id: key, client_id: "mob", insight_key: key, platform: null, gap_text: "x", verdict: v, report_id: null, user_id: null });

  it("keys a gap from the insights on its own words, as main keys every gap", () => {
    const gap = { gap: "Rate trails the field", platform: "instagram" };
    expect(partitionGaps([gap], [verdict(insightKey(gap.gap), "down")])).toEqual({ visible: [], hidden: [gap] });
    expect(partitionGaps([gap], [verdict("rate-trails-the-field", "up")]).visible).toEqual([gap]);
  });
});
