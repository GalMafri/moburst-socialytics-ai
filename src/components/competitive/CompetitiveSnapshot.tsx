// Compact view of a client's latest competitive analysis, embedded in the
// monthly social report and the analytics page so competitive insight lives
// where the team already works, not only behind its own sidebar entry.
// Reads competitive_reports through RLS: clients see complete reports for
// their own company; staff see everything.

import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";
import { Crosshair, ArrowRight, Lightbulb, Clock } from "lucide-react";

const pct = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(2)}%`);

function Tile({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={accent ? "glass-accent" : ""}>
      <CardContent className="pt-4 pb-3">
        <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tracking-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
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
            ? "Confirm a competitor set and run the RivalIQ analysis; its results will appear here and inform the next monthly report."
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
  const gaps: any[] = (ai.gaps_for_client || []).slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
          <Badge>competitive</Badge>
          {rd.landscape?.name && <span>RivalIQ · {rd.landscape.name}</span>}
          {rd.period?.start && <span>{rd.period.start} → {rd.period.end}</span>}
          <span>{rivals.length} competitors</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${clientId}/competitive/reports/${latest.id}`)}>
          Full competitive report <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {me && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Tile accent label="Benchmark score" value={score != null ? `${score}` : "–"} sub="out of 100" />
          <Tile label="Share of voice" value={share == null ? "–" : `${share}%`} sub={`${me.post_count} of ${totalPosts} posts`} />
          <Tile label="Cadence" value={`${me.cadence_per_week}/wk`} sub={`set avg ${avg((c) => c.cadence_per_week).toFixed(1)}/wk`} />
          <Tile label="Engagement rate" value={pct(me.engagement_rate_avg)} sub={`set avg ${pct(avg((c) => c.engagement_rate_avg))}`} />
        </div>
      )}

      {Array.isArray(takeaways) && takeaways.length > 0 && (
        <Card className="glass-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">How this report used the competitive picture</CardTitle>
            <CardDescription>Written by the report synthesis with the competitor analysis in hand.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {takeaways.map((t, i) => (
              <div key={i} className="flex gap-3 text-[15px] leading-6">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <p>{t}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {ai.executive_summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Where {me?.name || "the client"} stands</CardTitle></CardHeader>
          <CardContent className="text-[15px] leading-7">{ai.executive_summary}</CardContent>
        </Card>
      )}

      {gaps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4" /> Top gaps to fill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {gaps.map((g, i) => (
              <div key={i} className="flex gap-3">
                <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <div>
                  <p className="font-medium leading-snug">{g.gap}</p>
                  {g.suggested_play && <p className="text-sm text-muted-foreground mt-0.5"><span className="text-[#b9e045]">Play: </span>{g.suggested_play}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {ai.posting_time_insights?.empty_airtime && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Empty airtime</CardTitle></CardHeader>
          <CardContent className="text-[15px] leading-6">{ai.posting_time_insights.empty_airtime}</CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * The compact block RunAnalysis sends to the social workflow so the monthly
 * report's synthesis knows the competitive picture. Kept small on purpose:
 * the prompt already carries Sprout + trend data.
 */
export function buildCompetitiveContext(reportRow: { created_at: string; report_data: unknown } | null | undefined) {
  if (!reportRow) return null;
  const rd: any = reportRow.report_data || {};
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  const rivals = companies.filter((c) => !c.is_client && c.post_count > 0);
  const totalPosts = companies.reduce((s, c) => s + (c.post_count || 0), 0);
  return {
    analyzed_at: reportRow.created_at,
    landscape: rd.landscape?.name || null,
    period: rd.period || null,
    benchmark_score: ai.benchmark_scorecard?.client_score ?? null,
    benchmark_dimensions: (ai.benchmark_scorecard?.dimensions || []).map((d: any) => ({ dimension: d.dimension, client: d.client, competitor_avg: d.competitor_avg })),
    share_of_voice_pct: me && totalPosts ? Math.round((me.post_count / totalPosts) * 100) : null,
    client: me ? { cadence_per_week: me.cadence_per_week, engagement_rate_avg: me.engagement_rate_avg, channel_mix: me.channel_mix } : null,
    competitors: rivals.map((c) => ({ name: c.name, cadence_per_week: c.cadence_per_week, engagement_rate_avg: c.engagement_rate_avg, channel_mix: c.channel_mix, top_hashtags: (c.top_hashtags || []).slice(0, 5).map((h: any) => h.key) })),
    executive_summary: ai.executive_summary || null,
    gaps: (ai.gaps_for_client || []).map((g: any) => ({ gap: g.gap, suggested_play: g.suggested_play })),
    winner_patterns: (ai.winner_teardown || []).map((w: any) => ({ competitor: w.competitor, pattern: w.pattern })),
    posting_time: ai.posting_time_insights || null,
  };
}
