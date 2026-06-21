import { useParams } from "react-router-dom";
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
import { useRef } from "react";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { useAuth } from "@/hooks/useAuth";
import { ReportActions } from "@/components/reports/ReportActions";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";
import {
  parseCsv,
  stripVoicePreset,
  type ClientContext,
  type ContentPillar,
} from "@/lib/clientContext";

export default function ReportView() {
  const { id, reportId } = useParams();
  const reportContentRef = useRef<HTMLDivElement>(null);
  useRealtimeReports(id);
  const { isClient } = useAuth();

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
  // Prefer the rich `platform_breakdown` (with month-over-month) from the workflow;
  // fall back to the current-only `platform_metrics` object if that's all we have.
  const platformBreakdown: any[] = (() => {
    const provided = sproutPerformance?.platform_breakdown;
    if (Array.isArray(provided) && provided.length > 0) return provided;
    const pm = sproutPerformance?.platform_metrics || {};
    return Object.entries(pm)
      .map(([network, m]: [string, any]) => ({
        network,
        current: pick6(m),
        previous: null,
        changes: null,
        post_count: m?.post_count ?? 0,
        profile_names: m?.profile_names ?? (m?.profile_name ? [m.profile_name] : []),
      }))
      .sort((a, b) => (b.current.impressions || 0) - (a.current.impressions || 0));
  })();

  // Optional AI-written per-platform commentary (only present on newer reports).
  const aiPlatformInsights: any[] = Array.isArray(
    aiAnalysis?.sprout_performance_analysis?.platform_breakdown,
  )
    ? aiAnalysis.sprout_performance_analysis.platform_breakdown
    : [];

  // Top posts grouped by platform — prefer workflow-provided grouping, else group
  // the flat cross-platform list client-side (so existing reports get this too).
  const providedTPBP = sproutPerformance?.top_posts_by_platform;
  const topPostsByPlatform: Record<string, any[]> =
    providedTPBP && typeof providedTPBP === "object" && Object.keys(providedTPBP).length > 0
      ? providedTPBP
      : groupPostsByPlatform(sproutPerformance?.top_posts || []);

  const postsForPlatform = (network: string): any[] => {
    if (topPostsByPlatform[network]) return topPostsByPlatform[network];
    const nk = normalizePlatformKey(network);
    const hit = Object.entries(topPostsByPlatform).find(([k]) => normalizePlatformKey(k) === nk);
    return hit ? hit[1] : [];
  };

  // Ordered platform list (by impressions when a breakdown exists, else group order),
  // limited to platforms that actually have posts to show.
  const topPostPlatforms = (
    platformBreakdown.length > 0
      ? platformBreakdown.map((p) => p.network)
      : Object.keys(topPostsByPlatform)
  ).filter((network) => postsForPlatform(network).length > 0);

  const hasPerPlatformPosts = topPostPlatforms.length > 0;

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

  // Build available tabs
  const tabs: { value: string; label: string; icon: React.ReactNode }[] = [
    { value: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  ];
  if (aiAnalysis?.content_recommendations?.length > 0 || contentCalendar.length > 0) {
    tabs.push({ value: "content", label: "Content Ideas", icon: <Sparkles className="h-4 w-4" /> });
  }
  if (
    aiAnalysis?.tiktok_trends_analysis ||
    tiktokTrends?.posts?.length ||
    aiAnalysis?.instagram_trends_analysis ||
    instagramTrends?.posts?.length
  ) {
    tabs.push({ value: "trends", label: "Trends", icon: <TrendingUp className="h-4 w-4" /> });
  }

  const gammaUrl = report.gamma_url || rd?.gamma_url;

  return (
    <AppLayout title={`Report: ${clientName}`}>
      <div className="w-full mx-auto px-4 lg:px-6 space-y-6" ref={reportContentRef}>
        {/* Presentation Deck Banner — only when a gamma URL exists.
            Hidden for client role and when the deck isn't ready. */}
        {!isClient && gammaUrl && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary/10">
                  <ExternalLink className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Interactive Presentation</p>
                  <p className="text-sm text-muted-foreground">
                    View the full interactive presentation
                  </p>
                </div>
              </div>
              <Button onClick={() => window.open(gammaUrl, "_blank")}>
                <ExternalLink className="h-4 w-4 mr-2" /> Open Presentation
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">{clientName} Report</h2>
            <p className="text-sm text-muted-foreground">
              {rd?.report_period?.current_month?.start} — {rd?.report_period?.current_month?.end}
              {" · "}Generated {new Date(report.created_at).toLocaleDateString()}
            </p>
            {(rd?.context?.languages?.length > 0 || rd?.context?.geo?.length > 0) && (
              <div className="flex items-center gap-2 mt-1">
                {rd?.context?.geo?.length > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {(Array.isArray(rd.context.geo) ? rd.context.geo : [rd.context.geo]).join(", ")}
                  </span>
                )}
                {rd?.context?.languages?.length > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Languages className="h-3 w-3" />
                    {(Array.isArray(rd.context.languages) ? rd.context.languages : [rd.context.languages]).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ExportPdfButton
              contentRef={reportContentRef}
              filename={`${clientName}-report-${new Date(report.created_at).toISOString().slice(0, 10)}`}
            />
            <ReportActions report={report} />
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5 flex-shrink-0">
                {t.icon} {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-8">
            {/* Metrics */}
            {monthComparison?.changes && (
              <MetricsCards changes={monthComparison.changes} previousMonth={monthComparison.previous_month} />
            )}

            {/* Chart */}
            {monthComparison?.current_month && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Period-over-Period Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PerformanceChart comparison={monthComparison} />
                </CardContent>
              </Card>
            )}

            {/* Performance by Platform */}
            {platformBreakdown.length > 0 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" /> Performance by Platform
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    How each connected account performed this period
                    {platformBreakdown.some((p) => p.changes)
                      ? ", with change vs. the previous period"
                      : ""}
                    .
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {platformBreakdown.map((p) => (
                    <PlatformPerformanceCard key={p.network} platform={p} />
                  ))}
                </div>
              </div>
            )}

            {/* AI Platform Insights */}
            {aiPlatformInsights.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {aiPlatformInsights.map((pi: any, idx: number) => (
                  <Card key={idx}>
                    <CardHeader className="pb-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={prettyPlatformName(pi.platform)} size="sm" />
                      </div>
                      {pi.headline && (
                        <CardDescription className="leading-relaxed">
                          {formatNumbersInText(pi.headline)}
                        </CardDescription>
                      )}
                    </CardHeader>
                    {Array.isArray(pi.insights) && pi.insights.length > 0 && (
                      <CardContent>
                        <ul className="space-y-1.5">
                          {pi.insights.map((t: string, i: number) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-muted-foreground flex gap-2"
                            >
                              <span className="text-primary flex-shrink-0">•</span>
                              <span>{formatNumbersInText(t)}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* Performance Insights */}
            {aiAnalysis?.sprout_performance_analysis?.key_insights?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-warning" /> Key Insights
                  </CardTitle>
                  {aiAnalysis.sprout_performance_analysis.month_over_month_summary && (
                    <CardDescription className="leading-relaxed">
                      {formatNumbersInText(aiAnalysis.sprout_performance_analysis.month_over_month_summary)}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {aiAnalysis.sprout_performance_analysis.key_insights.map((insight: string, i: number) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span>{formatNumbersInText(insight)}</span>
                      </li>
                    ))}
                  </ul>
                  {aiAnalysis.sprout_performance_analysis.top_performing_content?.length > 0 && (
                    <div className="mt-5 pt-4 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Top Performing Content Types</p>
                      <div className="flex flex-wrap gap-2">
                        {aiAnalysis.sprout_performance_analysis.top_performing_content.map((c: string, i: number) => (
                          <Badge key={i} variant="secondary">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Top Posts — grouped per platform (falls back to cross-platform ranking) */}
            {hasPerPlatformPosts ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <Heart className="h-4 w-4 text-muted-foreground" /> Top Posts by Platform
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Best-performing posts from each connected account, ranked by engagement.
                  </p>
                </div>
                {topPostPlatforms.map((network) => {
                  const posts = [...postsForPlatform(network)]
                    .sort((a: any, b: any) => engagementOf(b) - engagementOf(a))
                    .slice(0, 4);
                  return (
                    <div key={network} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={prettyPlatformName(network)} size="sm" />
                        <span className="text-xs text-muted-foreground">
                          {posts.length} top {posts.length === 1 ? "post" : "posts"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {posts.map((post: any, i: number) => (
                          <PostCard key={`${network}-${i}`} post={post} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              sproutPerformance?.top_posts?.length > 0 &&
              (() => {
                const posts = [...sproutPerformance.top_posts];
                const byImpressions = [...posts]
                  .sort((a: any, b: any) => (b.impressions ?? 0) - (a.impressions ?? 0))
                  .slice(0, 4);
                const byEngagement = [...posts]
                  .sort((a: any, b: any) => engagementOf(b) - engagementOf(a))
                  .slice(0, 4);
                return (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Eye className="h-4 w-4 text-muted-foreground" /> Top Posts by Impressions
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {byImpressions.map((post: any, i: number) => (
                          <PostCard key={`imp-${i}`} post={post} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Heart className="h-4 w-4 text-muted-foreground" /> Top Posts by Engagement
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {byEngagement.map((post: any, i: number) => (
                          <PostCard key={`eng-${i}`} post={post} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()
            )}

            {/* Pillar Alignment */}
            {aiAnalysis?.sprout_performance_analysis?.pillar_alignment && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" /> Content Pillar Alignment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {aiAnalysis.sprout_performance_analysis.pillar_alignment.well_represented?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-success" /> Well Represented
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {aiAnalysis.sprout_performance_analysis.pillar_alignment.well_represented.map((p: string) => (
                            <Badge key={p} variant="secondary">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                          <AlertCircle className="h-4 w-4 text-warning" /> Needs Attention
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented.map((p: string) => (
                            <Badge key={p} variant="outline">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations?.length > 0 && (
                    <div className="pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Recommendations</p>
                      <ul className="space-y-1.5">
                        {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations.map(
                          (r: string, i: number) => (
                            <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                              • {r}
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Data Sources */}
            {rd?.data_counts && (
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
                    <span>{rd.data_counts.sprout_top_posts ?? 0} Sprout posts analyzed</span>
                    <span>{rd.data_counts.tiktok_trends ?? 0} TikTok trends</span>
                    <span>{rd.data_counts.instagram_trends ?? 0} Instagram trends</span>
                    <span>{rd.data_counts.total_recommendations ?? 0} recommendations generated</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── CONTENT IDEAS TAB ── */}
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

          {/* ── TRENDS TAB ── */}
          <TabsContent value="trends" className="space-y-8">
            <TrendsSection
              title="TikTok Trends"
              analysis={aiAnalysis?.tiktok_trends_analysis}
              posts={tiktokTrends?.posts}
              platform="tiktok"
            />
            <TrendsSection
              title="Instagram Trends"
              analysis={aiAnalysis?.instagram_trends_analysis}
              posts={instagramTrends?.posts}
              platform="instagram"
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

/* ─── Metrics Cards ─── */
function MetricsCards({
  changes,
  previousMonth,
}: {
  changes: Record<string, any>;
  previousMonth?: Record<string, any>;
}) {
  const metrics = [
    { key: "impressions", label: "Impressions", icon: Eye },
    { key: "reactions", label: "Reactions", icon: Heart },
    { key: "link_clicks", label: "Link Clicks", icon: MousePointerClick },
    { key: "video_views", label: "Video Views", icon: Video },
    { key: "comments", label: "Comments", icon: MessageCircle },
    { key: "shares", label: "Shares", icon: Share2 },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map(({ key, label, icon: Icon }) => {
        const d = changes[key];
        if (!d) return null;
        const pct = d.percent ?? 0;
        const color = pct > 10 ? "text-success" : pct < -10 ? "text-destructive" : "text-warning";
        const prevValue = previousMonth?.[key];
        return (
          <Card key={key}>
            <CardContent className="pt-4 pb-3 px-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <p className="text-xl font-bold tracking-tight">{(d.current ?? 0).toLocaleString()}</p>
              {prevValue != null && <p className="text-xs text-muted-foreground">prev: {prevValue.toLocaleString()}</p>}
              <div className={`flex items-center gap-1 text-xs font-medium ${color}`}>
                {pct > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : pct < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                {pct > 0 ? "+" : ""}
                {pct}%
              </div>
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
          <p className="text-xs font-medium text-muted-foreground capitalize">{label}</p>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-5 rounded bg-[rgba(255,255,255,0.04)] overflow-hidden">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-1))]"
                  style={{ width: `${Math.max((current / max) * 100, 2)}%` }}
                />
              </div>
              <span className="text-xs font-semibold w-14 text-right">{fmtVal(current)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3.5 rounded bg-[rgba(255,255,255,0.04)] overflow-hidden">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-4))] opacity-60"
                  style={{ width: `${Math.max((previous / max) * 100, 2)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-14 text-right">{fmtVal(previous)}</span>
            </div>
          </div>
        </div>
      ))}
      <div className="col-span-full flex items-center gap-4 text-xs text-muted-foreground pt-1">
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
function PostCard({ post }: { post: any }) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-2.5">
        <div className="flex items-center justify-between">
          <PlatformBadge platform={post.network_type || post.platform} size="sm" />
          <span className="text-xs text-muted-foreground">
            {post.posted_at && new Date(post.posted_at).toLocaleDateString()}
          </span>
        </div>
        <p className="text-sm leading-relaxed line-clamp-3">{post.text || post.content}</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
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
            className="text-xs text-primary hover:underline flex items-center gap-1 pt-1"
          >
            View Original <ExternalLink className="h-3 w-3" />
          </a>
        )}
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

function groupPostsByPlatform(posts: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  for (const post of posts || []) {
    const raw = post?.platform_display || post?.network_type || post?.platform || "";
    const name = prettyPlatformName(raw);
    if (!name) continue;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(post);
  }
  return grouped;
}

/* ─── Platform Performance Card ─── */
function PlatformPerformanceCard({ platform }: { platform: any }) {
  const metrics = [
    { key: "impressions", label: "Impressions", icon: Eye },
    { key: "reactions", label: "Reactions", icon: Heart },
    { key: "comments", label: "Comments", icon: MessageCircle },
    { key: "shares", label: "Shares", icon: Share2 },
    { key: "link_clicks", label: "Link Clicks", icon: MousePointerClick },
    { key: "video_views", label: "Video Views", icon: Video },
  ];
  const cur = platform.current || {};
  const changes = platform.changes || null;
  return (
    <Card>
      <CardHeader className="pb-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <PlatformBadge platform={prettyPlatformName(platform.network)} size="sm" />
          {typeof platform.post_count === "number" && platform.post_count > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {platform.post_count} {platform.post_count === 1 ? "post" : "posts"}
            </span>
          )}
        </div>
        {Array.isArray(platform.profile_names) && platform.profile_names.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {platform.profile_names.join(", ")}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          {metrics.map(({ key, label, icon: Icon }) => {
            const value = Number(cur[key] ?? 0);
            const ch = changes?.[key];
            const pct = ch?.percent;
            // A zero baseline isn't "+100% growth" — surface it as "New" instead.
            const isNew = ch != null && Number(ch.previous ?? 0) === 0 && Number(ch.current ?? value) > 0;
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
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Icon className="h-3 w-3 flex-shrink-0" /> {label}
                </div>
                <p className="text-sm font-semibold tracking-tight">{value.toLocaleString()}</p>
                {pct != null &&
                  (isNew ? (
                    <div className="flex items-center gap-0.5 text-[11px] font-medium text-success">
                      <TrendingUp className="h-2.5 w-2.5" /> New
                    </div>
                  ) : (
                    <div className={`flex items-center gap-0.5 text-[11px] font-medium ${color}`}>
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
      </CardContent>
    </Card>
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
}: {
  title: string;
  analysis: any;
  posts: any[];
  platform: string;
}) {
  if (!analysis && !posts?.length) return null;
  const validPosts = (posts || []).filter((p: any) => !p._empty && p.url);
  const platformColor = getPlatformColor(platform);

  return (
    <div className="space-y-6">
      {/* Platform Header */}
      <div className="flex items-center gap-3 pb-2 border-b">
        <div
          className="h-10 w-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${platformColor}15` }}
        >
          <PlatformIcon platform={platform} className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {analysis?.overview && <p className="text-sm text-muted-foreground line-clamp-1">{analysis.overview}</p>}
        </div>
      </div>

      {/* Overview */}
      {analysis?.overview && (
        <Card className="border-l-4" style={{ borderLeftColor: platformColor }}>
          <CardContent className="pt-5">
            <p className="text-sm leading-relaxed">{analysis.overview}</p>
          </CardContent>
        </Card>
      )}

      {/* Themes & Hashtags Row */}
      {(analysis?.top_themes?.length > 0 || analysis?.top_hashtags?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {analysis.top_themes?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Top Themes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {analysis.top_themes.map((t: string, i: number) => (
                    <Badge key={t} variant="secondary" className="px-3 py-1 text-sm">
                      <span className="mr-1.5 text-xs font-bold text-muted-foreground">{i + 1}</span>
                      {t}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {analysis.top_hashtags?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <span className="text-base">#</span> Trending Hashtags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {analysis.top_hashtags.map((h: string) => (
                    <Badge key={h} variant="outline" className="px-3 py-1 text-sm font-mono">
                      {h.startsWith('#') ? h : `#${h}`}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Successful Formats */}
      {analysis?.successful_formats?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> What's Working
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {analysis.successful_formats.map((f: string, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[rgba(255,255,255,0.03)]">
                  <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed">{f}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Opportunities */}
      {analysis?.opportunities_for_client?.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Opportunities for Your Brand
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.opportunities_for_client.map((o: string, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background border">
                  <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed pt-1">{o}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Takeaways */}
      {analysis?.key_takeaways?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-warning" /> Key Takeaways
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analysis.key_takeaways.map((t: string, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2">
                  <span className="flex-shrink-0 mt-0.5 text-warning">✦</span>
                  <p className="text-sm leading-relaxed">{t}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trending Posts Grid */}
      {validPosts.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Trending Posts</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {validPosts.slice(0, 6).map((post: any, i: number) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ backgroundColor: `${platformColor}15`, color: platformColor }}
                      >
                        {(post.author || "?")[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">@{post.author}</span>
                    </div>
                    {post.engagement_score != null &&
                      (() => {
                        const sl = getScoreLabel(post.engagement_score, platform);
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="text-xs cursor-help">
                                Score: {post.engagement_score.toLocaleString()}{" "}
                                <span className={`ml-1 ${sl.color}`}>{sl.label}</span>
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              <p className="font-medium mb-1">{getScoreExplanation(platform)}</p>
                              <p className="text-muted-foreground">
                                Scores are platform-relative. {platform === "tiktok" ? "TikTok" : "Instagram"}{" "}
                                thresholds differ due to typical engagement volumes.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                  </div>
                  <p className="text-sm leading-relaxed line-clamp-3">{post.caption}</p>
                  {post.hashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {post.hashtags.slice(0, 5).map((h: string) => (
                        <span key={h} className="text-xs text-primary font-mono">
                          {h.startsWith('#') ? h : `#${h}`}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                    {post.views != null && (
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" /> {post.views.toLocaleString()}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" /> {(post.likes ?? 0).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" /> {(post.comments ?? 0).toLocaleString()}
                    </span>
                    {post.url && (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener"
                        className="ml-auto text-primary hover:underline flex items-center gap-1"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
