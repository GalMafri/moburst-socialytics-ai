import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PlatformBadge } from "@/lib/platform-config";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  MousePointerClick,
  Video,
  Lightbulb,
  Target,
  Hash,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Sparkles,
  Calendar,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useState, useMemo } from "react";

export default function Analytics() {
  const { id: paramId } = useParams();
  const navigate = useNavigate();
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(paramId);

  const { data: clients } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Auto-select first client if none selected
  const clientId = selectedClientId || clients?.[0]?.id;

  const { data: reports, isLoading } = useQuery({
    queryKey: ["analytics-reports", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("client_id", clientId!)
        .eq("status", "completed")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const clientName = clients?.find((c) => c.id === clientId)?.name || "Client";

  // Parse all report data
  const parsedReports = useMemo(() => {
    if (!reports) return [];
    return reports.map((r) => {
      const rd = Array.isArray(r.report_data) ? (r.report_data as any)[0] : (r.report_data as any);
      return { ...r, rd };
    });
  }, [reports]);

  if (!clients) {
    return (
      <AppLayout title="Analytics">
        <p className="text-muted-foreground p-8">Loading...</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Analytics">
      <div className="space-y-6 p-4 md:p-8 max-w-7xl mx-auto">
        {/* Header with client selector */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Cross-report insights and trend analysis
            </p>
          </div>
          <Select value={clientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Loading reports...</p>
        ) : parsedReports.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground mb-4">No completed reports for {clientName} yet.</p>
            {clientId && (
              <Button onClick={() => navigate(`/clients/${clientId}/analyze`)}>
                Run first analysis
              </Button>
            )}
          </Card>
        ) : (
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
              <TabsTrigger value="content">Content Strategy</TabsTrigger>
              <TabsTrigger value="insights">AI Insights</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewTab reports={parsedReports} clientName={clientName} />
            </TabsContent>
            <TabsContent value="performance">
              <PerformanceTab reports={parsedReports} />
            </TabsContent>
            <TabsContent value="trends">
              <TrendsTab reports={parsedReports} />
            </TabsContent>
            <TabsContent value="content">
              <ContentStrategyTab reports={parsedReports} />
            </TabsContent>
            <TabsContent value="insights">
              <AIInsightsTab reports={parsedReports} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

/* ─── Helper ─── */
function formatNum(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

function ChangeIndicator({ value, suffix = "%" }: { value: number; suffix?: string }) {
  if (value > 0) return <span className="text-emerald-500 flex items-center gap-0.5 text-xs font-medium"><ArrowUpRight className="h-3 w-3" />{value}{suffix}</span>;
  if (value < 0) return <span className="text-destructive flex items-center gap-0.5 text-xs font-medium"><ArrowDownRight className="h-3 w-3" />{Math.abs(value)}{suffix}</span>;
  return <span className="text-muted-foreground text-xs">0{suffix}</span>;
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

/* ─── Overview Tab ─── */
function OverviewTab({ reports, clientName }: { reports: any[]; clientName: string }) {
  const latest = reports[reports.length - 1];
  const prev = reports.length >= 2 ? reports[reports.length - 2] : null;
  const latestPerf = latest.rd?.sprout_performance?.month_comparison;
  const currentMetrics = latestPerf?.current_month || {};
  const changes = latestPerf?.changes || {};

  const metrics = [
    { label: "Impressions", value: currentMetrics.impressions || 0, change: changes.impressions?.percent || 0, icon: Eye },
    { label: "Reactions", value: currentMetrics.reactions || 0, change: changes.reactions?.percent || 0, icon: Heart },
    { label: "Link Clicks", value: currentMetrics.link_clicks || 0, change: changes.link_clicks?.percent || 0, icon: MousePointerClick },
    { label: "Video Views", value: currentMetrics.video_views || 0, change: changes.video_views?.percent || 0, icon: Video },
    { label: "Comments", value: currentMetrics.comments || 0, change: changes.comments?.percent || 0, icon: MessageCircle },
    { label: "Shares", value: currentMetrics.shares || 0, change: changes.shares?.percent || 0, icon: Share2 },
  ];

  // Performance timeline for sparkline
  const timeline = reports.map((r) => {
    const c = r.rd?.sprout_performance?.month_comparison?.current_month || {};
    return {
      date: new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      impressions: c.impressions || 0,
      reactions: c.reactions || 0,
    };
  });

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <m.icon className="h-3.5 w-3.5" />
                <span className="text-xs">{m.label}</span>
              </div>
              <div className="text-lg font-bold text-foreground">{formatNum(m.value)}</div>
              <ChangeIndicator value={m.change} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Mini timeline */}
      {timeline.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Performance Timeline</CardTitle>
            <CardDescription>Impressions & reactions across {reports.length} reports</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis tickFormatter={formatNum} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }}
                  formatter={(v: number) => [formatNum(v), undefined]}
                />
                <Legend />
                <Line type="monotone" dataKey="impressions" name="Impressions" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="reactions" name="Reactions" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Quick insight from latest MoM summary */}
      {latestPerf?.summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4" /> Latest MoM Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {latestPerf.summary.map((s: string, i: number) => (
                <Badge key={i} variant={s.includes("↓") ? "destructive" : s.includes("↑") ? "default" : "secondary"} className="text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Report count info */}
      <div className="text-xs text-muted-foreground">
        Analyzing {reports.length} completed report{reports.length !== 1 ? "s" : ""} for {clientName} · Latest: {new Date(latest.created_at).toLocaleDateString()}
      </div>
    </div>
  );
}

/* ─── Performance Tab ─── */
function PerformanceTab({ reports }: { reports: any[] }) {
  const performanceData = reports.map((r) => {
    const current = r.rd?.sprout_performance?.month_comparison?.current_month || {};
    const changes = r.rd?.sprout_performance?.month_comparison?.changes || {};
    return {
      date: new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      impressions: current.impressions || 0,
      reactions: current.reactions || 0,
      link_clicks: current.link_clicks || 0,
      video_views: current.video_views || 0,
      comments: current.comments || 0,
      shares: current.shares || 0,
      impressions_pct: changes.impressions?.percent || 0,
      reactions_pct: changes.reactions?.percent || 0,
      link_clicks_pct: changes.link_clicks?.percent || 0,
      video_views_pct: changes.video_views?.percent || 0,
    };
  });

  // Platform breakdown from top performing content analysis
  const latestAnalysis = reports[reports.length - 1].rd?.ai_analysis?.sprout_performance_analysis;
  const topContent = latestAnalysis?.top_performing_content || [];

  return (
    <div className="space-y-6">
      {/* Engagement Metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Engagement Metrics Over Time</CardTitle>
          <CardDescription>Absolute values across report periods</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis tickFormatter={formatNum} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }}
                formatter={(v: number) => [v.toLocaleString(), undefined]}
              />
              <Legend />
              <Line type="monotone" dataKey="impressions" name="Impressions" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="reactions" name="Reactions" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="link_clicks" name="Link Clicks" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="video_views" name="Video Views" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* MoM % Changes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Month-over-Month Change (%)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis tickFormatter={(v: number) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }}
                formatter={(v: number) => [`${v}%`, undefined]}
              />
              <Legend />
              <Bar dataKey="impressions_pct" name="Impressions %" fill={CHART_COLORS[0]} />
              <Bar dataKey="reactions_pct" name="Reactions %" fill={CHART_COLORS[1]} />
              <Bar dataKey="link_clicks_pct" name="Clicks %" fill={CHART_COLORS[2]} />
              <Bar dataKey="video_views_pct" name="Video %" fill={CHART_COLORS[3]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Performing Content insights */}
      {topContent.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" /> Top Performing Content (Latest Report)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topContent.map((item: string, i: number) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <Badge variant="secondary" className="mt-0.5 shrink-0">{i + 1}</Badge>
                <span className="text-foreground">{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Trends Tab ─── */
function TrendsTab({ reports }: { reports: any[] }) {
  const trendsTimeline = reports.map((r) => {
    const tiktok = r.rd?.tiktok_trends?.posts || [];
    const instagram = r.rd?.instagram_trends?.posts || [];
    return {
      date: new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      tiktok_count: tiktok.filter((p: any) => !p._empty).length,
      ig_count: instagram.filter((p: any) => !p._empty).length,
      avg_tiktok: tiktok.length > 0
        ? Math.round(tiktok.reduce((s: number, p: any) => s + (p.engagement_score || 0), 0) / tiktok.length)
        : 0,
      avg_ig: instagram.length > 0
        ? Math.round(instagram.reduce((s: number, p: any) => s + (p.engagement_score || 0), 0) / instagram.length)
        : 0,
    };
  });

  // Aggregate top hashtags across all reports
  const hashtagCounts: Record<string, number> = {};
  reports.forEach((r) => {
    const tiktok = r.rd?.tiktok_trends?.posts || [];
    const instagram = r.rd?.instagram_trends?.posts || [];
    [...tiktok, ...instagram].forEach((p: any) => {
      (p.hashtags || []).forEach((h: string) => {
        const tag = h.toLowerCase().replace(/^#/, "");
        hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
      });
    });
  });
  const topHashtags = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Latest trend analyses
  const latestRd = reports[reports.length - 1].rd;
  const tiktokAnalysis = latestRd?.ai_analysis?.tiktok_trends_analysis;
  const igAnalysis = latestRd?.ai_analysis?.instagram_trends_analysis;

  // Curated top trends from latest report
  const topTikTokTrends = (latestRd?.tiktok_trends?.posts || [])
    .filter((p: any) => !p._empty)
    .slice(0, 5);
  const topIgTrends = (latestRd?.instagram_trends?.posts || [])
    .filter((p: any) => !p._empty)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Trend volume over time */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Trend Volume Over Time</CardTitle>
          <CardDescription>Number of trends captured per report</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={trendsTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} />
              <Legend />
              <Bar dataKey="tiktok_count" name="TikTok Trends" fill={CHART_COLORS[0]} />
              <Bar dataKey="ig_count" name="Instagram Trends" fill={CHART_COLORS[2]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Avg Engagement Over Time */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Average Trend Engagement Score</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendsTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis tickFormatter={formatNum} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(v: number) => [formatNum(v), undefined]} />
              <Legend />
              <Line type="monotone" dataKey="avg_tiktok" name="Avg TikTok Engagement" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="avg_ig" name="Avg Instagram Engagement" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Recurring hashtags */}
      {topHashtags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="h-4 w-4" /> Most Recurring Hashtags (All Reports)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {topHashtags.map(([tag, count]) => (
                <Badge key={tag} variant="outline" className="text-xs gap-1">
                  #{tag} <span className="text-muted-foreground">×{count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Curated top trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {topTikTokTrends.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <PlatformBadge platform="TikTok" size="sm" /> Top TikTok Trends (Latest)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {topTikTokTrends.map((t: any, i: number) => (
                <div key={i} className="border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">@{t.author}</span>
                    <Badge variant="secondary" className="text-xs">{formatNum(t.engagement_score || 0)} eng</Badge>
                  </div>
                  <p className="text-xs text-foreground line-clamp-2">{t.caption}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>{formatNum(t.views || 0)} views</span>
                    <span>{formatNum(t.likes || 0)} likes</span>
                    <span>{formatNum(t.comments || 0)} comments</span>
                  </div>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {topIgTrends.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <PlatformBadge platform="Instagram" size="sm" /> Top Instagram Trends (Latest)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {topIgTrends.map((t: any, i: number) => (
                <div key={i} className="border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">@{t.author}</span>
                    <Badge variant="secondary" className="text-xs">{formatNum(t.engagement_score || 0)} eng</Badge>
                  </div>
                  <p className="text-xs text-foreground line-clamp-2">{t.caption}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>{t.type}</span>
                    <span>{formatNum(t.likes || 0)} likes</span>
                    <span>{formatNum(t.comments || 0)} comments</span>
                  </div>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Platform trend analyses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {tiktokAnalysis && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">TikTok Trends Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{tiktokAnalysis.overview}</p>
              {tiktokAnalysis.top_themes && (
                <>
                  <p className="text-xs font-medium text-foreground mt-2">Top Themes:</p>
                  <ul className="space-y-1">
                    {tiktokAnalysis.top_themes.slice(0, 4).map((t: string, i: number) => (
                      <li key={i} className="text-xs text-foreground flex gap-2">
                        <span className="text-primary shrink-0">•</span>{t}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tiktokAnalysis.opportunities_for_client && (
                <>
                  <p className="text-xs font-medium text-foreground mt-2">Opportunities:</p>
                  <ul className="space-y-1">
                    {tiktokAnalysis.opportunities_for_client.map((o: string, i: number) => (
                      <li key={i} className="text-xs text-foreground flex gap-2">
                        <span className="text-emerald-500 shrink-0">→</span>{o}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {igAnalysis && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Instagram Trends Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{igAnalysis.overview}</p>
              {igAnalysis.top_themes && (
                <>
                  <p className="text-xs font-medium text-foreground mt-2">Top Themes:</p>
                  <ul className="space-y-1">
                    {igAnalysis.top_themes.slice(0, 4).map((t: string, i: number) => (
                      <li key={i} className="text-xs text-foreground flex gap-2">
                        <span className="text-primary shrink-0">•</span>{t}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {igAnalysis.opportunities_for_client && (
                <>
                  <p className="text-xs font-medium text-foreground mt-2">Opportunities:</p>
                  <ul className="space-y-1">
                    {igAnalysis.opportunities_for_client.map((o: string, i: number) => (
                      <li key={i} className="text-xs text-foreground flex gap-2">
                        <span className="text-emerald-500 shrink-0">→</span>{o}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ─── Content Strategy Tab ─── */
function ContentStrategyTab({ reports }: { reports: any[] }) {
  // Aggregate pillar coverage across all reports
  const pillarCounts: Record<string, number> = {};
  const formatCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};

  reports.forEach((r) => {
    const recs = r.rd?.ai_analysis?.content_recommendations || [];
    recs.forEach((rec: any) => {
      if (rec.addresses_pillar) pillarCounts[rec.addresses_pillar] = (pillarCounts[rec.addresses_pillar] || 0) + 1;
      if (rec.format) formatCounts[rec.format] = (formatCounts[rec.format] || 0) + 1;
      if (rec.platform) platformCounts[rec.platform] = (platformCounts[rec.platform] || 0) + 1;
    });
  });

  const pillarData = Object.entries(pillarCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  const formatData = Object.entries(formatCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  const platformData = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // Pillar alignment from latest report
  const latestPillarAlignment = reports[reports.length - 1].rd?.ai_analysis?.sprout_performance_analysis?.pillar_alignment;

  // Successful formats from trend analyses
  const latestTikTok = reports[reports.length - 1].rd?.ai_analysis?.tiktok_trends_analysis;
  const latestIg = reports[reports.length - 1].rd?.ai_analysis?.instagram_trends_analysis;
  const successfulFormats = [
    ...(latestTikTok?.successful_formats || []),
    ...(latestIg?.successful_formats || []),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pillar Distribution */}
        {pillarData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4" /> Pillar Coverage</CardTitle>
              <CardDescription className="text-xs">Across all recommendations</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pillarData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pillarData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Format Distribution */}
        {formatData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Format Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {formatData.map((f) => (
                  <div key={f.name} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{f.name}</span>
                    <Badge variant="secondary">{f.value}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Platform Distribution */}
        {platformData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Platform Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {platformData.map((p) => (
                  <div key={p.name} className="flex items-center justify-between text-sm">
                    <PlatformBadge platform={p.name} size="sm" />
                    <Badge variant="secondary">{p.value}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pillar Alignment */}
      {latestPillarAlignment && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Content Pillar Alignment (Latest)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3 flex-wrap">
              {latestPillarAlignment.well_represented?.map((p: string) => (
                <Badge key={p} variant="default" className="text-xs">✓ {p}</Badge>
              ))}
              {latestPillarAlignment.underrepresented?.map((p: string) => (
                <Badge key={p} variant="destructive" className="text-xs">⚠ {p}</Badge>
              ))}
            </div>
            {latestPillarAlignment.recommendations && (
              <div className="space-y-2 mt-3">
                <p className="text-xs font-medium text-foreground">Recommendations:</p>
                {latestPillarAlignment.recommendations.map((r: string, i: number) => (
                  <div key={i} className="text-xs text-foreground flex gap-2">
                    <span className="text-primary shrink-0">→</span>{r}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Successful Formats */}
      {successfulFormats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Successful Content Formats</CardTitle>
            <CardDescription>Proven formats from trend analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {successfulFormats.slice(0, 8).map((f: string, i: number) => (
              <div key={i} className="text-sm text-foreground flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0 text-xs">{i + 1}</Badge>
                {f}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── AI Insights Tab ─── */
function AIInsightsTab({ reports }: { reports: any[] }) {
  // Aggregate key insights from performance analyses
  const allKeyInsights: { date: string; insights: string[] }[] = [];
  const allKeyTakeaways: { source: string; takeaways: string[] }[] = [];

  reports.forEach((r) => {
    const perfAnalysis = r.rd?.ai_analysis?.sprout_performance_analysis;
    if (perfAnalysis?.key_insights) {
      allKeyInsights.push({
        date: new Date(r.created_at!).toLocaleDateString(),
        insights: perfAnalysis.key_insights,
      });
    }

    const tiktokAnalysis = r.rd?.ai_analysis?.tiktok_trends_analysis;
    if (tiktokAnalysis?.key_takeaways) {
      allKeyTakeaways.push({
        source: `TikTok (${new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" })})`,
        takeaways: tiktokAnalysis.key_takeaways,
      });
    }

    const igAnalysis = r.rd?.ai_analysis?.instagram_trends_analysis;
    if (igAnalysis?.key_takeaways) {
      allKeyTakeaways.push({
        source: `Instagram (${new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" })})`,
        takeaways: igAnalysis.key_takeaways,
      });
    }
  });

  // MoM summaries across reports
  const momSummaries = reports
    .map((r) => ({
      date: new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      summary: r.rd?.ai_analysis?.sprout_performance_analysis?.month_over_month_summary,
    }))
    .filter((s) => s.summary);

  // Compute cross-report trend insights
  const crossInsights: string[] = [];
  if (reports.length >= 2) {
    const latest = reports[reports.length - 1];
    const prev = reports[reports.length - 2];
    const lCurrent = latest.rd?.sprout_performance?.month_comparison?.current_month || {};
    const pCurrent = prev.rd?.sprout_performance?.month_comparison?.current_month || {};

    if (lCurrent.impressions && pCurrent.impressions) {
      const change = ((lCurrent.impressions - pCurrent.impressions) / pCurrent.impressions * 100).toFixed(0);
      crossInsights.push(
        Number(change) >= 0
          ? `Impressions grew ${change}% between the last two report periods, indicating expanding reach.`
          : `Impressions declined ${Math.abs(Number(change))}% between the last two report periods. Review content distribution strategy.`
      );
    }

    if (lCurrent.reactions > pCurrent.reactions) {
      crossInsights.push("Engagement (reactions) is trending upward, suggesting content increasingly resonates with the audience.");
    } else if (lCurrent.reactions < pCurrent.reactions) {
      crossInsights.push("Engagement (reactions) has declined. Consider A/B testing content hooks and CTAs.");
    }

    // Check engagement rate
    if (lCurrent.impressions > 0 && pCurrent.impressions > 0) {
      const latestRate = ((lCurrent.reactions + (lCurrent.comments || 0) + (lCurrent.shares || 0)) / lCurrent.impressions * 100);
      const prevRate = ((pCurrent.reactions + (pCurrent.comments || 0) + (pCurrent.shares || 0)) / pCurrent.impressions * 100);
      crossInsights.push(
        `Engagement rate: ${latestRate.toFixed(2)}% (latest) vs ${prevRate.toFixed(2)}% (previous). ${latestRate > prevRate ? "Quality of engagement is improving." : "Consider optimizing content for deeper interaction."}`
      );
    }
  }

  if (reports.length >= 3) {
    const allImpressions = reports.map((r) => r.rd?.sprout_performance?.month_comparison?.current_month?.impressions || 0);
    const avg = allImpressions.reduce((s: number, v: number) => s + v, 0) / allImpressions.length;
    const latest = allImpressions[allImpressions.length - 1];
    if (latest > avg * 1.2) {
      crossInsights.push("Current performance is significantly above historical average — momentum is building.");
    } else if (latest < avg * 0.8) {
      crossInsights.push("Current performance is below historical average. This may indicate seasonal effects or a need for strategy refresh.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Cross-report insights */}
      {crossInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4" /> Cross-Report Performance Insights
            </CardTitle>
            <CardDescription>Automatically generated from comparing report data over time</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {crossInsights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-foreground">
                <Badge variant="secondary" className="mt-0.5 shrink-0">{i + 1}</Badge>
                {insight}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* MoM Summaries Timeline */}
      {momSummaries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Month-over-Month Summaries
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {momSummaries.map((s, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-primary mb-1">{s.date}</p>
                <p className="text-sm text-foreground leading-relaxed">{s.summary}</p>
                {i < momSummaries.length - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Key Insights from Performance Analyses */}
      {allKeyInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Performance Insights by Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {allKeyInsights.slice(-3).reverse().map((report, ri) => (
              <div key={ri}>
                <p className="text-xs font-medium text-primary mb-2">{report.date}</p>
                <ul className="space-y-1.5">
                  {report.insights.slice(0, 5).map((insight: string, i: number) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <span className="text-primary shrink-0">•</span>{insight}
                    </li>
                  ))}
                </ul>
                {ri < Math.min(allKeyInsights.length, 3) - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Key Takeaways from Trend Analyses */}
      {allKeyTakeaways.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Trend Takeaways
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {allKeyTakeaways.slice(-4).reverse().map((group, gi) => (
              <div key={gi}>
                <p className="text-xs font-medium text-primary mb-2">{group.source}</p>
                <ul className="space-y-1.5">
                  {group.takeaways.slice(0, 4).map((t: string, i: number) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <span className="text-emerald-500 shrink-0">→</span>{t}
                    </li>
                  ))}
                </ul>
                {gi < Math.min(allKeyTakeaways.length, 4) - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
