// Compact view of a client's latest competitive analysis, embedded in the
// monthly social report and the analytics page so competitive insight lives
// where the team already works, not only behind its own sidebar entry.
// Reads competitive_reports through RLS: clients see complete reports for
// their own company; staff see everything. Gaps the team has voted down are
// hidden here too; endorsed gaps are listed first.

import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";
import { platformLabel } from "@/components/competitive/PostVisual";
import { insightKey, partitionGaps, useInsightFeedback, type InsightFeedbackRow } from "@/hooks/useInsightFeedback";
import { formatRange } from "@/lib/dateRange";
import { Clamp } from "@/components/ui/clamp";
import { Crosshair, ArrowRight, Lightbulb, ThumbsUp, Rss } from "lucide-react";

const pct = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(2)}%`);

function Tile({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={accent ? "glass-accent" : ""}>
      <CardContent className="pt-4 pb-4 space-y-2">
        <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-[28px] font-bold tracking-tight leading-none">{value}</p>
        {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
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
  const { rows: feedback, verdictFor } = useInsightFeedback(clientId);

  const { data: latest, isLoading } = useQuery({
    queryKey: ["competitive-latest", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, status, created_at, report_data, date_range_start, date_range_end")
        .eq("client_id", clientId)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  if (isLoading) return <Loading label="Loading competitive analysis" />;

  if (!latest) {
    return (
      <EmptyState
        icon={Crosshair}
        title="No competitive analysis yet"
        description={
          isMoburstStaff
            ? "Confirm a competitor set and run the RivalIQ analysis. Its results appear here and shape the next monthly report."
            : "Your account team has not run a competitive analysis for this period yet."
        }
        action={
          isMoburstStaff ? (
            <Button onClick={() => navigate(`/clients/${clientId}/competitive`)}>
              <Crosshair className="h-4 w-4 mr-2" /> Set up competitors
            </Button>
          ) : undefined
        }
      />
    );
  }

  const rd: any = latest.report_data || {};
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  const rivals = companies.filter((c) => !c.is_client && c.post_count > 0);
  const avg = (f: (c: any) => number) => (rivals.length ? rivals.reduce((s, c) => s + f(c), 0) / rivals.length : 0);
  const totalPosts = companies.reduce((s, c) => s + (c.post_count || 0), 0);
  const share = me && totalPosts ? Math.round((me.post_count / totalPosts) * 100) : null;
  const score = ai.benchmark_scorecard?.client_score;
  const { visible } = partitionGaps<any>(ai.gaps_for_client || [], feedback);
  const gaps = visible.slice(0, 3);
  const period = rd.period?.start ? formatRange(rd.period) : latest.date_range_start ? formatRange({ start: latest.date_range_start, end: latest.date_range_end }) : "";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-muted-foreground">
          {rivals.length} competitors{rd.landscape?.name ? ` · ${rd.landscape.name}` : ""}{period ? ` · ${period}` : ""} · analyzed {new Date(latest.created_at).toLocaleDateString()}
        </p>
        <div className="flex gap-2 flex-wrap">
          {isMoburstStaff && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${clientId}/competitive/feed`)}>
              <Rss className="h-4 w-4 mr-1" /> Latest competitor posts
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${clientId}/competitive/reports/${latest.id}`)}>
            Full competitive report <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      {me && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Tile accent label="Benchmark score" value={score != null ? `${score}` : "–"} sub="out of 100 against the set" />
          <Tile label="Share of voice" value={share == null ? "–" : `${share}%`} sub={`${me.post_count} of ${totalPosts} posts`} />
          <Tile label="Cadence" value={`${me.cadence_per_week}/wk`} sub={`set average ${avg((c) => c.cadence_per_week).toFixed(1)}/wk`} />
          <Tile label="Engagement rate" value={pct(me.engagement_rate_avg)} sub={`set average ${pct(avg((c) => c.engagement_rate_avg))}`} />
        </div>
      )}

      {ai.executive_summary && <Clamp text={ai.executive_summary} lines={3} className="text-[15px] leading-6" />}

      {Array.isArray(takeaways) && takeaways.length > 0 && (
        <div className="rounded-[12px] p-4 bg-[rgba(185,224,69,0.08)] border border-[rgba(185,224,69,0.25)] space-y-2">
          <p className="text-[12px] uppercase tracking-wider text-muted-foreground">What this report took from the competitors</p>
          <ol className="space-y-2">
            {takeaways.slice(0, 4).map((t, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-6">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground text-[12px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5" /> Gaps to fill</p>
          <div className="grid gap-3 md:grid-cols-3">
            {gaps.map((g, i) => (
              <div key={i} className="rounded-[12px] p-4 bg-[rgba(255,255,255,0.04)] space-y-2">
                <div className="flex gap-1.5 flex-wrap">
                  {g.platform && g.platform !== "all" && <Badge variant="outline" className="text-[11px]">{platformLabel(g.platform)}</Badge>}
                  {verdictFor(g.gap) === "up" && <Badge className="text-[11px] gap-1"><ThumbsUp className="h-3 w-3" /> in the calendar brief</Badge>}
                </div>
                <p className="text-[15px] leading-6 font-medium">{g.gap}</p>
                {g.suggested_play && <p className="text-[14px] leading-6 text-muted-foreground line-clamp-3">{g.suggested_play}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {ai.posting_time_insights?.empty_airtime && (
        <div className="space-y-1">
          <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Empty airtime</p>
          <Clamp text={ai.posting_time_insights.empty_airtime} lines={2} className="text-[14px] leading-6 text-muted-foreground" />
        </div>
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
  const rd: any = reportRow.report_data || {};
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  const rivals = companies.filter((c) => !c.is_client && c.post_count > 0);
  const totalPosts = companies.reduce((s, c) => s + (c.post_count || 0), 0);
  const rows = feedback || [];
  const verdict = new Map(rows.map((r) => [r.insight_key, r.verdict]));
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
    gaps: gaps.map((g: any) => ({ gap: g.gap, platform: g.platform || "all", suggested_play: g.suggested_play, endorsed: verdict.get(insightKey(g.gap)) === "up" })),
    endorsed_gaps: rows.filter((r) => r.verdict === "up").map((r) => r.gap_text || r.insight_key),
    suppressed_gaps: rows.filter((r) => r.verdict === "down").map((r) => r.gap_text || r.insight_key),
    winner_patterns: (ai.winner_teardown || []).map((w: any) => ({ competitor: w.competitor, pattern: w.pattern, example_post_urls: w.example_post_urls || [] })),
    posting_time: ai.posting_time_insights || null,
    recommended_schedule: ai.recommended_schedule || null,
  };
}
