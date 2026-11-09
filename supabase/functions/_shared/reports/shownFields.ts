// supabase/functions/_shared/reports/shownFields.ts
//
// What a report shows, read one way by every reader (design
// docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, "Part 2 on
// today's main", point 3): the report screens, the snapshot, Analytics, the
// client overview, the social report's actions from competitors, the
// planner and ad-hoc posts (competitive/brief.ts), the monthly report's
// competitive context (payloads.ts), the weekly plan's findings and the
// Claude connector (socialytics-api).
//
// A report with an insights row (report_insights, its newest confirmed one)
// shows the insights' fields; one without shows its own, and so does any
// field the insights don't carry (the takeaways, a template's gaps). A
// competitive report is always read through withCompetitiveEvidenceLimits,
// insights included: a gap needs posts behind it on its platform, and a
// client with no posts gets the withheld summary and no gaps.
//
// Under each piece, what it rests on, built in code from the facts it
// cites ("Based on"). Fact ids never show; data vendors are named to staff
// only. The team's verdicts and edits apply after this, keyed by a gap's
// own words (insightKey), as on every other gap.
//
// Free of Deno and network imports: the screens import it too.

import { withCompetitiveEvidenceLimits } from "../competitive/reportEvidence.ts";
import { normalizedCompetitiveMetrics } from "../competitive/reportMetrics.ts";
import type { Fact, FactSource } from "./facts.ts";
import type { Cited, InsightFields } from "./insights.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export type ReportTable = "reports" | "competitive_reports";

/**
 * The columns a reader asks for: ones people may read (the migration's
 * column grant), never problems, the model or token counts, and never "*",
 * which a column grant refuses.
 */
export const SHOWN_INSIGHT_COLUMNS = "report_id, facts, fields, confirmed_at";

export interface ShownInsightsRow {
  report_id: string;
  facts: Fact[];
  fields: InsightFields;
  confirmed_at: string;
}

/** A piece of a report's text and what it rests on, in words ("" for a report's own text). */
export interface ShownText {
  text: string;
  basedOn: string;
}

/** A gap as the report shows it; `based_on` is what it rests on, for a gap from the insights. */
export interface ShownGap {
  gap: string;
  platform?: string;
  why_it_matters?: string;
  suggested_play?: string;
  based_on?: string;
  [key: string]: unknown;
}

/** A report's shown insights: its newest confirmed row, or null when it has none. Throws when they can't be read. */
export async function readShownInsights(db: Db, table: ReportTable, reportId: string | null | undefined): Promise<ShownInsightsRow | null> {
  if (!reportId) return null;
  const { data, error } = await db.from("report_insights").select(SHOWN_INSIGHT_COLUMNS)
    .eq("report_table", table).eq("report_id", reportId)
    .order("confirmed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the report's insights: ${error.message}`);
  return (data ?? null) as ShownInsightsRow | null;
}

const SOURCE_NAMES: Record<FactSource, string> = { sprout: "Sprout", rivaliq: "RivalIQ" };

/**
 * What a piece of text rests on: the basis of each fact it cites, in the
 * order cited, skipping an id it doesn't know. Staff also see where each
 * fact's figures come from; a client never does.
 */
export function basedOn(facts: Fact[] | null | undefined, ids: string[] | null | undefined, staff = false): string {
  const byId = new Map((facts ?? []).map((f) => [f.id, f]));
  return (ids ?? []).map((id) => byId.get(id)).filter((f): f is Fact => !!f?.basis)
    .map((f) => (staff && f.sources?.length ? `${f.basis}, from ${[...new Set(f.sources)].map((s) => SOURCE_NAMES[s] ?? s).join(" and ")}` : f.basis))
    .join("; ");
}

/** A report's own list as text: a string as it is, an object (an older report's {claim, evidence}) as its string values. */
const strings = (x: unknown): string[] => (Array.isArray(x)
  ? x.map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((t) => typeof t === "string").join(": ") : "")).filter((t) => !!t.trim())
  : []);
const own = (texts: string[]): ShownText[] => texts.map((text) => ({ text, basedOn: "" }));

export interface ShownSocial {
  /** The period's summary; null when neither the insights nor the report has one. */
  summary: ShownText | null;
  insights: ShownText[];
  recommendations: ShownText[];
  /** How the report answers the competitive picture: always the report's own (the insights carry none). */
  takeaways: string[];
  /** The report's analysis with the insights' fields in place, for a reader that passes it on whole. */
  analysis: Any | null;
}

/** A monthly report's summary, insights and recommendations as shown, from its analysis and its insights row. */
export function shownSocial(aiAnalysis: unknown, row: ShownInsightsRow | null | undefined, opts: { staff?: boolean } = {}): ShownSocial {
  const ai: Any = aiAnalysis && typeof aiAnalysis === "object" ? aiAnalysis : null;
  const perf: Any = ai?.sprout_performance_analysis ?? {};
  const fields = row?.fields?.kind === "social" ? row.fields : null;
  const word = (c: Cited): ShownText => ({ text: c.text, basedOn: basedOn(row?.facts, c.facts, opts.staff) });
  const ownSummary = typeof perf.month_over_month_summary === "string" && perf.month_over_month_summary.trim() ? perf.month_over_month_summary : null;
  const summary = fields?.summary?.text ? word(fields.summary) : ownSummary ? { text: ownSummary, basedOn: "" } : null;
  const insights = fields?.insights?.length ? fields.insights.map(word) : own(strings(perf.key_insights));
  const recommendations = fields?.recommendations ? fields.recommendations.map(word) : own(strings(perf.pillar_alignment?.recommendations));
  const analysis = ai && fields
    ? {
      ...ai,
      sprout_performance_analysis: {
        ...perf,
        ...(fields.summary?.text ? { month_over_month_summary: fields.summary.text } : {}),
        ...(fields.insights?.length ? { key_insights: insights.map((i) => i.text) } : {}),
        ...(fields.recommendations ? { pillar_alignment: { ...(perf.pillar_alignment ?? {}), recommendations: recommendations.map((r) => r.text) } } : {}),
      },
    }
    : ai;
  return { summary, insights, recommendations, takeaways: strings(ai?.competitive_takeaways), analysis };
}

export interface ShownCompetitive {
  /**
   * The report as every reader reads it: normalized, through the evidence
   * limits, with its summary and gaps the insights' where it has them.
   */
  report: Any;
  /** The summary as paragraphs, each with what it rests on; the report's own is one paragraph resting on nothing shown. */
  summary: ShownText[];
  /** The gaps shown (the report's ai_analysis.gaps_for_client), before the team's verdicts. */
  gaps: ShownGap[];
}

/** A competitive report as shown, from its stored data and its insights row. */
export function shownCompetitive(reportData: unknown, row: ShownInsightsRow | null | undefined, opts: { staff?: boolean } = {}): ShownCompetitive {
  const normalized: Any = normalizedCompetitiveMetrics(reportData);
  const fields = row?.fields?.kind === "competitive" ? row.fields : null;
  const paragraphs: ShownText[] = (fields?.summary ?? []).filter((c) => c?.text)
    .map((c) => ({ text: c.text, basedOn: basedOn(row?.facts, c.facts, opts.staff) }));
  const joined = paragraphs.map((p) => p.text).join("\n\n");
  const insightGaps: ShownGap[] | null = fields?.gaps
    ? fields.gaps.map((g) => ({ gap: g.gap, platform: g.platform, why_it_matters: g.why_it_matters, suggested_play: g.suggested_play, based_on: basedOn(row?.facts, g.facts, opts.staff) }))
    : null;
  const overlaid = fields && (joined || insightGaps)
    ? {
      ...normalized,
      ai_analysis: { ...(normalized.ai_analysis ?? {}), ...(joined ? { executive_summary: joined } : {}), ...(insightGaps ? { gaps_for_client: insightGaps } : {}) },
    }
    : normalized;
  // The insights' summary is worked out from the figures the report shows, so it
  // stands in place of the one the limits write from them; the limits still
  // withhold it when the client has no posts.
  const report: Any = withCompetitiveEvidenceLimits(overlaid, { keepSummary: !!joined });
  const ai: Any = report?.ai_analysis ?? {};
  const shownSummary = typeof ai.executive_summary === "string" ? ai.executive_summary : "";
  const summary = joined && shownSummary === joined ? paragraphs : shownSummary ? [{ text: shownSummary, basedOn: "" }] : [];
  const gaps: ShownGap[] = Array.isArray(ai.gaps_for_client) ? ai.gaps_for_client : [];
  return { report, summary, gaps };
}
