// Renders one competitive_reports row (project step 11's in-app half).
//
// Open to client members for status='complete' rows via RLS, exactly like the
// social report view: the router does not guard this route, the policies do.
// The data shape is produced by the n8n workflow's Assemble Report Data node.

import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeft, Crosshair, ExternalLink, Gauge, Lightbulb, Clock, Trophy } from "lucide-react";

type Company = {
  company_id: string; name: string; url: string | null; is_client: boolean; in_confirmed_top3: boolean;
  post_count: number; cadence_per_week: number; engagement_avg: number; engagement_rate_avg: number;
  views_total: number; impressions_total: number;
  by_weekday: Record<string, number>; by_hour: Record<string, number>;
  top_hashtags: Array<{ key: string; count: number }>; media_type_mix: Array<{ key: string; count: number }>;
  channel_mix: Array<{ key: string; count: number }>;
  top_posts: Array<{ engagement: number; engagement_rate: number; views: number; text: string; url: string | null; created: string | null; media_type: string; channel: string }>;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i));

function HeatStrip({ counts, keys, labelEvery = 1 }: { counts: Record<string, number>; keys: string[]; labelEvery?: number }) {
  const max = Math.max(1, ...keys.map((k) => counts?.[k] || 0));
  return (
    <div className="flex gap-[2px]">
      {keys.map((k, i) => {
        const v = counts?.[k] || 0;
        return (
          <div key={k} className="flex flex-col items-center gap-0.5" title={`${k}: ${v}`}>
            <div className="h-4 w-4 rounded-sm" style={{ backgroundColor: `rgba(185,224,69,${v ? 0.15 + 0.85 * (v / max) : 0.06})` }} />
            {i % labelEvery === 0 && <span className="text-[9px] text-muted-foreground leading-none">{k}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function CompetitiveReportView() {
  const { id: clientId, reportId } = useParams();
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();

  const { data: report, isLoading } = useQuery({
    queryKey: ["competitive-report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase.from("competitive_reports").select("*").eq("id", reportId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!reportId,
  });

  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  if (isLoading) return <AppLayout title="Competitive Report"><Loading label="Loading report" /></AppLayout>;
  if (!report) {
    return (
      <AppLayout title="Competitive Report">
        <EmptyState icon={Crosshair} title="Report not available" description="It may still be running, or you may not have access to it." />
      </AppLayout>
    );
  }

  const rd: any = report.report_data || {};
  const ai = rd.ai_analysis || {};
  const companies: Company[] = rd.aggregates?.companies || [];
  const ordered = [...companies].sort((a, b) => Number(b.is_client) - Number(a.is_client) || b.post_count - a.post_count);
  const scorecard = ai.benchmark_scorecard;
  const period = rd.period || {};
  const title = `Competitive: ${client?.name || rd.aggregates?.client_name || ""}`;

  return (
    <AppLayout title={title}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => navigate(isMoburstStaff ? `/clients/${clientId}/competitive/run` : "/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Badge variant={report.status === "complete" ? "default" : report.status === "failed" ? "destructive" : "secondary"}>{report.status}</Badge>
            {period.start && <span className="text-sm text-muted-foreground">{period.start} → {period.end} ({period.days} days)</span>}
            {rd.landscape?.name && <span className="text-sm text-muted-foreground">RivalIQ landscape: {rd.landscape.name}</span>}
            {rd.totals?.posts_analyzed != null && <span className="text-sm text-muted-foreground">{rd.totals.posts_analyzed} posts analyzed</span>}
          </div>
          {report.gamma_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={report.gamma_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open deck</a>
            </Button>
          )}
        </div>

        {report.status === "failed" && (
          <Card><CardContent className="pt-6 text-sm text-destructive break-words">{String(rd.error || "The run failed before producing a report.")}</CardContent></Card>
        )}

        {rd.schema_note && <p className="text-xs text-amber-500">{rd.schema_note}</p>}

        {ai.executive_summary && (
          <Card>
            <CardHeader><CardTitle className="text-base">Executive summary</CardTitle></CardHeader>
            <CardContent className="text-sm leading-relaxed whitespace-pre-line">{ai.executive_summary}</CardContent>
          </Card>
        )}

        {scorecard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" /> Benchmark scorecard
                <Badge variant="secondary" className="ml-2 text-base">{scorecard.client_score}/100</Badge>
              </CardTitle>
              <CardDescription>Client versus the competitive set, per dimension.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(scorecard.dimensions || []).map((d: any, i: number) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-sm"><span className="font-medium">{d.dimension}</span><span className="text-muted-foreground">client {d.client} · set avg {d.competitor_avg}</span></div>
                  <div className="relative h-2 rounded bg-[rgba(255,255,255,0.06)]">
                    <div className="absolute left-0 top-0 h-2 rounded bg-[#b9e045]" style={{ width: `${Math.min(100, d.client || 0)}%` }} />
                    <div className="absolute top-[-3px] h-[14px] w-[2px] bg-white/70" style={{ left: `${Math.min(100, d.competitor_avg || 0)}%` }} title="competitor average" />
                  </div>
                  {d.note && <p className="text-xs text-muted-foreground">{d.note}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {ordered.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Share of voice and engagement</CardTitle><CardDescription>Aggregated from RivalIQ posts in the period.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr><th className="text-left py-1">Company</th><th className="text-right">Posts</th><th className="text-right">Per week</th><th className="text-right">Avg eng.</th><th className="text-right">Eng. rate</th><th className="text-right">Views</th><th className="text-left pl-4">Channels</th></tr>
                </thead>
                <tbody>
                  {ordered.map((c) => (
                    <tr key={c.company_id} className={c.is_client ? "bg-[rgba(185,224,69,0.08)]" : ""}>
                      <td className="py-1.5 font-medium">{c.name}{c.is_client && <Badge className="ml-2" variant="default">client</Badge>}{c.in_confirmed_top3 && <Badge className="ml-2" variant="secondary">top 3</Badge>}</td>
                      <td className="text-right">{c.post_count}</td>
                      <td className="text-right">{c.cadence_per_week}</td>
                      <td className="text-right">{c.engagement_avg}</td>
                      <td className="text-right">{(c.engagement_rate_avg * 100).toFixed(2)}%</td>
                      <td className="text-right">{c.views_total?.toLocaleString?.() ?? c.views_total}</td>
                      <td className="pl-4 text-xs text-muted-foreground">{(c.channel_mix || []).map((m) => `${m.key} ${m.count}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {ordered.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Posting times</CardTitle>
              <CardDescription>{ai.posting_time_insights?.summary || "When each company posts (UTC), by weekday and by hour."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ordered.map((c) => (
                <div key={c.company_id} className="space-y-1.5">
                  <div className="text-sm font-medium">{c.name}{c.is_client && <span className="text-[#b9e045] ml-2 text-xs">client</span>}</div>
                  <div className="flex flex-wrap gap-6">
                    <div><div className="text-[10px] text-muted-foreground mb-1">Weekday</div><HeatStrip counts={c.by_weekday} keys={WEEKDAYS} /></div>
                    <div><div className="text-[10px] text-muted-foreground mb-1">Hour (UTC)</div><HeatStrip counts={c.by_hour} keys={HOURS} labelEvery={3} /></div>
                  </div>
                </div>
              ))}
              {ai.posting_time_insights?.empty_airtime && (
                <p className="text-sm"><span className="font-medium">Empty airtime: </span>{ai.posting_time_insights.empty_airtime}</p>
              )}
            </CardContent>
          </Card>
        )}

        {Array.isArray(ai.competitor_breakdowns) && ai.competitor_breakdowns.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {ai.competitor_breakdowns.map((b: any, i: number) => (
              <Card key={i}>
                <CardHeader className="pb-2"><CardTitle className="text-base">{b.name}{b.is_client && <Badge className="ml-2">client</Badge>}</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1.5">
                  {[["Copy style", b.copy_style], ["Hashtags", b.hashtag_strategy], ["Frequency", b.posting_frequency], ["Design", b.design_look], ["Engagement", b.engagement_level], ["Content mix", b.content_type_mix]]
                    .filter(([, v]) => v)
                    .map(([k, v]) => <p key={k as string}><span className="text-muted-foreground">{k}: </span>{v as string}</p>)}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {Array.isArray(ai.winner_teardown) && ai.winner_teardown.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" /> Winner teardown</CardTitle><CardDescription>The shared pattern behind each competitor's best posts.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {ai.winner_teardown.map((w: any, i: number) => (
                <div key={i}><p className="font-medium">{w.competitor}: {w.pattern}</p><p className="text-muted-foreground">{w.evidence}</p></div>
              ))}
            </CardContent>
          </Card>
        )}

        {Array.isArray(ai.gaps_for_client) && ai.gaps_for_client.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4" /> Gaps and plays</CardTitle><CardDescription>Strategy leans; review before sharing with the client.</CardDescription></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {ai.gaps_for_client.map((g: any, i: number) => (
                <div key={i} className="space-y-1">
                  <p className="font-medium">{i + 1}. {g.gap}</p>
                  {g.why_it_matters && <p className="text-muted-foreground">{g.why_it_matters}</p>}
                  {g.suggested_play && <p><span className="text-[#b9e045]">Play: </span>{g.suggested_play}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {ordered.some((c) => c.top_posts?.length) && (
          <Card>
            <CardHeader><CardTitle className="text-base">Top posts</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {ordered.filter((c) => c.top_posts?.length).map((c) => (
                <div key={c.company_id}>
                  <div className="text-sm font-medium mb-1">{c.name}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {c.top_posts.slice(0, 4).map((p, i) => (
                      <div key={i} className="p-3 rounded-md bg-[rgba(255,255,255,0.04)] text-xs space-y-1">
                        <div className="flex justify-between text-muted-foreground"><span>{p.channel} · {p.media_type}</span><span>{p.engagement} eng.{p.views ? ` · ${p.views.toLocaleString()} views` : ""}</span></div>
                        <p className="line-clamp-3">{p.text || "(no caption)"}</p>
                        {p.url && <a className="underline underline-offset-2" href={p.url} target="_blank" rel="noreferrer">Open post</a>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
