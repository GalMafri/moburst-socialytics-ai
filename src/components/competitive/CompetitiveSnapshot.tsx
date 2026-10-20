// Compact view of a client's latest competitive analysis, embedded in the
// monthly social report and the analytics page so competitive insight lives
// where the team already works, not only behind its own sidebar entry.
// Reads competitive_reports through RLS: clients see complete reports for
// their own company; staff see everything. Gaps the team has voted down are
// hidden here too; endorsed gaps are listed first.

import { COMPARED_RATE_LABEL } from "@/lib/rateLabels";
import { useNavigate } from "react-router-dom";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";
import { Loading } from "@/components/ui/loading";
import { insightKey, partitionGaps, useInsightFeedback, type InsightFeedbackRow } from "@/hooks/useInsightFeedback";
import { firstRunSentence, formatDate, formatRange, platformName } from "@/lib/display";
import { useNextRun } from "@/lib/nextRun";
import { Prose } from "@/components/ui/prose";
import { InsightGrid } from "@/components/ui/insight-card";
import { Crosshair, ArrowRight, Lightbulb, ThumbsUp, Rss } from "lucide-react";
import { normalizedCompetitiveMetrics } from "@/lib/competitiveMetrics";
import { competitiveReportQuality, withCompetitiveEvidenceLimits } from "../../../supabase/functions/_shared/competitive/reportEvidence";
import { landscapeLabel } from "@/lib/competitiveStatus";
import { editedSuggestion } from "../../../supabase/functions/_shared/competitive/suggestionEdits";

const pct = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(2)}%`);
const whole = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : Math.round(n).toLocaleString());

function Tile({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return <StatCard label={label} value={value} sub={sub} accent={accent} />;
}

export function CompetitiveSnapshot({
  clientId,
  takeaways,
}: {
  clientId: string;
  /** competitive_takeaways written into the monthly report by the social workflow, if any */
  takeaways?: string[] | null;
}) {
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();
  const { rows: feedback, verdictFor, editFor } = useInsightFeedback(clientId);

  // Its own key: ReportView reads a different column set for its own summary,
  // and a shared key let whichever loaded first answer for both.
  // The newest analysis that passed its source checks. A run held back is
  // hidden behind the last ready one, as on every other competitive screen.
  const { data: latest, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["competitive-snapshot", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, status, created_at, report_data, date_range_start, date_range_end")
        .eq("client_id", clientId)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data || []).find((r) => competitiveReportQuality(r.report_data).ready) ?? null;
    },
    enabled: !!clientId,
  });
  const nextRun = useNextRun(clientId, "competitive", !isLoading && !latest);

  if (isLoading) return <Loading label="Loading competitive analysis" />;
  if (isError) return <LoadRetry context="The competitive analysis did not load" error={error} onRetry={() => refetch()} />;

  if (!latest) {
    // What exists: when the first analysis runs, if one is scheduled. Never a setup step.
    const first = firstRunSentence("competitive", nextRun.data);
    return first ? <EmptyState icon={Crosshair} title="No competitive analysis yet" description={first} /> : null;
  }
  const rd: any = withCompetitiveEvidenceLimits(normalizedCompetitiveMetrics(latest.report_data));
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  // Two different questions, and they used to share one answer. How many
  // competitors the analysis covers is every tracked company — the figure the
  // full report puts in its header — while an average is only meaningful over
  // the ones that actually posted. Counting the active subset in both places
  // made the snapshot say "3 competitors" and the report it links to say "4".
  const rivals = companies.filter((c) => !c.is_client);
  const active = rivals.filter((c) => c.post_count > 0);
  const avg = (f: (c: any) => number) => { const values = active.map(f).filter(n => typeof n === "number" && Number.isFinite(n)); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
  const totalPosts = companies.reduce((s, c) => s + (c.post_count || 0), 0);
  const share = me && totalPosts ? Math.round((me.post_count / totalPosts) * 100) : null;
  const { visible } = partitionGaps<any>(ai.gaps_for_client || [], feedback);
  const gaps = visible.slice(0, 3);
  const period = rd.period?.start ? formatRange(rd.period) : latest.date_range_start ? formatRange({ start: latest.date_range_start, end: latest.date_range_end }) : "";

  return (
    <div className="space-y-section">
      {/* What this is and where to go from it, in one line with its two
          links right after it. It was a second glass band under the
          section's own band, with the links at the far edge. */}
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        <p className="t-secondary">
          {rivals.length} competitors
          {/* The tracking setup's name is for staff, and stays out of an exported PDF. */}
          {isMoburstStaff && rd.landscape?.name ? <span data-print="hide">{` · ${landscapeLabel(rd.landscape.name)}`}</span> : null}
          {period ? ` · ${period}` : ""} · analyzed {formatDate(latest.created_at)}
        </p>
        <div className="flex gap-2 flex-wrap">
          {isMoburstStaff && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${clientId}/competitive/feed`)}>
              <Rss /> Latest competitor posts
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${clientId}/competitive/reports/${latest.id}`)}>
            Full competitive report <ArrowRight />
          </Button>
        </div>
      </div>

      {/* Ids so the page rail can jump here: this block is the whole
          Competitive tab on both the monthly report and Analytics. */}
      {me && (
        <div id="snapshot-numbers" className="scroll-mt-[156px]"><StatGrid>
          {/* Measured figures only, each against the competitors' average, as on the full report. */}
          <Tile accent label="Avg engagement" value={me.post_count ? whole(me.engagement_avg) : "–"} sub={`competitor average ${whole(avg((c) => c.engagement_avg))}`} />
          <Tile label="Share of voice" value={share == null ? "–" : `${share}%`} sub={`${me.post_count} of ${totalPosts} posts`} />
          <Tile label="Cadence" value={`${me.cadence_per_week}/wk`} sub={`competitor average ${(rivals.length ? (rivals.reduce((sum, c) => sum + c.cadence_per_week, 0) / rivals.length).toFixed(1) : "–")}/wk`} />
          {/* Engagements divided by impressions, the same definition for every company. No impressions figure, no tile. */}
          {me.engagement_rate_avg != null && <Tile label={COMPARED_RATE_LABEL} value={pct(me.engagement_rate_avg)} sub={avg((c) => c.engagement_rate_avg) == null ? "engagements per impression" : `competitor average ${pct(avg((c) => c.engagement_rate_avg))}`} />}
        </StatGrid></div>
      )}

      {ai.executive_summary && (
        <Card id="snapshot-summary" className="scroll-mt-[156px]"><CardContent className="pt-5"><Prose text={ai.executive_summary} /></CardContent></Card>
      )}

      {Array.isArray(takeaways) && takeaways.length > 0 && (
        <div id="snapshot-takeaways" className="glass glass-accent p-card space-y-3 scroll-mt-[156px]">
          <div>
            <h3 className="t-h3">How this report used the competitive picture</h3>
            <p className="t-secondary">Drawn from the latest competitor analysis.</p>
          </div>
          <InsightGrid items={takeaways} />
        </div>
      )}

      {gaps.length > 0 && (
        <Card id="snapshot-gaps" className="scroll-mt-[156px]"><CardContent className="pt-5 space-y-3">
          <p className="t-subhead flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5" /> Gaps to fill</p>
          <div className="grid gap-inner grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]">
            {gaps.map((g, i) => (
              <div key={i} className="glass-inner p-inner space-y-2">
                <div className="flex gap-1.5 flex-wrap">
                  {g.platform && g.platform !== "all" && <Badge variant="outline">{platformName(g.platform)}</Badge>}
                  {verdictFor(g.gap) === "up" && <Badge className="gap-1"><ThumbsUp className="h-3 w-3" /> in the calendar brief</Badge>}
                </div>
                <p className="t-body font-medium">{editedSuggestion(g, editFor(g.gap)).gap}</p>
                {editedSuggestion(g, editFor(g.gap)).suggested_play && <p className="t-body"><span className="text-[#b9e045] font-semibold">Play: </span>{editedSuggestion(g, editFor(g.gap)).suggested_play}</p>}
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      {ai.posting_time_insights?.empty_airtime && (
        <Card id="snapshot-airtime" className="scroll-mt-[156px]"><CardContent className="pt-5 space-y-1">
          <p className="t-subhead">Empty airtime</p>
          <Prose text={ai.posting_time_insights.empty_airtime} className="t-secondary" />
        </CardContent></Card>
      )}
    </div>
  );
}

/**
 * The compact block RunAnalysis sends to the social workflow so the monthly
 * report's synthesis knows the competitive picture. Kept small on purpose:
 * the prompt already carries Sprout + trend data. Team feedback is folded in:
 * down-voted gaps are removed and listed as suppressed, up-voted gaps are
 * listed as endorsed so the synthesis must address them.
 */
export function buildCompetitiveContext(
  reportRow: { created_at: string; report_data: unknown } | null | undefined,
  feedback?: InsightFeedbackRow[] | null,
) {
  if (!reportRow) return null;
  const rd: any = normalizedCompetitiveMetrics(reportRow.report_data);
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  const rivals = companies.filter((c) => !c.is_client && c.post_count > 0);
  const totalPosts = companies.reduce((s, c) => s + (c.post_count || 0), 0);
  const rows = feedback || [];
  const verdict = new Map(rows.map((r) => [r.insight_key, r.verdict]));
  const edits = new Map(rows.map((r) => [r.insight_key, r.edited]));
  const gaps = (ai.gaps_for_client || []).filter((g: any) => verdict.get(insightKey(g.gap)) !== "down");
  const channelSummary = (c: any) =>
    Object.entries(c.by_channel || {}).map(([channel, b]: [string, any]) => ({
      channel,
      post_count: b.post_count,
      cadence_per_week: b.cadence_per_week,
      engagement_rate_avg: b.engagement_rate_avg,
      impressions_avg: b.impressions_avg ?? null,
    }));
  return {
    analyzed_at: reportRow.created_at,
    landscape: rd.landscape?.name || null,
    period: rd.period || null,
    benchmark_score: ai.benchmark_scorecard?.client_score ?? null,
    benchmark_dimensions: (ai.benchmark_scorecard?.dimensions || []).map((d: any) => ({ dimension: d.dimension, client: d.client, competitor_avg: d.competitor_avg })),
    share_of_voice_pct: me && totalPosts ? Math.round((me.post_count / totalPosts) * 100) : null,
    client: me
      ? { cadence_per_week: me.cadence_per_week, engagement_rate_avg: me.engagement_rate_avg, channel_mix: me.channel_mix, by_channel: channelSummary(me) }
      : null,
    competitors: rivals.map((c) => ({
      name: c.name,
      cadence_per_week: c.cadence_per_week,
      engagement_rate_avg: c.engagement_rate_avg,
      channel_mix: c.channel_mix,
      by_channel: channelSummary(c),
      top_hashtags: (c.top_hashtags || []).slice(0, 5).map((h: any) => h.key),
    })),
    executive_summary: ai.executive_summary || null,
    gaps: gaps.map((g: any) => { const e = editedSuggestion(g, edits.get(insightKey(g.gap))); return { gap: e.gap, platform: g.platform || "all", suggested_play: e.suggested_play, endorsed: verdict.get(insightKey(g.gap)) === "up" }; }),
    endorsed_gaps: rows.filter((r) => r.verdict === "up").map((r) => r.edited?.gap || r.gap_text || r.insight_key),
    suppressed_gaps: rows.filter((r) => r.verdict === "down").map((r) => r.gap_text || r.insight_key),
    winner_patterns: (ai.winner_teardown || []).map((w: any) => ({ competitor: w.competitor, pattern: w.pattern, example_post_urls: w.example_post_urls || [] })),
    posting_time: ai.posting_time_insights || null,
    recommended_schedule: ai.recommended_schedule || null,
  };
}
