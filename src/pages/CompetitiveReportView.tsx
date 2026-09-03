// Renders one competitive_reports row (project step 11's in-app half).
//
// Open to client members for status='complete' rows via RLS, exactly like the
// social report view: the router does not guard this route, the policies do.
// The data shape is produced by the n8n workflow's Assemble Report Data node.
// One platform filter drives the field, the rhythm strips, the gaps and the
// top posts. Reports run before per-platform aggregation existed have no
// by_channel data, so the filter only appears when it can do something.

import { useMemo, useRef, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { PostVisual, usePostPreviews, normalizePlatform, platformLabel } from "@/components/competitive/PostVisual";
import { partitionGaps, useInsightFeedback } from "@/hooks/useInsightFeedback";
import { formatRange } from "@/lib/dateRange";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import { ArrowLeft, Crosshair, ExternalLink, Gauge, Lightbulb, Clock, Trophy, Hash, Layers, ThumbsUp, ThumbsDown, History, CalendarCheck, Eye, RotateCcw, Rss, Images } from "lucide-react";

type TopPost = {
  engagement: number; engagement_rate: number; est_impressions?: number; reach?: number; views: number;
  applause?: number; conversation?: number; amplification?: number;
  text: string; url: string | null; image?: string | null; created: string | null; media_type: string; channel: string;
};
type Bucket = {
  post_count: number; cadence_per_week: number; engagement_avg: number; engagement_rate_avg: number; impressions_avg?: number;
  views_total: number; impressions_total: number; reach_total?: number;
  by_weekday: Record<string, number>; by_hour: Record<string, number>;
  top_hashtags: Array<{ key: string; count: number }>; media_type_mix: Array<{ key: string; count: number }>;
  top_posts: TopPost[];
};
type Company = Bucket & {
  company_id: string; name: string; url: string | null; is_client: boolean; in_confirmed_top3: boolean;
  channel_mix: Array<{ key: string; count: number }>; by_channel?: Record<string, Bucket>;
};

const EMPTY: Bucket = { post_count: 0, cadence_per_week: 0, engagement_avg: 0, engagement_rate_avg: 0, impressions_avg: 0, views_total: 0, impressions_total: 0, by_weekday: {}, by_hour: {}, top_hashtags: [], media_type_mix: [], top_posts: [] };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i));
const ACCENT = "185,224,69";
const RECOMMEND = "120,190,255";

const fmt = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(2)}%`);

function bucketFor(c: Company, plat: string): Bucket {
  if (plat === "all") return c;
  const entry = Object.entries(c.by_channel || {}).find(([k]) => normalizePlatform(k) === plat);
  return entry ? entry[1] : EMPTY;
}

function HeatStrip({ counts, keys, labelEvery = 1, size = "h-6 w-6", color = ACCENT }: { counts: Record<string, number>; keys: string[]; labelEvery?: number; size?: string; color?: string }) {
  const max = Math.max(1, ...keys.map((k) => Number(counts?.[k]) || 0));
  return (
    <div className="flex gap-[3px]">
      {keys.map((k, i) => {
        const v = Number(counts?.[k]) || 0;
        return (
          <div key={k} className="flex flex-col items-center gap-1" title={`${k}: ${v} post${v === 1 ? "" : "s"}`}>
            <div className={`${size} rounded-[6px]`} style={{ backgroundColor: `rgba(${color},${v ? 0.18 + 0.82 * (v / max) : 0.06})` }} />
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

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-[9px] text-[13px] font-medium transition-colors ${active ? "bg-[rgba(255,255,255,0.12)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[15px] font-semibold tracking-tight truncate">{value}</p>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
    </div>
  );
}

export default function CompetitiveReportView() {
  const { id: clientId, reportId } = useParams();
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();
  const { toast } = useToast();
  const [plat, setPlat] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const { rows: feedback, verdictFor, vote } = useInsightFeedback(clientId);

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

  const rd: any = report?.report_data || {};
  const ai = rd.ai_analysis || {};
  const companies: Company[] = rd.aggregates?.companies || [];

  // Every post the report carries, keyed by URL, for example-post lookups and previews.
  const allPosts = useMemo(() => {
    const map = new Map<string, TopPost & { company: string }>();
    for (const c of companies) {
      const lists = [c.top_posts || [], ...Object.values(c.by_channel || {}).map((b) => b.top_posts || [])];
      for (const list of lists) for (const p of list) if (p.url && !map.has(p.url)) map.set(p.url, { ...p, company: c.name });
    }
    return map;
  }, [companies]);
  // Every post goes through post-preview: posts without a creative get one
  // resolved, posts with an expiring CDN link get a durable copy.
  const previewItems = useMemo(() => Array.from(allPosts.values()).map((p) => ({ url: p.url, image: p.image || null, mediaType: p.media_type })), [allPosts]);
  const { previews } = usePostPreviews(previewItems);

  const platforms = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of companies) {
      for (const [k, b] of Object.entries(c.by_channel || {})) {
        const key = normalizePlatform(k);
        if (key) totals.set(key, (totals.get(key) || 0) + (b.post_count || 0));
      }
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [companies]);
  const hasChannels = platforms.length > 0;
  const effectivePlat = plat !== "all" && platforms.includes(plat) ? plat : "all";

  if (isLoading) return <AppLayout title="Competitive Report"><Loading label="Loading report" /></AppLayout>;
  if (!report) {
    return (
      <AppLayout title="Competitive Report">
        <EmptyState icon={Crosshair} title="Report not available" description="It may still be running, or you may not have access to it." />
      </AppLayout>
    );
  }

  const me = companies.find((c) => c.is_client) || null;
  const rivals = companies.filter((c) => !c.is_client).sort((a, b) => b.post_count - a.post_count);
  const meB = me ? bucketFor(me, effectivePlat) : null;
  const rivalBuckets = rivals.map((c) => ({ c, b: bucketFor(c, effectivePlat) }));
  const activeRivals = rivalBuckets.filter((x) => x.b.post_count > 0);
  const avg = (f: (b: Bucket) => number) => (activeRivals.length ? activeRivals.reduce((s, x) => s + f(x.b), 0) / activeRivals.length : 0);
  const totalPosts = (meB?.post_count || 0) + rivalBuckets.reduce((s, x) => s + x.b.post_count, 0);
  const shareOfVoice = meB && totalPosts ? (meB.post_count / totalPosts) * 100 : null;
  const scorecard = ai.benchmark_scorecard;
  const period = rd.period?.start ? formatRange(rd.period) : report.date_range_start ? formatRange({ start: report.date_range_start, end: report.date_range_end }) : "";
  const clientName = client?.name || rd.aggregates?.client_name || "Client";
  const ordered = [...(me ? [me] : []), ...rivals];

  const gapsForPlatform = (ai.gaps_for_client || []).filter((g: any) => effectivePlat === "all" || !g.platform || g.platform === "all" || normalizePlatform(g.platform) === effectivePlat);
  const { visible: gaps, hidden: hiddenGaps } = partitionGaps<any>(gapsForPlatform, feedback);
  const schedule = ai.recommended_schedule;

  // Every creative a company ran in the period (all channels, or the filtered
  // one), for the mood board grids.
  const moodPosts = (c: Company): TopPost[] => {
    const seen = new Set<string>();
    const out: TopPost[] = [];
    const lists = [bucketFor(c, effectivePlat).top_posts || [], ...(effectivePlat === "all" ? Object.values(c.by_channel || {}).map((b) => b.top_posts || []) : [])];
    for (const list of lists) for (const p of list) { const k = p.url || p.text; if (!k || seen.has(k)) continue; seen.add(k); out.push(p); }
    return out.slice(0, 16);
  };

  const castVote = async (g: any, verdict: "up" | "down") => {
    try {
      await vote({ gapText: g.gap, platform: g.platform || null, verdict, reportId: report.id });
      if (verdict === "down" && verdictFor(g.gap) !== "down") {
        toast({ title: "Suggestion hidden", description: `It will not be proposed again for ${clientName}. Restore it from "hidden suggestions" if you change your mind.` });
      } else if (verdict === "up" && verdictFor(g.gap) !== "up") {
        toast({ title: "Marked to implement", description: "The next monthly report and its content calendar will address this gap." });
      }
    } catch (e: any) {
      toast({ title: "Could not save feedback", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const postCard = (p: TopPost, key: string) => (
    <div key={key} className="rounded-[12px] p-3 bg-[rgba(255,255,255,0.04)] space-y-2.5">
      <PostVisual url={p.url} image={p.image} preview={p.url ? previews[p.url] : null} mediaType={p.media_type} platform={p.channel} maxHeight="26rem" />
      <p className="text-[13px] leading-5 line-clamp-2 min-h-[2.5rem]">{p.text || "(no caption)"}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Stat label="Est. impressions" value={p.est_impressions ? fmt(p.est_impressions) : "–"} />
        <Stat label="Engagements" value={fmt(p.engagement)} />
        <Stat label="Eng. rate" value={p.engagement_rate ? pct(p.engagement_rate) : "–"} />
        <Stat label={p.views ? "Views" : "Reach"} value={p.views ? fmt(p.views) : p.reach ? fmt(p.reach) : "–"} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {(p.applause || p.conversation || p.amplification) ? (
          <span title="Likes and reactions · comments · shares">{fmt(p.applause || 0)} likes · {fmt(p.conversation || 0)} comments · {fmt(p.amplification || 0)} shares</span>
        ) : <span />}
        <span>{p.created ? new Date(p.created).toLocaleDateString() : ""}</span>
      </div>
    </div>
  );

  return (
    <AppLayout title={`Competitive: ${clientName}`}>
      <div ref={printRef} className="max-w-6xl mx-auto space-y-8">

        {/* Hero */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(isMoburstStaff ? `/clients/${clientId}/competitive/run` : "/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <h2 className="text-3xl font-bold tracking-tight">{clientName} vs. the field</h2>
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              <Badge variant={report.status === "complete" ? "default" : report.status === "failed" ? "destructive" : "secondary"}>{report.status}</Badge>
              {period && <Chip>{period}{rd.period?.days ? ` · ${rd.period.days} days` : ""}</Chip>}
              {rd.landscape?.name && <Chip>RivalIQ · {rd.landscape.name}</Chip>}
              {rivals.length > 0 && <Chip>{rivals.length} competitors</Chip>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" onClick={() => navigate(`/clients/${clientId}/competitive/reports`)}><History className="h-4 w-4 mr-2" /> All runs</Button>
            {isMoburstStaff && (
              <Button variant="ghost" onClick={() => navigate(`/clients/${clientId}/competitive/feed`)}><Rss className="h-4 w-4 mr-2" /> Latest posts</Button>
            )}
            <ExportPdfButton contentRef={printRef} filename={`${clientName.replace(/[^a-z0-9]+/gi, "_")}_competitive_${period ? period.replace(/[^a-z0-9]+/gi, "_") : report.id.slice(0, 8)}`} title={`${clientName} vs. the field${period ? ` (${period})` : ""}`} />
          </div>
        </div>

        {report.status === "failed" && (
          <Card><CardContent className="pt-6 text-destructive break-words">{String(rd.error || "The run failed before producing a report.")}</CardContent></Card>
        )}

        {/* Platform filter */}
        {hasChannels && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Platform</span>
            <div className="flex items-center gap-0.5 p-1 rounded-[12px] bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.07)]">
              <Seg active={effectivePlat === "all"} onClick={() => setPlat("all")}>All platforms</Seg>
              {platforms.map((k) => <Seg key={k} active={effectivePlat === k} onClick={() => setPlat(k)}>{platformLabel(k)}</Seg>)}
            </div>
            {effectivePlat !== "all" && <span className="text-sm text-muted-foreground">Field, rhythm, gaps and top posts now show {platformLabel(effectivePlat)} only.</span>}
          </div>
        )}
        {!hasChannels && companies.length > 0 && (
          <p className="text-sm text-muted-foreground">Per-platform breakdowns are produced for runs from September 2, 2026 onward. Re-run the analysis to get them for this client.</p>
        )}

        {/* KPI tiles */}
        {meB && (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
            <Kpi accent label="Benchmark score" value={scorecard ? `${scorecard.client_score}` : "–"} sub="out of 100 vs. the set" />
            <Kpi label="Share of voice" value={shareOfVoice == null ? "–" : `${shareOfVoice.toFixed(0)}%`} sub={`${meB.post_count} of ${totalPosts} posts`} />
            <Kpi label="Cadence" value={`${meB.cadence_per_week}/wk`} sub={`set avg ${avg((b) => b.cadence_per_week).toFixed(1)}/wk`} />
            <Kpi label="Engagement rate" value={pct(meB.engagement_rate_avg)} sub={`set avg ${pct(avg((b) => b.engagement_rate_avg))}`} />
            <Kpi label="Avg engagement" value={fmt(meB.engagement_avg)} sub={`set avg ${fmt(avg((b) => b.engagement_avg))}`} />
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
              <CardDescription>Client (bar) versus the competitive set average (marker), per dimension, across all platforms.</CardDescription>
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

        {/* The field */}
        {companies.length > 0 && (
          <section className="space-y-4">
            <div>
              <h3 className="text-xl font-bold tracking-tight">The field{effectivePlat !== "all" ? ` on ${platformLabel(effectivePlat)}` : ""}</h3>
              <p className="text-sm text-muted-foreground">Volume, engagement and reach for every company in the landscape. Averages are per post; impressions for competitors are RivalIQ estimates.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ordered.map((c) => {
                const b = bucketFor(c, effectivePlat);
                const breakdown = (ai.competitor_breakdowns || []).find((x: any) => (x.name || "").toLowerCase() === c.name.toLowerCase());
                const platformNote = effectivePlat !== "all" ? (breakdown?.platform_notes || []).find((n: any) => normalizePlatform(n.platform) === effectivePlat)?.note : null;
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
                      {b.post_count === 0 ? (
                        <p className="text-sm text-muted-foreground">No posts in this period{effectivePlat !== "all" ? ` on ${platformLabel(effectivePlat)}` : ""}.</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          <div><p className="text-2xl font-bold tracking-tight">{b.post_count}</p><p className="text-xs text-muted-foreground">posts</p></div>
                          <div><p className="text-2xl font-bold tracking-tight">{b.cadence_per_week}</p><p className="text-xs text-muted-foreground">per week</p></div>
                          <div><p className="text-2xl font-bold tracking-tight">{pct(b.engagement_rate_avg)}</p><p className="text-xs text-muted-foreground">eng. rate</p></div>
                          <div><p className="text-xl font-bold tracking-tight">{fmt(b.engagement_avg)}</p><p className="text-xs text-muted-foreground">avg engagements</p></div>
                          <div><p className="text-xl font-bold tracking-tight">{b.impressions_avg ? fmt(b.impressions_avg) : fmt(b.post_count ? b.impressions_total / b.post_count : 0)}</p><p className="text-xs text-muted-foreground">avg est. impressions</p></div>
                          <div><p className="text-xl font-bold tracking-tight">{fmt(b.views_total)}</p><p className="text-xs text-muted-foreground">video views</p></div>
                        </div>
                      )}
                      {effectivePlat === "all" && (
                        <div className="flex flex-wrap gap-1.5">
                          {(c.channel_mix || []).map((m) => <Chip key={m.key}>{platformLabel(m.key)} · {m.count}</Chip>)}
                        </div>
                      )}
                      {(b.media_type_mix || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {b.media_type_mix.slice(0, 4).map((m) => <Chip key={m.key}>{m.key} · {m.count}</Chip>)}
                        </div>
                      )}
                      {(platformNote || breakdown) && (
                        <div className="text-sm space-y-1.5 border-t border-[rgba(255,255,255,0.06)] pt-3">
                          {platformNote && <p><span className="text-muted-foreground">{platformLabel(effectivePlat)}: </span>{platformNote}</p>}
                          {breakdown?.copy_style && <p><span className="text-muted-foreground">Copy: </span>{breakdown.copy_style}</p>}
                          {breakdown?.design_look && <p><span className="text-muted-foreground">Look: </span>{breakdown.design_look}</p>}
                          {breakdown?.content_type_mix && <p><span className="text-muted-foreground">Mix: </span>{breakdown.content_type_mix}</p>}
                        </div>
                      )}
                      {b.top_hashtags?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          {b.top_hashtags.slice(0, 6).map((h) => <Chip key={h.key}>{h.key} <span className="text-muted-foreground ml-1">{h.count}</span></Chip>)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Posting rhythm */}
        {ordered.some((c) => bucketFor(c, effectivePlat).post_count > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" /> Posting rhythm: you vs. the field</CardTitle>
              <CardDescription className="text-[15px] leading-6">{ai.posting_time_insights?.summary || "When each company posts, by weekday and by hour (UTC)."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {ordered.map((c) => ({ c, b: bucketFor(c, effectivePlat) })).filter((x) => x.b.post_count > 0).map(({ c, b }) => (
                <div key={c.company_id} className="space-y-2">
                  <div className="font-medium flex items-center gap-2">{c.name}{c.is_client && <Badge>client · current rhythm</Badge>}</div>
                  <div className="flex flex-wrap gap-8">
                    <div><p className="text-xs text-muted-foreground mb-1.5">Weekday</p><HeatStrip counts={b.by_weekday} keys={WEEKDAYS} /></div>
                    <div><p className="text-xs text-muted-foreground mb-1.5">Hour (UTC)</p><HeatStrip counts={b.by_hour} keys={HOURS} labelEvery={3} size="h-6 w-5" /></div>
                  </div>
                </div>
              ))}

              {schedule && (schedule.by_weekday || schedule.by_hour) && (
                <div className="rounded-[12px] p-4 space-y-3 border" style={{ backgroundColor: `rgba(${RECOMMEND},0.08)`, borderColor: `rgba(${RECOMMEND},0.3)` }}>
                  <div className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-4 w-4" /> Recommended schedule for {clientName}</div>
                  <div className="flex flex-wrap gap-8">
                    {schedule.by_weekday && <div><p className="text-xs text-muted-foreground mb-1.5">Posts per weekday</p><HeatStrip counts={schedule.by_weekday} keys={WEEKDAYS} color={RECOMMEND} /></div>}
                    {schedule.by_hour && <div><p className="text-xs text-muted-foreground mb-1.5">Posts per hour (UTC)</p><HeatStrip counts={schedule.by_hour} keys={HOURS} labelEvery={3} size="h-6 w-5" color={RECOMMEND} /></div>}
                  </div>
                  {schedule.rationale && <p className="text-[15px] leading-6">{schedule.rationale}</p>}
                </div>
              )}

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
        {(gaps.length > 0 || hiddenGaps.length > 0) && (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-xl font-bold tracking-tight flex items-center gap-2"><Lightbulb className="h-5 w-5" /> Gaps {clientName} can fill{effectivePlat !== "all" ? ` on ${platformLabel(effectivePlat)}` : ""}</h3>
                <p className="text-sm text-muted-foreground">
                  {isMoburstStaff ? "Thumbs up sends a gap into the next monthly report and content calendar. Thumbs down hides it and stops it being proposed again." : "Opportunities your account team is reviewing."}
                </p>
              </div>
              {isMoburstStaff && hiddenGaps.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>
                  <Eye className="h-4 w-4 mr-1" /> {showHidden ? "Hide" : "Show"} {hiddenGaps.length} hidden suggestion{hiddenGaps.length === 1 ? "" : "s"}
                </Button>
              )}
            </div>
            {gaps.length === 0 && <p className="text-sm text-muted-foreground">Every suggestion for this view has been hidden by the team.</p>}
            <div className="grid gap-4 md:grid-cols-2">
              {gaps.map((g: any, i: number) => {
                const v = verdictFor(g.gap);
                return (
                  <Card key={i} className={v === "up" ? "glass-accent" : ""}>
                    <CardContent className="pt-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">{i + 1}</span>
                        <div className="min-w-0 space-y-1">
                          <p className="text-lg font-semibold leading-snug">{g.gap}</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {g.platform && <Badge variant="outline">{g.platform === "all" ? "All platforms" : platformLabel(g.platform)}</Badge>}
                            {v === "up" && <Badge className="gap-1"><ThumbsUp className="h-3 w-3" /> in the calendar brief</Badge>}
                          </div>
                        </div>
                      </div>
                      {g.why_it_matters && <p className="text-[15px] leading-6 text-muted-foreground">{g.why_it_matters}</p>}
                      {g.suggested_play && (
                        <div className="rounded-[12px] p-3 bg-[rgba(185,224,69,0.08)] border border-[rgba(185,224,69,0.25)] text-[15px] leading-6">
                          <span className="font-semibold">The play: </span>{g.suggested_play}
                        </div>
                      )}
                      {isMoburstStaff && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button size="sm" variant={v === "up" ? "default" : "outline"} onClick={() => castVote(g, "up")} aria-pressed={v === "up"}>
                            <ThumbsUp className="h-4 w-4 mr-1.5" /> {v === "up" ? "Implementing" : "Implement"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => castVote(g, "down")} aria-label="Hide this suggestion">
                            <ThumbsDown className="h-4 w-4 mr-1.5" /> Not for us
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {isMoburstStaff && showHidden && hiddenGaps.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Hidden suggestions</CardTitle><CardDescription>Excluded from future runs and from the monthly report brief.</CardDescription></CardHeader>
                <CardContent className="space-y-2">
                  {hiddenGaps.map((g: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground line-through">{g.gap}</span>
                      <Button size="sm" variant="ghost" onClick={() => castVote(g, "down")}><RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore</Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* Winner teardown */}
        {Array.isArray(ai.winner_teardown) && ai.winner_teardown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Trophy className="h-5 w-5" /> What wins for them</CardTitle>
              <CardDescription>The repeatable pattern behind each competitor's best posts, with the posts that prove it.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {ai.winner_teardown.map((w: any, i: number) => {
                const examples: Array<{ url: string; post?: TopPost }> = (w.example_post_urls || []).slice(0, 3).map((u: string) => ({ url: u, post: allPosts.get(u) }));
                return (
                  <div key={i} className="rounded-[12px] p-4 bg-[rgba(255,255,255,0.04)] space-y-3">
                    <p className="text-sm uppercase tracking-wider text-muted-foreground">{w.competitor}</p>
                    <p className="font-semibold leading-snug">{w.pattern}</p>
                    <p className="text-sm leading-6 text-muted-foreground">{w.evidence}</p>
                    {examples.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className={`grid gap-2 items-start ${examples.length === 1 ? "grid-cols-1" : examples.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                          {examples.map((ex, j) => (
                            <PostVisual key={j} url={ex.url} image={ex.post?.image} preview={previews[ex.url]} mediaType={ex.post?.media_type} platform={ex.post?.channel} compact />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {examples.map((ex, j) => (
                            <Button key={j} size="sm" variant="outline" className="h-7 text-xs" asChild>
                              <a href={ex.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Post {j + 1}{ex.post ? ` · ${fmt(ex.post.engagement)} eng.` : ""}</a>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Mood boards */}
        {ordered.some((c) => moodPosts(c).length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Images className="h-5 w-5" /> Mood boards</CardTitle>
              <CardDescription>The creative each company actually ran in the period, side by side. Click any tile to open the post.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {ordered.map((c) => {
                const posts = moodPosts(c);
                if (!posts.length) return null;
                return (
                  <div key={c.company_id} className="space-y-2">
                    <p className="font-medium flex items-center gap-2">{c.name}{c.is_client && <Badge>client</Badge>}</p>
                    <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                      {posts.map((p, i) => <PostVisual key={i} url={p.url} image={p.image} preview={p.url ? previews[p.url] : null} mediaType={p.media_type} platform={p.channel} compact />)}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Top posts */}
        {ordered.some((c) => bucketFor(c, effectivePlat).top_posts?.length) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Layers className="h-5 w-5" /> Top 5 posts per company</CardTitle>
              <CardDescription>Ranked by total engagement in the period. Post-level figures come straight from RivalIQ; competitor impressions are estimates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {ordered.map((c) => ({ c, b: bucketFor(c, effectivePlat) })).filter((x) => x.b.top_posts?.length).map(({ c, b }) => (
                <div key={c.company_id} className="space-y-3">
                  <p className="font-medium flex items-center gap-2">{c.name}{c.is_client && <Badge>client</Badge>}</p>
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 items-start">
                    {b.top_posts.slice(0, 5).map((p, i) => postCard(p, `${c.company_id}-${i}`))}
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
