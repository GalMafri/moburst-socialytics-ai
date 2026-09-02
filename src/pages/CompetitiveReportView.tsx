// Renders one competitive_reports row (project step 11's in-app half).
//
// Open to client members for status='complete' rows via RLS, exactly like the
// social report view: the router does not guard this route, the policies do.
// The data shape is produced by the n8n workflow's Assemble Report Data node.
// Visual language follows ReportView: hero header, big-number KPI tiles,
// numbered recommendation cards, chips — not tables.

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
import { ArrowLeft, Crosshair, ExternalLink, Gauge, Lightbulb, Clock, Trophy, Hash, Layers } from "lucide-react";

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
const ACCENT = "185,224,69";

const fmt = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(2)}%`);

function HeatStrip({ counts, keys, labelEvery = 1, size = "h-6 w-6" }: { counts: Record<string, number>; keys: string[]; labelEvery?: number; size?: string }) {
  const max = Math.max(1, ...keys.map((k) => counts?.[k] || 0));
  return (
    <div className="flex gap-[3px]">
      {keys.map((k, i) => {
        const v = counts?.[k] || 0;
        return (
          <div key={k} className="flex flex-col items-center gap-1" title={`${k}: ${v} post${v === 1 ? "" : "s"}`}>
            <div className={`${size} rounded-[6px]`} style={{ backgroundColor: `rgba(${ACCENT},${v ? 0.18 + 0.82 * (v / max) : 0.06})` }} />
            {i % labelEvery === 0 && <span className="text-[11px] text-muted-foreground leading-none">{k}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={accent ? "glass-accent" : ""}>
      <CardContent className="pt-5 pb-4">
        <p className="text-[13px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold tracking-tight mt-1">{value}</p>
        {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[rgba(255,255,255,0.06)] text-[13px]">{children}</span>;
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
  const me = companies.find((c) => c.is_client) || null;
  const rivals = companies.filter((c) => !c.is_client).sort((a, b) => b.post_count - a.post_count);
  const withPosts = rivals.filter((c) => c.post_count > 0);
  const avg = (f: (c: Company) => number) => (withPosts.length ? withPosts.reduce((s, c) => s + f(c), 0) / withPosts.length : 0);
  const totalPosts = companies.reduce((s, c) => s + c.post_count, 0);
  const shareOfVoice = me && totalPosts ? (me.post_count / totalPosts) * 100 : null;
  const scorecard = ai.benchmark_scorecard;
  const period = rd.period || {};
  const clientName = client?.name || rd.aggregates?.client_name || "Client";

  return (
    <AppLayout title={`Competitive: ${clientName}`}>
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Hero */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(isMoburstStaff ? `/clients/${clientId}/competitive/run` : "/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <h2 className="text-3xl font-bold tracking-tight">{clientName} vs. the field</h2>
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              <Badge variant={report.status === "complete" ? "default" : report.status === "failed" ? "destructive" : "secondary"}>{report.status}</Badge>
              {period.start && <Chip>{period.start} → {period.end} · {period.days} days</Chip>}
              {rd.landscape?.name && <Chip>RivalIQ · {rd.landscape.name}</Chip>}
              {rivals.length > 0 && <Chip>{rivals.length} competitors</Chip>}
            </div>
          </div>
          {report.gamma_url && (
            <Button variant="outline" asChild>
              <a href={report.gamma_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-2" /> Open deck</a>
            </Button>
          )}
        </div>

        {report.status === "failed" && (
          <Card><CardContent className="pt-6 text-destructive break-words">{String(rd.error || "The run failed before producing a report.")}</CardContent></Card>
        )}

        {/* KPI tiles */}
        {me && (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
            <Kpi accent label="Benchmark score" value={scorecard ? `${scorecard.client_score}` : "–"} sub="out of 100 vs. the set" />
            <Kpi label="Share of voice" value={shareOfVoice == null ? "–" : `${shareOfVoice.toFixed(0)}%`} sub={`${me.post_count} of ${totalPosts} posts`} />
            <Kpi label="Cadence" value={`${me.cadence_per_week}/wk`} sub={`set avg ${avg((c) => c.cadence_per_week).toFixed(1)}/wk`} />
            <Kpi label="Engagement rate" value={pct(me.engagement_rate_avg)} sub={`set avg ${pct(avg((c) => c.engagement_rate_avg))}`} />
            <Kpi label="Avg engagement" value={fmt(me.engagement_avg)} sub={`set avg ${fmt(avg((c) => c.engagement_avg))}`} />
          </div>
        )}

        {rd.schema_note && <p className="text-sm text-amber-400">{rd.schema_note}</p>}

        {/* Executive summary */}
        {ai.executive_summary && (
          <Card className="glass-elevated">
            <CardHeader><CardTitle className="text-lg">Executive summary</CardTitle></CardHeader>
            <CardContent className="text-[15px] leading-7 whitespace-pre-line">{ai.executive_summary}</CardContent>
          </Card>
        )}

        {/* Scorecard */}
        {scorecard?.dimensions?.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Gauge className="h-5 w-5" /> Where {clientName} stands</CardTitle>
              <CardDescription>Client (bar) versus the competitive set average (marker), per dimension.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {scorecard.dimensions.map((d: any, i: number) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between items-baseline gap-4">
                    <span className="font-medium">{d.dimension}</span>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">{d.client} <span className="opacity-60">vs</span> {d.competitor_avg}</span>
                  </div>
                  <div className="relative h-3 rounded-full bg-[rgba(255,255,255,0.06)]">
                    <div className="absolute left-0 top-0 h-3 rounded-full" style={{ width: `${Math.min(100, d.client || 0)}%`, backgroundColor: `rgb(${ACCENT})` }} />
                    <div className="absolute top-[-4px] h-5 w-[3px] rounded bg-white/80" style={{ left: `${Math.min(100, d.competitor_avg || 0)}%` }} title="competitor average" />
                  </div>
                  {d.note && <p className="text-sm text-muted-foreground">{d.note}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Competitor cards */}
        {companies.length > 0 && (
          <section className="space-y-4">
            <div>
              <h3 className="text-xl font-bold tracking-tight">The field</h3>
              <p className="text-sm text-muted-foreground">Volume, engagement and channel mix for every company in the landscape.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...(me ? [me] : []), ...rivals].map((c) => {
                const breakdown = (ai.competitor_breakdowns || []).find((b: any) => (b.name || "").toLowerCase() === c.name.toLowerCase());
                return (
                  <Card key={c.company_id} className={c.is_client ? "glass-accent" : ""}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                        {c.name}
                        {c.is_client && <Badge>client</Badge>}
                        {c.in_confirmed_top3 && <Badge variant="secondary">top 3</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div><p className="text-2xl font-bold tracking-tight">{c.post_count}</p><p className="text-xs text-muted-foreground">posts</p></div>
                        <div><p className="text-2xl font-bold tracking-tight">{c.cadence_per_week}</p><p className="text-xs text-muted-foreground">per week</p></div>
                        <div><p className="text-2xl font-bold tracking-tight">{pct(c.engagement_rate_avg)}</p><p className="text-xs text-muted-foreground">eng. rate</p></div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(c.channel_mix || []).map((m) => <Chip key={m.key}>{m.key} · {m.count}</Chip>)}
                      </div>
                      {breakdown && (
                        <div className="text-sm space-y-1.5 border-t border-[rgba(255,255,255,0.06)] pt-3">
                          {breakdown.copy_style && <p><span className="text-muted-foreground">Copy: </span>{breakdown.copy_style}</p>}
                          {breakdown.design_look && <p><span className="text-muted-foreground">Look: </span>{breakdown.design_look}</p>}
                          {breakdown.content_type_mix && <p><span className="text-muted-foreground">Mix: </span>{breakdown.content_type_mix}</p>}
                        </div>
                      )}
                      {c.top_hashtags?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          {c.top_hashtags.slice(0, 6).map((h) => <Chip key={h.key}>{h.key} <span className="text-muted-foreground ml-1">{h.count}</span></Chip>)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Posting times */}
        {companies.some((c) => c.post_count > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" /> When everyone posts</CardTitle>
              <CardDescription className="text-[15px] leading-6">{ai.posting_time_insights?.summary || "By weekday and by hour (UTC)."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {[...(me ? [me] : []), ...rivals.filter((c) => c.post_count > 0)].map((c) => (
                <div key={c.company_id} className="space-y-2">
                  <div className="font-medium flex items-center gap-2">{c.name}{c.is_client && <Badge>client</Badge>}</div>
                  <div className="flex flex-wrap gap-8">
                    <div><p className="text-xs text-muted-foreground mb-1.5">Weekday</p><HeatStrip counts={c.by_weekday} keys={WEEKDAYS} /></div>
                    <div><p className="text-xs text-muted-foreground mb-1.5">Hour (UTC)</p><HeatStrip counts={c.by_hour} keys={HOURS} labelEvery={3} size="h-6 w-5" /></div>
                  </div>
                </div>
              ))}
              {ai.posting_time_insights?.empty_airtime && (
                <div className="rounded-[12px] p-4 bg-[rgba(185,224,69,0.08)] border border-[rgba(185,224,69,0.25)]">
                  <p className="text-sm font-semibold mb-1">Empty airtime</p>
                  <p className="text-[15px] leading-6">{ai.posting_time_insights.empty_airtime}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Gaps */}
        {Array.isArray(ai.gaps_for_client) && ai.gaps_for_client.length > 0 && (
          <section className="space-y-4">
            <div>
              <h3 className="text-xl font-bold tracking-tight flex items-center gap-2"><Lightbulb className="h-5 w-5" /> Gaps {clientName} can fill</h3>
              <p className="text-sm text-muted-foreground">Strategy leans; review before sharing with the client.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {ai.gaps_for_client.map((g: any, i: number) => (
                <Card key={i}>
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">{i + 1}</span>
                      <p className="text-lg font-semibold leading-snug">{g.gap}</p>
                    </div>
                    {g.why_it_matters && <p className="text-[15px] leading-6 text-muted-foreground">{g.why_it_matters}</p>}
                    {g.suggested_play && (
                      <div className="rounded-[12px] p-3 bg-[rgba(185,224,69,0.08)] border border-[rgba(185,224,69,0.25)] text-[15px] leading-6">
                        <span className="font-semibold">The play: </span>{g.suggested_play}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Winner teardown */}
        {Array.isArray(ai.winner_teardown) && ai.winner_teardown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Trophy className="h-5 w-5" /> What wins for them</CardTitle>
              <CardDescription>The repeatable pattern behind each competitor's best posts.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {ai.winner_teardown.map((w: any, i: number) => (
                <div key={i} className="rounded-[12px] p-4 bg-[rgba(255,255,255,0.04)] space-y-2">
                  <p className="text-sm uppercase tracking-wider text-muted-foreground">{w.competitor}</p>
                  <p className="font-semibold leading-snug">{w.pattern}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{w.evidence}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Top posts */}
        {companies.some((c) => c.top_posts?.length) && (
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Layers className="h-5 w-5" /> Top posts in the period</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {[...(me ? [me] : []), ...rivals].filter((c) => c.top_posts?.length).map((c) => (
                <div key={c.company_id} className="space-y-2">
                  <p className="font-medium">{c.name}</p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {c.top_posts.slice(0, 3).map((p, i) => (
                      <a key={i} href={p.url || undefined} target="_blank" rel="noreferrer" className="block rounded-[12px] p-4 bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] transition-colors space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>{p.channel} · {p.media_type}</span><span>{p.created ? new Date(p.created).toLocaleDateString() : ""}</span></div>
                        <p className="text-[15px] leading-6 line-clamp-3">{p.text || "(no caption)"}</p>
                        <div className="flex gap-2 flex-wrap">
                          <Chip>{fmt(p.engagement)} engagements</Chip>
                          {p.engagement_rate ? <Chip>{pct(p.engagement_rate)} ER</Chip> : null}
                          {p.views ? <Chip>{fmt(p.views)} views</Chip> : null}
                        </div>
                      </a>
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
