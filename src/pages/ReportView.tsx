import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  MousePointerClick,
  Video,
  Lightbulb,
  BarChart3,
  Sparkles,
  Target,
  Globe,
  Languages,
  CheckCircle2,
  AlertCircle,
  Crosshair,
  ArrowRight,
  Rss,
  ChevronDown,
} from "lucide-react";
import {
  PlatformBadge,
  PlatformIcon,
  getPlatformColor,
  normalizePlatformKey,
  prettyPlatformName,
} from "@/lib/platform-config";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Loading } from "@/components/ui/loading";
import { useRef, useState, useMemo } from "react";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { useAuth } from "@/hooks/useAuth";
import { useTrackView } from "@/hooks/useTrackView";
import { ReportActions } from "@/components/reports/ReportActions";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";
import { CompetitiveSnapshot } from "@/components/competitive/CompetitiveSnapshot";
import { PostVisual, usePostPreviews, type PostPreview } from "@/components/competitive/PostVisual";
import { useInsightFeedback } from "@/hooks/useInsightFeedback";
import { Clamp } from "@/components/ui/clamp";
import {
  parseCsv,
  stripVoicePreset,
  type ClientContext,
  type ContentPillar,
} from "@/lib/clientContext";

export default function ReportView() {
  const { id, reportId } = useParams();
  const navigate = useNavigate();
  const reportContentRef = useRef<HTMLDivElement>(null);
  useRealtimeReports(id);
  const { isClient } = useAuth();
  const [tab, setTab] = useState("overview");
  const { verdictFor } = useInsightFeedback(id);

  // The latest competitive analysis, so the overview can place this month
  // against the field and surface the gaps the team decided to act on.
  const { data: latestCompetitive } = useQuery({
    queryKey: ["competitive-latest", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, created_at, report_data")
        .eq("client_id", id!)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select(`
          *,
          clients (
            id, name, brand_identity, design_references,
            brand_book_file_path, brand_book_url,
            content_pillars, brief_text, brand_notes,
            geo, language, timezone, design_style_synthesis
          )
        `)
        .eq("id", reportId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!reportId,
  });

  const overviewPostUrls = useMemo(() => {
    const rawRd = (report as any)?.report_data;
    const rd0 = Array.isArray(rawRd) ? rawRd[0] : rawRd;
    const posts: any[] = rd0?.sprout_performance?.top_posts || [];
    return [...posts].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 3).map((p) => p.permalink || p.url);
  }, [report]);
  const { previews: overviewPreviews } = usePostPreviews(overviewPostUrls);

  // Whether a generated calendar is ever actually read.
  useTrackView("report", reportId, {
    client_id: id,
    status: report?.status ?? null,
    report_type: report?.report_type ?? null,
  });

  if (isLoading)
    return (
      <AppLayout title="Report">
        <Loading label="Loading report" />
      </AppLayout>
    );
  if (!report)
    return (
      <AppLayout title="Report">
        <p className="text-muted-foreground">Report not found.</p>
      </AppLayout>
    );

  const rawRd = report.report_data as any;
  const rd = Array.isArray(rawRd) ? rawRd[0] : rawRd;
  const clientName = (report as any).clients?.name || "Client";

  // Build the full client context once, pass down via props.
  const clientRow = (report as any).clients || {};
  const clientContext: ClientContext = {
    client_id: clientRow.id || id || "",
    client_name: clientRow.name || "Client",
    brand_identity: clientRow.brand_identity || null,
    design_references: Array.isArray(clientRow.design_references)
      ? (clientRow.design_references as string[])
      : [],
    brand_book_file_path: clientRow.brand_book_file_path || null,
    brand_book_url: clientRow.brand_book_url || null,
    content_pillars: Array.isArray(clientRow.content_pillars)
      ? (clientRow.content_pillars as ContentPillar[])
      : [],
    brief_text: clientRow.brief_text || null,
    brand_notes: stripVoicePreset(clientRow.brand_notes),
    geo: parseCsv(clientRow.geo),
    languages: parseCsv(clientRow.language),
    timezone: clientRow.timezone || "UTC",
    design_style_synthesis: clientRow.design_style_synthesis || null,
  };

  const sproutPerformance = rd?.sprout_performance || {};
  const monthComparison = sproutPerformance?.month_comparison || {};
  const aiAnalysis = rd?.ai_analysis || {};
  const tiktokTrends = rd?.tiktok_trends || {};
  const instagramTrends = rd?.instagram_trends || {};
  const contentCalendar = rd?.content_calendar || aiAnalysis?.content_calendar || [];

  // ── Per-platform performance (dynamic; degrades gracefully for older reports) ──
  // Prefer the rich `platform_breakdown` (per-network month-over-month) from the
  // workflow; fall back to the current-only `platform_metrics` object. Older reports
  // have neither, so the "Performance by Platform" section simply doesn't render.
  // Per-platform *top posts* are handled separately via a filter on the flat
  // cross-platform `top_posts` list (which already carries a platform per post).
  const aiPlatformInsights: any[] = Array.isArray(
    aiAnalysis?.sprout_performance_analysis?.platform_breakdown,
  )
    ? aiAnalysis.sprout_performance_analysis.platform_breakdown
    : [];

  const platformBreakdown: any[] = (() => {
    const provided = sproutPerformance?.platform_breakdown;
    const base: any[] =
      Array.isArray(provided) && provided.length > 0
        ? provided
        : Object.entries(sproutPerformance?.platform_metrics || {}).map(
            ([network, m]: [string, any]) => ({
              network,
              current: pick6(m),
              previous: null,
              changes: null,
              post_count: m?.post_count ?? 0,
              profile_names: m?.profile_names ?? (m?.profile_name ? [m.profile_name] : []),
            }),
          );
    // Attach any AI-written per-platform commentary, matched by canonical platform key,
    // so each platform shows its numbers and narrative together in one card.
    return base
      .map((p: any) => ({
        ...p,
        ai:
          aiPlatformInsights.find(
            (a: any) => normalizePlatformKey(a.platform) === normalizePlatformKey(p.network),
          ) || null,
      }))
      .sort((a: any, b: any) => (b.current?.impressions || 0) - (a.current?.impressions || 0));
  })();

  // Extract unique platforms from content recommendations and calendar
  const availablePlatforms = [
    ...new Set([
      ...(aiAnalysis?.content_recommendations || []).map((r: any) => r.platform).filter(Boolean),
      ...(contentCalendar || []).flatMap((day: any) =>
        (day.posts || []).map((p: any) => p.platform).filter(Boolean)
      ),
    ]),
  ] as string[];

  const availableLanguages = [
    ...new Set(
      (contentCalendar || []).flatMap((day: any) =>
        (day.posts || []).map((p: any) => p.language).filter(Boolean),
      ),
    ),
  ] as string[];

  const hasTrends = !!(
    aiAnalysis?.tiktok_trends_analysis ||
    tiktokTrends?.posts?.length ||
    aiAnalysis?.instagram_trends_analysis ||
    instagramTrends?.posts?.length
  );
  const hasContent = aiAnalysis?.content_recommendations?.length > 0 || contentCalendar.length > 0;
  const gammaUrl = report.gamma_url || rd?.gamma_url;

  // Every recommendation that asks for a decision, gathered in one place and
  // tagged by where it came from. Competitor gaps the team endorsed come first.
  const endorsedGaps = latestCompetitive
    ? ((latestCompetitive.report_data as any)?.ai_analysis?.gaps_for_client || []).filter((g: any) => verdictFor(g.gap) === "up")
    : [];
  const competitiveTakeaways: string[] = Array.isArray(aiAnalysis?.competitive_takeaways) ? aiAnalysis.competitive_takeaways : [];
  const pillarRecs: string[] = aiAnalysis?.sprout_performance_analysis?.pillar_alignment?.recommendations || [];
  const trendOpportunities: string[] = [
    ...(aiAnalysis?.tiktok_trends_analysis?.opportunities_for_client || []),
    ...(aiAnalysis?.instagram_trends_analysis?.opportunities_for_client || []),
  ];
  type Action = { source: "Competitors" | "Performance" | "Trends"; title: string; detail?: string; tab?: string; anchor?: string; href?: string };
  const actions: Action[] = [];
  for (const g of endorsedGaps.slice(0, 2)) actions.push({ source: "Competitors", title: g.gap, detail: g.suggested_play, href: `/clients/${report.client_id}/competitive/reports/${latestCompetitive!.id}` });
  for (const t of competitiveTakeaways.slice(0, 2)) if (actions.length < 4) actions.push({ source: "Competitors", title: t, tab: "competitive" });
  for (const r of pillarRecs.slice(0, 2)) if (actions.length < 6) actions.push({ source: "Performance", title: r, anchor: "pillars" });
  for (const o of trendOpportunities.slice(0, 2)) if (actions.length < 6) actions.push({ source: "Trends", title: o, tab: "trends" });
  const compAgg = (latestCompetitive?.report_data as any)?.aggregates;
  const compMe = compAgg?.companies?.find((c: any) => c.is_client);
  const compTotal = (compAgg?.companies || []).reduce((s: number, c: any) => s + (c.post_count || 0), 0);
  const compScore = (latestCompetitive?.report_data as any)?.ai_analysis?.benchmark_scorecard?.client_score;
  const openAction = (a: Action) => {
    if (a.href) return navigate(a.href);
    if (a.tab) return setTab(a.tab);
    if (a.anchor) document.getElementById(`report-${a.anchor}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const insights: string[] = aiAnalysis?.sprout_performance_analysis?.key_insights || [];
  const summary: string | null = aiAnalysis?.sprout_performance_analysis?.month_over_month_summary || null;
  const pillars = aiAnalysis?.sprout_performance_analysis?.pillar_alignment;

  return (
    <AppLayout title={`Report: ${clientName}`}>
      <div className="w-full space-y-6" ref={reportContentRef}>
        {/* Presentation deck. Hidden for the client role and when the deck is not ready. */}
        {!isClient && gammaUrl && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary/10">
                  <ExternalLink className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="t-body font-medium">Interactive presentation</p>
                  <p className="t-secondary">The full deck for this report, ready to share.</p>
                </div>
              </div>
              <Button onClick={() => window.open(gammaUrl, "_blank")}>
                <ExternalLink className="h-4 w-4 mr-2" /> Open presentation
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <h2 className="t-h1">{clientName}: monthly report</h2>
            <p className="t-secondary flex items-center gap-2 flex-wrap">
              <span>{rd?.report_period?.current_month?.start} to {rd?.report_period?.current_month?.end}</span>
              <span className="opacity-50">·</span>
              <span>Generated {new Date(report.created_at).toLocaleDateString()}</span>
              {rd?.context?.geo?.length > 0 && (<><span className="opacity-50">·</span><span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5" />{(Array.isArray(rd.context.geo) ? rd.context.geo : [rd.context.geo]).join(", ")}</span></>)}
              {rd?.context?.languages?.length > 0 && (<><span className="opacity-50">·</span><span className="flex items-center gap-1"><Languages className="h-3.5 w-3.5" />{(Array.isArray(rd.context.languages) ? rd.context.languages : [rd.context.languages]).join(", ")}</span></>)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ExportPdfButton contentRef={reportContentRef} filename={`${clientName}-report-${new Date(report.created_at).toISOString().slice(0, 10)}`} />
            <ReportActions report={report} />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
            <TabsTrigger value="overview" className="gap-1.5 flex-shrink-0"><BarChart3 className="h-4 w-4" /> Overview</TabsTrigger>
            {hasContent && <TabsTrigger value="content" className="gap-1.5 flex-shrink-0"><Sparkles className="h-4 w-4" /> Content Ideas</TabsTrigger>}
            {hasTrends && <TabsTrigger value="trends" className="gap-1.5 flex-shrink-0"><TrendingUp className="h-4 w-4" /> Trends</TabsTrigger>}
            <TabsTrigger value="competitive" className="gap-1.5 flex-shrink-0"><Crosshair className="h-4 w-4" /> Competitive</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW ── every original section, in its original order, plus the
              competitive strip and the actions list near the top. */}
          <TabsContent value="overview" className="space-y-8">
            {monthComparison?.changes && (
              <MetricsCards changes={monthComparison.changes} previousMonth={monthComparison.previous_month} />
            )}

            {latestCompetitive && compMe && (
              <button type="button" onClick={() => setTab("competitive")} className="w-full text-left glass-accent px-4 py-3 flex items-center justify-between gap-4 hover:bg-[rgba(185,224,69,0.12)] transition-colors">
                <span className="t-body">
                  <span className="font-semibold">Against the field:</span>{" "}
                  {compScore != null ? `benchmark ${compScore}/100` : "benchmark pending"}
                  {compTotal ? ` · ${Math.round((compMe.post_count / compTotal) * 100)}% share of voice` : ""}
                  {compMe.cadence_per_week != null ? ` · ${compMe.cadence_per_week} posts a week` : ""}
                </span>
                <span className="t-secondary flex items-center gap-1 shrink-0">Competitive <ArrowRight className="h-4 w-4" /></span>
              </button>
            )}

            {actions.length > 0 && (
              <Section title="Where to act next" description="Every recommendation in this report that asks for a decision, with the evidence one click away.">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {actions.map((a, i) => <ActionCard key={i} action={a} onOpen={() => openAction(a)} />)}
                </div>
              </Section>
            )}

            {monthComparison?.current_month && (
              <Section title="Period-over-period performance" description="Current period in green, previous period in purple.">
                <Card><CardContent className="pt-5"><PerformanceChart comparison={monthComparison} /></CardContent></Card>
              </Section>
            )}

            {platformBreakdown.length > 0 && (
              <Section title="Performance by platform" description={platformBreakdown.some((p) => p.changes) ? "How each connected account performed this period, with change against the previous period." : "How each connected account performed this period."}>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {platformBreakdown.map((p, i) => <PlatformPerformanceCard key={`${p.network}-${i}`} platform={p} />)}
                </div>
              </Section>
            )}

            {(insights.length > 0 || summary) && (
              <Section title="Key insights">
                <Card>
                  <CardContent className="pt-5 space-y-5">
                    {summary && <Clamp text={formatNumbersInText(summary)} lines={3} className="t-secondary" />}
                    {insights.length > 0 && (
                      <ol className="space-y-3">
                        {insights.map((t, i) => (
                          <li key={i} className="flex gap-3 t-body">
                            <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground t-body font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                            <span>{formatNumbersInText(t)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {aiAnalysis?.sprout_performance_analysis?.top_performing_content?.length > 0 && (
                      <div className="pt-4 border-t space-y-2">
                        <p className="t-label uppercase tracking-wider">Top performing content types</p>
                        <div className="flex flex-wrap gap-2">
                          {aiAnalysis.sprout_performance_analysis.top_performing_content.map((c: string, i: number) => <Badge key={i} variant="secondary" className="t-label">{c}</Badge>)}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Section>
            )}

            {sproutPerformance?.top_posts?.length > 0 && (
              <Section title="Top posts" description="By impressions and by engagement, with a platform filter.">
                <TopPostsSection posts={sproutPerformance.top_posts} />
              </Section>
            )}

            {pillars && (
              <div id="report-pillars">
                <Section title="Content pillar alignment" description="Which pillars the month served, and which need attention.">
                  <Card>
                    <CardContent className="pt-5 space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {pillars.well_represented?.length > 0 && (
                          <div className="space-y-2">
                            <p className="t-label uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Well represented</p>
                            <div className="flex flex-wrap gap-1.5">{pillars.well_represented.map((p: string) => <Badge key={p} variant="secondary" className="t-label">{p}</Badge>)}</div>
                          </div>
                        )}
                        {pillars.underrepresented?.length > 0 && (
                          <div className="space-y-2">
                            <p className="t-label uppercase tracking-wider flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-warning" /> Needs attention</p>
                            <div className="flex flex-wrap gap-1.5">{pillars.underrepresented.map((p: string) => <Badge key={p} variant="outline" className="t-label">{p}</Badge>)}</div>
                          </div>
                        )}
                      </div>
                      {pillarRecs.length > 0 && (
                        <div className="pt-4 border-t space-y-2">
                          <p className="t-label uppercase tracking-wider">Recommendations</p>
                          <ul className="space-y-2">
                            {pillarRecs.map((r, i) => <li key={i} className="t-body flex gap-2"><span className="text-primary">•</span><span>{r}</span></li>)}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Section>
              </div>
            )}

            {rd?.data_counts && (
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-wrap gap-6 t-secondary">
                    <span>{rd.data_counts.sprout_top_posts ?? 0} Sprout posts analyzed</span>
                    <span>{rd.data_counts.tiktok_trends ?? 0} TikTok trends</span>
                    <span>{rd.data_counts.instagram_trends ?? 0} Instagram trends</span>
                    <span>{rd.data_counts.total_recommendations ?? 0} recommendations generated</span>
                    {latestCompetitive && <span>Latest competitive analysis included</span>}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── CONTENT IDEAS ── */}
          {hasContent && (
            <TabsContent value="content" className="space-y-4">
              <ContentIdeasTab
                contentCalendar={contentCalendar}
                aiAnalysis={aiAnalysis}
                sproutPerformance={sproutPerformance}
                clientContext={clientContext}
                clientId={id}
                reportId={reportId}
                clientTimezone={rd?.context?.timezone || "UTC"}
                availablePlatforms={availablePlatforms}
                availableLanguages={availableLanguages}
              />
            </TabsContent>
          )}

          {/* ── TRENDS ── */}
          {hasTrends && (
            <TabsContent value="trends" className="space-y-10">
              <TrendsSection title="TikTok trends" analysis={aiAnalysis?.tiktok_trends_analysis} posts={tiktokTrends?.posts} platform="tiktok" clientName={clientName} />
              <TrendsSection title="Instagram trends" analysis={aiAnalysis?.instagram_trends_analysis} posts={instagramTrends?.posts} platform="instagram" clientName={clientName} />
            </TabsContent>
          )}

          {/* ── COMPETITIVE ── */}
          <TabsContent value="competitive" className="space-y-6">
            <Section title="How the field compares" description="The latest competitive analysis for this client. Endorsed gaps feed the next report's calendar.">
              <CompetitiveSnapshot clientId={report.client_id} takeaways={aiAnalysis?.competitive_takeaways} />
            </Section>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

/* ─── Layout primitives: one type scale for the whole report ─── */
function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="t-h2">{title}</h2>
          {description && <p className="t-secondary mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ActionCard({ action, onOpen }: { action: { source: string; title: string; detail?: string; href?: string }; onOpen: () => void }) {
  const icon = action.source === "Competitors" ? <Crosshair className="h-3.5 w-3.5" /> : action.source === "Trends" ? <TrendingUp className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />;
  return (
    <button type="button" onClick={onOpen} className="text-left glass-inner p-4 space-y-2 group">
      <span className="inline-flex items-center gap-1.5 t-label uppercase tracking-wider">{icon} {action.source}</span>
      <p className="t-body font-medium">{action.title}</p>
      {action.detail && <p className="t-secondary line-clamp-2">{action.detail}</p>}
      <span className="t-body text-primary inline-flex items-center gap-1 opacity-80 group-hover:opacity-100">{action.href ? "Open the competitive report" : action.source === "Performance" ? "See the pillar detail" : action.source === "Trends" ? "Open Trends" : "Open Competitive"} <ArrowRight className="h-3.5 w-3.5" /></span>
    </button>
  );
}

/* ─── Metrics Cards ─── */
function MetricsCards({ changes, previousMonth }: { changes: Record<string, any>; previousMonth?: Record<string, any> }) {
  const metrics = [
    { key: "impressions", label: "Impressions", icon: Eye },
    { key: "reactions", label: "Reactions", icon: Heart },
    { key: "link_clicks", label: "Link clicks", icon: MousePointerClick },
    { key: "video_views", label: "Video views", icon: Video },
    { key: "comments", label: "Comments", icon: MessageCircle },
    { key: "shares", label: "Shares", icon: Share2 },
  ];
  const fmt = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${(v / 1_000).toFixed(1)}K` : v.toLocaleString());
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map(({ key, label, icon: Icon }) => {
        const d = changes[key];
        if (!d) return null;
        const pct = typeof d.percent === "number" ? d.percent : 0;
        const tone = pct > 10 ? "text-success" : pct < -10 ? "text-destructive" : "text-muted-foreground";
        const prev = previousMonth?.[key];
        return (
          <Card key={key}>
            <CardContent className="pt-4 pb-4 px-4 space-y-2">
              <p className="t-label uppercase tracking-wider flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</p>
              <p className="t-stat">{fmt(Number(d.current ?? 0))}</p>
              <p className={`t-label font-medium flex items-center gap-1 ${tone}`}>
                {pct > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : pct < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                {prev != null && <span className="text-muted-foreground font-normal">vs {fmt(Number(prev))}</span>}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Performance Chart (per-metric mini bars) ─── */
function PerformanceChart({ comparison }: { comparison: any }) {
  const metrics = Object.keys(comparison.current_month || {}).map((key) => {
    const current = comparison.current_month[key] ?? 0;
    const previous = comparison.previous_month?.[key] ?? 0;
    const max = Math.max(current, previous, 1);
    return { key, label: key.replace(/_/g, " "), current, previous, max };
  });

  const fmtVal = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {metrics.map(({ key, label, current, previous, max }) => (
        <div key={key} className="space-y-2">
          <p className="t-label font-medium capitalize">{label}</p>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-5 rounded bg-[rgba(255,255,255,0.04)] overflow-hidden">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-1))]"
                  style={{ width: `${Math.max((current / max) * 100, 2)}%` }}
                />
              </div>
              <span className="t-label font-semibold w-14 text-right">{fmtVal(current)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3.5 rounded bg-[rgba(255,255,255,0.04)] overflow-hidden">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-4))] opacity-60"
                  style={{ width: `${Math.max((previous / max) * 100, 2)}%` }}
                />
              </div>
              <span className="t-secondary w-14 text-right">{fmtVal(previous)}</span>
            </div>
          </div>
        </div>
      ))}
      <div className="col-span-full flex items-center gap-4 t-secondary pt-1">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--chart-1))]" /> Current Period
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--chart-4))] opacity-60" /> Previous Period
        </span>
      </div>
    </div>
  );
}

/* ─── Post Card ─── */
function PostCard({ post, preview }: { post: any; preview?: PostPreview | null }) {
  const link = post.permalink || post.url || null;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex gap-4">
          <PostVisual
            url={link}
            preview={preview}
            image={post.image_url || post.media_url || post.thumbnail_url || null}
            mediaType={post.post_type || post.media_type || post.content_type}
            platform={post.network_type || post.platform}
            className="w-28 shrink-0"
            compact
          />
          <div className="flex-1 min-w-0 space-y-2.5">
        <div className="flex items-center justify-between">
          <PlatformBadge platform={post.network_type || post.platform} size="sm" />
          <span className="t-secondary">
            {post.posted_at && new Date(post.posted_at).toLocaleDateString()}
          </span>
        </div>
        <p className="t-body line-clamp-3">{post.text || post.content}</p>
        <div className="flex items-center gap-4 t-secondary pt-1">
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {(post.impressions ?? 0).toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-3 w-3" />
            {(post.reactions ?? post.likes ?? 0).toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            {(post.comments ?? 0).toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Share2 className="h-3 w-3" />
            {(post.shares ?? 0).toLocaleString()}
          </span>
        </div>
        {(post.permalink || post.url) && (
          <a
            href={post.permalink || post.url}
            target="_blank"
            rel="noopener"
            className="t-label text-primary hover:underline flex items-center gap-1 pt-1"
          >
            View Original <ExternalLink className="h-3 w-3" />
          </a>
        )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Per-Platform Helpers ─── */
function pick6(m: any) {
  const keys = ["impressions", "reactions", "link_clicks", "video_views", "comments", "shares"];
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = Number(m?.[k]) || 0;
  return out;
}

function engagementOf(p: any): number {
  if (typeof p?.engagement === "number") return p.engagement;
  return (p?.reactions ?? p?.likes ?? 0) + (p?.comments ?? 0) + (p?.shares ?? 0);
}

/** Canonical platform key for a Sprout post (carries platform/network_type per post). */
function postPlatformKey(post: any): string {
  return normalizePlatformKey(post?.network_type || post?.platform || post?.platform_display || "");
}

/* ─── Platform Performance Card (mirrors the aggregate MetricsCards styling) ─── */
function PlatformPerformanceCard({ platform }: { platform: any }) {
  const [more, setMore] = useState(false);
  const metrics = [
    { key: "impressions", label: "Impressions", icon: Eye },
    { key: "reactions", label: "Reactions", icon: Heart },
    { key: "link_clicks", label: "Link Clicks", icon: MousePointerClick },
    { key: "video_views", label: "Video Views", icon: Video },
    { key: "comments", label: "Comments", icon: MessageCircle },
    { key: "shares", label: "Shares", icon: Share2 },
  ];
  const cur = platform.current || {};
  const prev = platform.previous || null;
  const changes = platform.changes || null;
  const ai = platform.ai || null;
  return (
    <Card>
      <CardHeader className="pb-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <PlatformBadge platform={prettyPlatformName(platform.network)} size="sm" />
          {typeof platform.post_count === "number" && platform.post_count > 0 && (
            <span className="t-secondary whitespace-nowrap">
              {platform.post_count} {platform.post_count === 1 ? "post" : "posts"}
            </span>
          )}
        </div>
        {Array.isArray(platform.profile_names) && platform.profile_names.length > 0 && (
          <p className="t-secondary truncate">
            {platform.profile_names.join(", ")}
          </p>
        )}
        {ai?.headline && (
          <CardDescription className="leading-relaxed">
            {formatNumbersInText(ai.headline)}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          {metrics.map(({ key, label, icon: Icon }) => {
            const value = Number(cur[key] ?? 0);
            const ch = changes?.[key];
            const pct = ch?.percent;
            // A zero baseline isn't "+100% growth" — surface it as "New" instead.
            const isNew =
              ch != null && Number(ch.previous ?? prev?.[key] ?? 0) === 0 && value > 0;
            const color =
              pct == null
                ? "text-muted-foreground"
                : pct > 10
                  ? "text-success"
                  : pct < -10
                    ? "text-destructive"
                    : "text-warning";
            return (
              <div key={key} className="space-y-0.5">
                <div className="flex items-center gap-1 t-secondary">
                  <Icon className="h-3 w-3 flex-shrink-0" /> {label}
                </div>
                <p className="text-base font-bold tracking-tight">{value.toLocaleString()}</p>
                {(pct != null || isNew) &&
                  (isNew ? (
                    <div className="flex items-center gap-0.5 t-label font-medium text-success">
                      <TrendingUp className="h-2.5 w-2.5" /> New
                    </div>
                  ) : (
                    <div className={`flex items-center gap-0.5 t-label font-medium ${color}`}>
                      {pct > 0 ? (
                        <TrendingUp className="h-2.5 w-2.5" />
                      ) : pct < 0 ? (
                        <TrendingDown className="h-2.5 w-2.5" />
                      ) : (
                        <Minus className="h-2.5 w-2.5" />
                      )}
                      {pct > 0 ? "+" : ""}
                      {pct}%
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
        {Array.isArray(ai?.insights) && ai.insights.length > 0 && (
          <div className="pt-3 border-t space-y-2">
            <ul className="space-y-1.5">
              {ai.insights.slice(0, more ? 3 : 1).map((t: string, i: number) => (
                <li key={i} className="t-secondary flex gap-2">
                  <span className="text-primary flex-shrink-0">•</span>
                  <span>{formatNumbersInText(t)}</span>
                </li>
              ))}
            </ul>
            {ai.insights.length > 1 && (
              <button type="button" onClick={() => setMore((v) => !v)} className="t-body text-primary hover:underline inline-flex items-center gap-1">
                {more ? "Show less" : `${ai.insights.length - 1} more`} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Top Posts: by impressions and by engagement, platform filter ─── */
function TopPostsSection({ posts }: { posts: any[] }) {
  const platforms = useMemo(() => {
    const keys: string[] = [];
    for (const p of posts || []) {
      const k = postPlatformKey(p);
      if (k && !keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [posts]);
  const [active, setActive] = useState<string>("all");
  const effective = active !== "all" && platforms.includes(active) ? active : "all";
  const filtered = effective === "all" ? posts : posts.filter((p) => postPlatformKey(p) === effective);
  const byImpressions = [...filtered].sort((a: any, b: any) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 6);
  const byEngagement = [...filtered].sort((a: any, b: any) => engagementOf(b) - engagementOf(a)).slice(0, 6);
  const { previews } = usePostPreviews([...byImpressions, ...byEngagement].map((p: any) => p.permalink || p.url));

  return (
    <div className="space-y-8">
      {platforms.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="t-label uppercase tracking-wider">Platform</span>
          <div className="flex items-center gap-0.5 p-1 rounded-[12px] bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.07)]">
            <FilterChip active={effective === "all"} onClick={() => setActive("all")}>All</FilterChip>
            {platforms.map((k) => <PlatformFilterChip key={k} platform={prettyPlatformName(k)} active={effective === k} onClick={() => setActive(k)} />)}
          </div>
        </div>
      )}
      <div className="space-y-4">
        <h4 className="t-h3 flex items-center gap-2"><Eye className="h-4 w-4 text-[#b1b7c1]" /> Top posts by impressions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {byImpressions.map((post: any, i: number) => <PostCard key={`imp-${i}`} post={post} preview={previews[post.permalink || post.url]} />)}
        </div>
      </div>
      <div className="space-y-4">
        <h4 className="t-h3 flex items-center gap-2"><Heart className="h-4 w-4 text-[#b1b7c1]" /> Top posts by engagement</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {byEngagement.map((post: any, i: number) => <PostCard key={`eng-${i}`} post={post} preview={previews[post.permalink || post.url]} />)}
        </div>
      </div>
    </div>
  );
}

/* Chip primitives matching the calendar's Intercept "Segment" spec (subtle-white
   elevated active state — the lime primary accent is reserved for action buttons). */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-[8px] t-label font-medium tracking-[-0.2px] transition-all
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${
          active
            ? "bg-[rgba(255,255,255,0.08)] text-white backdrop-blur-sm shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.2)]"
            : "text-[#b1b7c1] hover:text-white"
        }`}
    >
      {children}
    </button>
  );
}

function PlatformFilterChip({
  active,
  platform,
  onClick,
}: {
  active: boolean;
  platform: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={platform}
      className={`px-2.5 py-1 rounded-[8px] transition-all
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${
          active
            ? "bg-[rgba(255,255,255,0.08)] backdrop-blur-sm shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.2)]"
            : ""
        }`}
    >
      <PlatformBadge platform={platform} size="sm" className={active ? "" : "opacity-60"} />
    </button>
  );
}

/* ─── Score + Formatting Helpers ─── */
function getScoreLabel(score: number, platform: string): { label: string; color: string } {
  if (platform === "tiktok") {
    if (score > 100000) return { label: "Viral", color: "text-success" };
    if (score > 50000) return { label: "High", color: "text-primary" };
    if (score > 10000) return { label: "Medium", color: "text-warning" };
    return { label: "Emerging", color: "text-muted-foreground" };
  }
  if (score > 10000) return { label: "Viral", color: "text-success" };
  if (score > 5000) return { label: "High", color: "text-primary" };
  if (score > 1000) return { label: "Medium", color: "text-warning" };
  return { label: "Emerging", color: "text-muted-foreground" };
}

function getScoreExplanation(platform: string): string {
  if (platform === "tiktok") {
    return "Score = likes + (comments \u00d7 2) + (shares \u00d7 3) + (views \u00f7 1,000)";
  }
  return "Score = likes + (comments \u00d7 2) + (views \u00f7 1,000)";
}

function formatNumbersInText(text: string): string {
  return text.replace(/(?<![,.\d])(\d{4,})(?![,.\d])/g, (match) => Number(match).toLocaleString());
}

/* ─── Trends Section (Redesigned) ─── */
function TrendsSection({
  title,
  analysis,
  posts,
  platform,
  clientName,
}: {
  title: string;
  analysis: any;
  posts: any[];
  platform: string;
  clientName?: string;
}) {
  const validPosts = (posts || []).filter((p: any) => !p._empty && p.url);
  const shown = validPosts.slice(0, 6);
  const platformColor = getPlatformColor(platform);
  const { previews } = usePostPreviews(shown.map((p: any) => p.url));
  if (!analysis && !validPosts.length) return null;
  const opportunities: string[] = analysis?.opportunities_for_client || [];
  const formats: string[] = analysis?.successful_formats || [];
  const takeaways: string[] = analysis?.key_takeaways || [];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-3 pb-4 border-b">
        <div className="h-11 w-11 rounded-[12px] flex items-center justify-center shrink-0" style={{ backgroundColor: `${platformColor}22` }}>
          <PlatformIcon platform={platform} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="t-h3">{title}</h3>
          {analysis?.overview && <Clamp text={analysis.overview} lines={3} className="t-secondary mt-1" />}
        </div>
      </div>

      {(analysis?.top_themes?.length > 0 || analysis?.top_hashtags?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {analysis.top_themes?.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="t-h3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[#b1b7c1]" /> Top themes</CardTitle></CardHeader>
              <CardContent><div className="flex flex-wrap gap-2">{analysis.top_themes.map((t: string, i: number) => <Badge key={t} variant="secondary" className="px-3 py-1 t-body"><span className="mr-1.5 t-badge text-[#b1b7c1]">{i + 1}</span>{t}</Badge>)}</div></CardContent>
            </Card>
          )}
          {analysis.top_hashtags?.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="t-h3 flex items-center gap-2"><span className="text-[18px]">#</span> Trending hashtags</CardTitle></CardHeader>
              <CardContent><div className="flex flex-wrap gap-2">{analysis.top_hashtags.map((h: string) => <Badge key={h} variant="outline" className="px-3 py-1 t-body">{h.startsWith("#") ? h : `#${h}`}</Badge>)}</div></CardContent>
            </Card>
          )}
        </div>
      )}

      {formats.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="t-h3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#b1b7c1]" /> What is working</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {formats.map((f, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[rgba(255,255,255,0.03)]">
                  <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary t-badge flex items-center justify-center mt-0.5">{i + 1}</span>
                  <p className="t-body">{f}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {opportunities.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-3"><CardTitle className="t-h3 flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Opportunities for {clientName || "your brand"}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {opportunities.map((o, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background border">
                  <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground t-badge flex items-center justify-center mt-0.5">{i + 1}</span>
                  <p className="t-body pt-0.5">{o}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {takeaways.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="t-h3 flex items-center gap-2"><Lightbulb className="h-4 w-4 text-warning" /> Key takeaways</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {takeaways.map((t, i) => (
                <div key={i} className="flex items-start gap-3 p-2">
                  <span className="flex-shrink-0 mt-1 text-warning">✦</span>
                  <p className="t-body">{t}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {shown.length > 0 && (
        <div className="space-y-4">
          <h4 className="t-h3">Trending posts</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shown.map((post: any, i: number) => {
              const sl = post.engagement_score != null ? getScoreLabel(post.engagement_score, platform) : null;
              return (
                <Card key={i} className="overflow-hidden">
                  <CardContent className="pt-5">
                    <div className="flex gap-4">
                      <PostVisual url={post.url} preview={previews[post.url]} mediaType={post.type || (platform.toLowerCase().includes("tiktok") ? "video" : null)} platform={platform} className="w-32 shrink-0" compact />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-8 w-8 rounded-full flex items-center justify-center t-badge shrink-0" style={{ backgroundColor: `${platformColor}22`, color: platformColor }}>{(post.author || "?")[0]?.toUpperCase()}</div>
                            <span className="t-body font-medium truncate">@{post.author}</span>
                          </div>
                          {sl && <Badge variant="outline" className="t-label shrink-0" style={{ color: sl.color, borderColor: `${sl.color}55` }} title={getScoreExplanation(platform)}>Score: {Number(post.engagement_score).toLocaleString()} {sl.label}</Badge>}
                        </div>
                        <p className="t-body line-clamp-4">{post.caption}</p>
                        {Array.isArray(post.hashtags) && post.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">{post.hashtags.slice(0, 6).map((h: string) => <span key={h} className="t-label !text-primary">{h.startsWith("#") ? h : `#${h}`}</span>)}</div>
                        )}
                        <div className="flex items-center gap-4 t-secondary">
                          {post.views != null && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{Number(post.views).toLocaleString()}</span>}
                          {post.likes != null && <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{Number(post.likes).toLocaleString()}</span>}
                          {post.comments != null && <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{Number(post.comments).toLocaleString()}</span>}
                          {post.shares != null && <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />{Number(post.shares).toLocaleString()}</span>}
                          <a href={post.url} target="_blank" rel="noopener" className="ml-auto text-primary hover:underline flex items-center gap-1">View <ExternalLink className="h-3.5 w-3.5" /></a>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
