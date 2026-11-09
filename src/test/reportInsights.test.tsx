// Report insights on screen (Lital, 3 Nov 2026): a report's insights show
// with a "Based on" line built in code, never their fact ids; a report with
// none shows its own fields; a gap's verdict keys on its own words, as
// every other gap's does (insightKey). The reading itself is tested in
// supabase/tests/_shared/reports/shownFields.test.ts.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InsightGrid } from "@/components/ui/insight-card";
import { insightKey, partitionGaps, type InsightFeedbackRow } from "@/hooks/useInsightFeedback";
import { shownCompetitive, shownSocial, type ShownInsightsRow } from "../../supabase/functions/_shared/reports/shownFields";
import type { Fact } from "../../supabase/functions/_shared/reports/facts";

afterEach(cleanup);

const fact = (id: string, key: string, basis: string, sources: Fact["sources"]): Fact => ({ id, key, kind: "change", platform: "all", metric: "impressions", unit: "count", value: 1, score: 1, numbers: [1], sentence: "", basis, sources });
const FACTS = [
  fact("F1", "change|all|impressions|", "Impressions 12,400 in October against 9,800 in September, +26.5%", ["sprout"]),
  fact("F2", "ranking|all|compared_rate|Moburst", "Engagement rate compared on likes, comments and shares: Moburst 0.31%, Rival Co 2.1% (highest), median 0.6% across 3 companies", ["sprout", "rivaliq"]),
];
const row = (fields: ShownInsightsRow["fields"]): ShownInsightsRow => ({ report_id: "r1", facts: FACTS, fields, confirmed_at: "2026-11-09T11:00:00Z" });

describe("the report's insights on screen", () => {
  it("shows each insight with its Based on line and no fact ids or vendors to a client", () => {
    const shown = shownSocial({}, row({ kind: "social", summary: null, insights: [{ text: "Reach grew.", facts: ["F1", "F2"] }], recommendations: null }));
    render(<InsightGrid items={shown.insights.map((i) => i.text)} basedOn={shown.insights.map((i) => i.basedOn)} />);
    expect(screen.getByText(`Based on ${FACTS[0].basis}; ${FACTS[1].basis}.`)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bF\d\b|Sprout|Rival ?IQ/);
  });

  it("names the figures' source to staff", () => {
    const shown = shownSocial({}, row({ kind: "social", summary: null, insights: [{ text: "Reach grew.", facts: ["F2"] }], recommendations: null }), { staff: true });
    render(<InsightGrid items={shown.insights.map((i) => i.text)} basedOn={shown.insights.map((i) => i.basedOn)} />);
    expect(screen.getByText(`Based on ${FACTS[1].basis}, from Sprout and RivalIQ.`)).toBeInTheDocument();
  });

  it("shows a report's own insights with no Based on line", () => {
    const shown = shownSocial({ sprout_performance_analysis: { key_insights: ["An older insight."] } }, null);
    render(<InsightGrid items={shown.insights.map((i) => i.text)} basedOn={shown.insights.map((i) => i.basedOn)} />);
    expect(screen.getByText("An older insight.")).toBeInTheDocument();
    expect(screen.queryByText(/^Based on/)).not.toBeInTheDocument();
  });
});

describe("a gap's verdict", () => {
  const verdict = (key: string, v: "up" | "down"): InsightFeedbackRow => ({ id: key, client_id: "mob", insight_key: key, platform: null, gap_text: "x", verdict: v, report_id: null, user_id: null });

  it("keys a gap from the insights on its own words, as main keys every gap", () => {
    const { gaps } = shownCompetitive({ ai_analysis: {} }, row({ kind: "competitive", summary: [], gaps: [{ gap: "Rate trails the field", platform: "instagram", why_it_matters: "w", suggested_play: "s", facts: ["F2"] }] }));
    expect(partitionGaps(gaps, [verdict(insightKey("Rate trails the field"), "down")])).toEqual({ visible: [], hidden: gaps });
    expect(partitionGaps(gaps, [verdict("rate-trails-the-field", "up")]).visible).toEqual(gaps);
  });
});
