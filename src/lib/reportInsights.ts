// A report's insights as the screens show them (Lital, 3 Nov 2026; design
// docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 2).
// Facts are worked out in code and worded by one checked model call
// (supabase/functions/_shared/reports/insights.ts); the newest report_insights
// row of a report is shown in place of the model-written fields, which stay
// stored. Under each insight, a "Based on" line built in code gives the
// numbers it rests on. Fact ids never show. A report with no row (every
// report stored before go-live) shows its own fields as before.

import type { Fact } from "../../supabase/functions/_shared/reports/facts";
import type { Cited, Gap, InsightFields } from "../../supabase/functions/_shared/reports/insights";

export interface ReportInsightsRow {
  id: string;
  report_id: string;
  kind: "social" | "competitive";
  facts: Fact[];
  fields: InsightFields;
  source: "model" | "template";
  created_at: string;
}

export interface ShownInsight {
  text: string;
  /** The numbers it rests on, in words; empty when none of its facts is known. */
  basedOn: string;
}

/** A gap as the competitive screens list it; the team's verdict keys on its words (insightKey), as every gap's does. */
export interface ShownGap {
  gap: string;
  platform: string;
  why_it_matters: string;
  suggested_play: string;
  basedOn: string;
}

/** "Impressions 12,400 in October against 9,800 in September, +26.5%, from Sprout; LinkedIn 521 of 542 engagements, from Sprout" */
export function basedOn(facts: Fact[], ids: string[]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return ids.map((id) => byId.get(id)?.basis).filter((b): b is string => !!b).join("; ");
}

const shown = (facts: Fact[], c: Cited): ShownInsight => ({ text: c.text, basedOn: basedOn(facts, c.facts) });

/** The monthly report's summary, insights and recommendations; null for a field code had nothing for. */
export function socialInsights(row: ReportInsightsRow | null | undefined): { summary: ShownInsight | null; insights: ShownInsight[]; recommendations: ShownInsight[] | null } | null {
  if (!row || row.fields?.kind !== "social") return null;
  const f = row.fields;
  return {
    summary: f.summary ? shown(row.facts, f.summary) : null,
    insights: f.insights.map((c) => shown(row.facts, c)),
    recommendations: f.recommendations ? f.recommendations.map((c) => shown(row.facts, c)) : null,
  };
}

/** The competitive report's summary paragraphs and gaps; gaps are null when code had none to give. */
export function competitiveInsights(row: ReportInsightsRow | null | undefined): { summary: ShownInsight[]; gaps: ShownGap[] | null } | null {
  if (!row || row.fields?.kind !== "competitive") return null;
  return {
    summary: row.fields.summary.map((c) => shown(row.facts, c)),
    gaps: row.fields.gaps
      ? row.fields.gaps.map((g: Gap) => ({
        gap: g.gap, platform: g.platform, why_it_matters: g.why_it_matters, suggested_play: g.suggested_play, basedOn: basedOn(row.facts, g.facts),
      }))
      : null,
  };
}
