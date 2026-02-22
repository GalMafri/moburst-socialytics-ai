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
import { Checkbox } from "@/components/ui/checkbox";
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
  Filter,
  ChevronDown,
  ChevronUp,
  Zap,
  Activity,
  Brain,
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
  AreaChart,
  Area,
  ReferenceLine,
} from "recharts";
import { useState, useMemo } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─── Types ───
type ParsedReport = {
  id: string;
  created_at: string;
  date_range_start: string | null;
  date_range_end: string | null;
  rd: any;
  selected: boolean;
};

export default function Analytics() {
  const { id: paramId } = useParams();
  const navigate = useNavigate();
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(paramId);
  const [reportFilter, setReportFilter] = useState<Set<string> | null>(null); // null = all selected
  const [filterOpen, setFilterOpen] = useState(false);

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

  const allParsed: ParsedReport[] = useMemo(() => {
    if (!reports) return [];
    return reports.map((r) => {
      const rd = Array.isArray(r.report_data) ? (r.report_data as any)[0] : (r.report_data as any);
      return { id: r.id, created_at: r.created_at!, date_range_start: r.date_range_start, date_range_end: r.date_range_end, rd, selected: true };
    });
  }, [reports]);

  // Filtered reports based on selection
  const parsedReports = useMemo(() => {
    if (!reportFilter) return allParsed;
    return allParsed.filter((r) => reportFilter.has(r.id));
  }, [allParsed, reportFilter]);

  const toggleReport = (id: string) => {
    setReportFilter((prev) => {
      const next = new Set(prev ?? allParsed.map((r) => r.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Cross-report insights and trend analysis
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={clientId} onValueChange={(v) => { setSelectedClientId(v); setReportFilter(null); }}>
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
        </div>

        {/* Report filter */}
        {allParsed.length > 1 && (
          <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-3.5 w-3.5" />
                {parsedReports.length === allParsed.length
                  ? `All ${allParsed.length} reports`
                  : `${parsedReports.length} of ${allParsed.length} reports selected`}
                {filterOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-wrap gap-3">
                    {allParsed.map((r) => {
                      const checked = !reportFilter || reportFilter.has(r.id);
                      const label = r.date_range_start && r.date_range_end
                        ? `${new Date(r.date_range_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(r.date_range_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}`
                        : new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
                      return (
                        <label key={r.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <Checkbox checked={checked} onCheckedChange={() => toggleReport(r.id)} />
                          <span className={checked ? "text-foreground" : "text-muted-foreground line-through"}>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button variant="ghost" size="sm" onClick={() => setReportFilter(null)}>Select All</Button>
                    <Button variant="ghost" size="sm" onClick={() => setReportFilter(new Set())}>Clear All</Button>
                  </div>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}

        {isLoading ? (
          <p className="text-muted-foreground">Loading reports...</p>
        ) : parsedReports.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground mb-4">
              {allParsed.length === 0
                ? `No completed reports for ${clientName} yet.`
                : "No reports selected. Use the filter above to include reports."}
            </p>
            {clientId && allParsed.length === 0 && (
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
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="insights">Insights</TabsTrigger>
            </TabsList>
            <TabsContent value="overview"><OverviewTab reports={parsedReports} clientName={clientName} /></TabsContent>
            <TabsContent value="performance"><PerformanceTab reports={parsedReports} /></TabsContent>
            <TabsContent value="trends"><TrendsTab reports={parsedReports} /></TabsContent>
            <TabsContent value="content"><ContentStrategyTab reports={parsedReports} /></TabsContent>
            <TabsContent value="insights"><AIInsightsTab reports={parsedReports} /></TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

/* ─── Helpers ─── */
function formatNum(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function ChangeIndicator({ value, suffix = "%" }: { value: number; suffix?: string }) {
  if (value > 0) return <span className="text-emerald-500 flex items-center gap-0.5 text-xs font-medium"><ArrowUpRight className="h-3 w-3" />{value.toFixed(1)}{suffix}</span>;
  if (value < 0) return <span className="text-destructive flex items-center gap-0.5 text-xs font-medium"><ArrowDownRight className="h-3 w-3" />{Math.abs(value).toFixed(1)}{suffix}</span>;
  return <span className="text-muted-foreground text-xs">0{suffix}</span>;
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function reportLabel(r: ParsedReport) {
  if (r.date_range_start && r.date_range_end) {
    return `${new Date(r.date_range_start).toLocaleDateString("en-US", { month: "short" })} – ${new Date(r.date_range_end).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}`;
  }
  return new Date(r.created_at).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function getMetrics(r: ParsedReport) {
  const current = r.rd?.sprout_performance?.month_comparison?.current_month || {};
  const changes = r.rd?.sprout_performance?.month_comparison?.changes || {};
  return { current, changes };
}

function computeEngagementRate(m: any) {
  if (!m.impressions || m.impressions === 0) return 0;
  return ((m.reactions || 0) + (m.comments || 0) + (m.shares || 0)) / m.impressions * 100;
}

/** Compute linear regression slope for a series of numbers */
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = values.reduce((s, _, i) => s + i * i, 0);
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

function trendDirection(slope: number, avg: number): "up" | "down" | "flat" {
  if (avg === 0) return "flat";
  const pct = (slope / avg) * 100;
  if (pct > 5) return "up";
  if (pct < -5) return "down";
  return "flat";
}

/* ─── Overview Tab ─── */
function OverviewTab({ reports, clientName }: { reports: ParsedReport[]; clientName: string }) {
  const latest = reports[reports.length - 1];
  const { current: latestMetrics, changes: latestChanges } = getMetrics(latest);

  // Compute aggregated totals and averages across all selected reports
  const aggregated = useMemo(() => {
    const keys = ["impressions", "reactions", "link_clicks", "video_views", "comments", "shares"];
    const totals: Record<string, number> = {};
    const series: Record<string, number[]> = {};
    keys.forEach((k) => { totals[k] = 0; series[k] = []; });

    reports.forEach((r) => {
      const { current } = getMetrics(r);
      keys.forEach((k) => {
        const v = current[k] || 0;
        totals[k] += v;
        series[k].push(v);
      });
    });

    const slopes: Record<string, { slope: number; direction: "up" | "down" | "flat" }> = {};
    keys.forEach((k) => {
      const s = trendSlope(series[k]);
      const avg = totals[k] / reports.length;
      slopes[k] = { slope: s, direction: trendDirection(s, avg) };
    });

    return { totals, series, slopes };
  }, [reports]);

  const metricDefs = [
    { key: "impressions", label: "Impressions", icon: Eye },
    { key: "reactions", label: "Reactions", icon: Heart },
    { key: "link_clicks", label: "Link Clicks", icon: MousePointerClick },
    { key: "video_views", label: "Video Views", icon: Video },
    { key: "comments", label: "Comments", icon: MessageCircle },
    { key: "shares", label: "Shares", icon: Share2 },
  ];

  // Timeline
  const timeline = reports.map((r) => {
    const { current } = getMetrics(r);
    return {
      date: reportLabel(r),
      impressions: current.impressions || 0,
      reactions: current.reactions || 0,
      engRate: computeEngagementRate(current),
    };
  });

  // Engagement rate trajectory
  const engRates = timeline.map((t) => t.engRate);
  const engSlope = trendSlope(engRates);
  const avgEngRate = engRates.reduce((a, b) => a + b, 0) / engRates.length;

  return (
    <div className="space-y-6">
      {/* Summary heading */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Activity className="h-4 w-4" />
        Aggregating {reports.length} report{reports.length !== 1 ? "s" : ""} for {clientName}
      </div>

      {/* Metric cards with trajectory */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metricDefs.map((m) => {
          const dir = aggregated.slopes[m.key].direction;
          return (
            <Card key={m.key}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                  <m.icon className="h-3.5 w-3.5" />
                  <span className="text-xs">{m.label}</span>
                </div>
                <div className="text-lg font-bold text-foreground">{formatNum(latestMetrics[m.key] || 0)}</div>
                <div className="flex items-center justify-between">
                  <ChangeIndicator value={latestChanges[m.key]?.percent || 0} />
                  {reports.length > 1 && (
                    <Badge variant={dir === "up" ? "default" : dir === "down" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {dir === "up" ? "↑ trending" : dir === "down" ? "↓ trending" : "— flat"}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Performance + Engagement Rate timeline */}
      {timeline.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Performance Trajectory</CardTitle>
              <CardDescription>Impressions & reactions across selected reports</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis tickFormatter={formatNum} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(v: number) => [formatNum(v), undefined]} />
                  <Legend />
                  <Area type="monotone" dataKey="impressions" name="Impressions" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.1} strokeWidth={2} />
                  <Area type="monotone" dataKey="reactions" name="Reactions" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Engagement Rate Over Time</CardTitle>
              <CardDescription>
                (Reactions + Comments + Shares) / Impressions · Avg: {avgEngRate.toFixed(2)}%
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis tickFormatter={(v: number) => `${v.toFixed(1)}%`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(v: number) => [`${v.toFixed(2)}%`, undefined]} />
                  <ReferenceLine y={avgEngRate} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "avg", position: "right", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Line type="monotone" dataKey="engRate" name="Engagement Rate" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Data-driven quick insights */}
      <DataDrivenInsights reports={reports} />
    </div>
  );
}

/* ─── Data-Driven Insights (reusable) ─── */
function DataDrivenInsights({ reports }: { reports: ParsedReport[] }) {
  const insights = useMemo(() => {
    const result: { text: string; type: "positive" | "negative" | "neutral" }[] = [];
    if (reports.length < 2) {
      result.push({ text: "Add more reports to unlock cross-report trend analysis and trajectory insights.", type: "neutral" });
      return result;
    }

    const metricKeys = ["impressions", "reactions", "link_clicks", "video_views", "comments", "shares"];
    const series: Record<string, number[]> = {};
    metricKeys.forEach((k) => { series[k] = []; });
    reports.forEach((r) => {
      const { current } = getMetrics(r);
      metricKeys.forEach((k) => series[k].push(current[k] || 0));
    });

    // Trajectory insights
    metricKeys.forEach((k) => {
      const vals = series[k];
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg === 0) return;
      const slope = trendSlope(vals);
      const pctSlope = (slope / avg) * 100;
      const latest = vals[vals.length - 1];
      const label = k.replace(/_/g, " ");

      if (pctSlope > 15) {
        result.push({ text: `${label} are growing strongly (+${pctSlope.toFixed(0)}% per period) — momentum is building.`, type: "positive" });
      } else if (pctSlope < -15) {
        result.push({ text: `${label} are declining (${pctSlope.toFixed(0)}% per period). Review distribution and content strategy.`, type: "negative" });
      }

      // Compare latest to average
      if (latest > avg * 1.3 && vals.length >= 3) {
        result.push({ text: `Latest ${label} (${formatNum(latest)}) are ${((latest / avg - 1) * 100).toFixed(0)}% above the historical average — a standout period.`, type: "positive" });
      } else if (latest < avg * 0.7 && vals.length >= 3) {
        result.push({ text: `Latest ${label} (${formatNum(latest)}) are ${((1 - latest / avg) * 100).toFixed(0)}% below the historical average.`, type: "negative" });
      }
    });

    // Engagement rate trend
    const engRates = reports.map((r) => {
      const { current } = getMetrics(r);
      return computeEngagementRate(current);
    });
    const engSlope = trendSlope(engRates);
    const avgEng = engRates.reduce((a, b) => a + b, 0) / engRates.length;
    if (avgEng > 0) {
      const engPct = (engSlope / avgEng) * 100;
      if (engPct > 10) {
        result.push({ text: `Engagement rate is improving (+${engPct.toFixed(0)}% per period at ${engRates[engRates.length - 1].toFixed(2)}%) — content quality is resonating.`, type: "positive" });
      } else if (engPct < -10) {
        result.push({ text: `Engagement rate is declining (${engPct.toFixed(0)}% per period). Impressions may be growing faster than interactions — consider more engaging CTAs.`, type: "negative" });
      }
    }

    // Hashtag consistency
    const hashtagsByReport: Record<string, Set<string>> = {};
    reports.forEach((r, i) => {
      hashtagsByReport[i] = new Set();
      const posts = [...(r.rd?.tiktok_trends?.posts || []), ...(r.rd?.instagram_trends?.posts || [])];
      posts.forEach((p: any) => {
        (p.hashtags || []).forEach((h: string) => hashtagsByReport[i].add(h.toLowerCase().replace(/^#/, "")));
      });
    });
    const allHashtags = new Set<string>();
    Object.values(hashtagsByReport).forEach((s) => s.forEach((h) => allHashtags.add(h)));
    const recurring = [...allHashtags].filter((h) => {
      let count = 0;
      Object.values(hashtagsByReport).forEach((s) => { if (s.has(h)) count++; });
      return count >= Math.ceil(reports.length * 0.5);
    });
    if (recurring.length > 0) {
      result.push({ text: `${recurring.length} hashtag${recurring.length > 1 ? "s" : ""} appear in 50%+ of reports (${recurring.slice(0, 5).map(h => `#${h}`).join(", ")}${recurring.length > 5 ? "…" : ""}) — these are your consistent trend anchors.`, type: "neutral" });
    }

    // Theme evolution
    const latestThemes = reports[reports.length - 1].rd?.ai_analysis?.tiktok_trends_analysis?.top_themes || [];
    const prevThemes = reports.length >= 2 ? (reports[reports.length - 2].rd?.ai_analysis?.tiktok_trends_analysis?.top_themes || []) : [];
    const newThemes = latestThemes.filter((t: string) => !prevThemes.some((p: string) => p.toLowerCase() === t.toLowerCase()));
    if (newThemes.length > 0 && prevThemes.length > 0) {
      result.push({ text: `${newThemes.length} new TikTok theme${newThemes.length > 1 ? "s" : ""} emerged since last report — the trend landscape is shifting.`, type: "neutral" });
    }

    return result.slice(0, 8);
  }, [reports]);

  if (insights.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4" /> Data-Driven Insights
        </CardTitle>
        <CardDescription>Automatically computed from {reports.length} report{reports.length !== 1 ? "s" : ""}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {insights.map((ins, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className={`shrink-0 mt-0.5 ${ins.type === "positive" ? "text-emerald-500" : ins.type === "negative" ? "text-destructive" : "text-muted-foreground"}`}>
              {ins.type === "positive" ? <TrendingUp className="h-4 w-4" /> : ins.type === "negative" ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
            </span>
            <span className="text-foreground">{ins.text}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─── Performance Tab ─── */
function PerformanceTab({ reports }: { reports: ParsedReport[] }) {
  const performanceData = reports.map((r) => {
    const { current, changes } = getMetrics(r);
    return {
      date: reportLabel(r),
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
      engRate: computeEngagementRate(current),
    };
  });

  // Aggregated top content across all reports
  const allTopContent = reports.flatMap((r, i) => {
    const items = r.rd?.ai_analysis?.sprout_performance_analysis?.top_performing_content || [];
    return items.map((item: string) => ({ item, reportDate: reportLabel(r) }));
  });

  // Platform-level breakdown from top posts across all reports
  const platformMetrics = useMemo(() => {
    const byPlatform: Record<string, { impressions: number; reactions: number; posts: number }> = {};
    reports.forEach((r) => {
      const topPosts = r.rd?.sprout_performance?.top_posts || [];
      topPosts.forEach((p: any) => {
        const platform = p.network || "Unknown";
        if (!byPlatform[platform]) byPlatform[platform] = { impressions: 0, reactions: 0, posts: 0 };
        byPlatform[platform].impressions += p.impressions || 0;
        byPlatform[platform].reactions += (p.reactions || 0) + (p.likes || 0);
        byPlatform[platform].posts += 1;
      });
    });
    return Object.entries(byPlatform).sort((a, b) => b[1].impressions - a[1].impressions);
  }, [reports]);

  return (
    <div className="space-y-6">
      {/* Absolute metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Performance Metrics Over Time</CardTitle>
          <CardDescription>Absolute values across {reports.length} selected report{reports.length !== 1 ? "s" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis tickFormatter={formatNum} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(v: number) => [v.toLocaleString(), undefined]} />
              <Legend />
              <Line type="monotone" dataKey="impressions" name="Impressions" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="reactions" name="Reactions" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="link_clicks" name="Link Clicks" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="video_views" name="Video Views" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* MoM change + engagement rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Month-over-Month Change (%)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={performanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis tickFormatter={(v: number) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(v: number) => [`${v}%`, undefined]} />
                <Legend />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="impressions_pct" name="Impressions" fill={CHART_COLORS[0]} />
                <Bar dataKey="reactions_pct" name="Reactions" fill={CHART_COLORS[1]} />
                <Bar dataKey="link_clicks_pct" name="Clicks" fill={CHART_COLORS[2]} />
                <Bar dataKey="video_views_pct" name="Video" fill={CHART_COLORS[3]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Platform breakdown */}
        {platformMetrics.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Platform Performance (All Reports)</CardTitle>
              <CardDescription>Aggregated from top posts across all selected reports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {platformMetrics.map(([platform, data]) => (
                <div key={platform} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={platform} size="sm" />
                    <span className="text-xs text-muted-foreground">{data.posts} posts</span>
                  </div>
                  <div className="flex gap-4 text-xs text-foreground">
                    <span>{formatNum(data.impressions)} imp</span>
                    <span>{formatNum(data.reactions)} eng</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Top content aggregated */}
      {allTopContent.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" /> Top Performing Content (All Reports)
            </CardTitle>
            <CardDescription>AI-identified top content across all selected reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {allTopContent.slice(-10).reverse().map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <Badge variant="secondary" className="mt-0.5 shrink-0 text-xs">{item.reportDate}</Badge>
                <span className="text-foreground">{item.item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Trends Tab ─── */
function TrendsTab({ reports }: { reports: ParsedReport[] }) {
  const trendsTimeline = reports.map((r) => {
    const tiktok = r.rd?.tiktok_trends?.posts || [];
    const instagram = r.rd?.instagram_trends?.posts || [];
    return {
      date: reportLabel(r),
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

  // Aggregate hashtags with report frequency
  const hashtagData = useMemo(() => {
    const counts: Record<string, { total: number; reports: Set<string> }> = {};
    reports.forEach((r) => {
      const posts = [...(r.rd?.tiktok_trends?.posts || []), ...(r.rd?.instagram_trends?.posts || [])];
      posts.forEach((p: any) => {
        (p.hashtags || []).forEach((h: string) => {
          const tag = h.toLowerCase().replace(/^#/, "");
          if (!counts[tag]) counts[tag] = { total: 0, reports: new Set() };
          counts[tag].total += 1;
          counts[tag].reports.add(r.id);
        });
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1].reports.size - a[1].reports.size || b[1].total - a[1].total)
      .slice(0, 25)
      .map(([tag, d]) => ({ tag, total: d.total, reportCount: d.reports.size, consistency: (d.reports.size / reports.length * 100).toFixed(0) }));
  }, [reports]);

  // Theme evolution across reports
  const themeEvolution = useMemo(() => {
    const themeMap: Record<string, { firstSeen: string; lastSeen: string; count: number; platform: string }> = {};
    reports.forEach((r) => {
      const label = reportLabel(r);
      const ttThemes = r.rd?.ai_analysis?.tiktok_trends_analysis?.top_themes || [];
      ttThemes.forEach((t: string) => {
        const key = t.toLowerCase();
        if (!themeMap[key]) themeMap[key] = { firstSeen: label, lastSeen: label, count: 0, platform: "TikTok" };
        themeMap[key].lastSeen = label;
        themeMap[key].count++;
      });
      const igThemes = r.rd?.ai_analysis?.instagram_trends_analysis?.top_themes || [];
      igThemes.forEach((t: string) => {
        const key = t.toLowerCase();
        if (!themeMap[key]) themeMap[key] = { firstSeen: label, lastSeen: label, count: 0, platform: "Instagram" };
        themeMap[key].lastSeen = label;
        themeMap[key].count++;
      });
    });
    return Object.entries(themeMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15);
  }, [reports]);

  // Aggregate opportunities across ALL reports (not just latest)
  const allOpportunities = useMemo(() => {
    const opps: { text: string; platform: string; date: string }[] = [];
    reports.forEach((r) => {
      const label = reportLabel(r);
      const ttOpps = r.rd?.ai_analysis?.tiktok_trends_analysis?.opportunities_for_client || [];
      ttOpps.forEach((o: string) => opps.push({ text: o, platform: "TikTok", date: label }));
      const igOpps = r.rd?.ai_analysis?.instagram_trends_analysis?.opportunities_for_client || [];
      igOpps.forEach((o: string) => opps.push({ text: o, platform: "Instagram", date: label }));
    });
    return opps;
  }, [reports]);

  // Deduplicate similar opportunities and keep most recent
  const deduplicatedOpps = useMemo(() => {
    const seen = new Map<string, typeof allOpportunities[0]>();
    // Process newest first so newest stays
    [...allOpportunities].reverse().forEach((o) => {
      const key = o.text.toLowerCase().slice(0, 60);
      if (!seen.has(key)) seen.set(key, o);
    });
    return [...seen.values()].slice(0, 10);
  }, [allOpportunities]);

  return (
    <div className="space-y-6">
      {/* Trend volume + engagement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trend Volume Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trendsTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} />
                <Legend />
                <Bar dataKey="tiktok_count" name="TikTok" fill={CHART_COLORS[0]} />
                <Bar dataKey="ig_count" name="Instagram" fill={CHART_COLORS[2]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avg Trend Engagement Score</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendsTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis tickFormatter={formatNum} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(v: number) => [formatNum(v), undefined]} />
                <Legend />
                <Line type="monotone" dataKey="avg_tiktok" name="TikTok" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="avg_ig" name="Instagram" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Hashtag analysis */}
      {hashtagData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="h-4 w-4" /> Hashtag Analysis (All Reports)
            </CardTitle>
            <CardDescription>Sorted by report consistency — hashtags appearing across multiple reports are your trend anchors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {hashtagData.map((h) => (
                <div key={h.tag} className="flex items-center justify-between rounded-md border p-2">
                  <span className="text-sm text-foreground font-medium">#{h.tag}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">×{h.total}</span>
                    <Badge variant={Number(h.consistency) >= 50 ? "default" : "outline"} className="text-[10px] px-1.5 py-0">
                      {h.consistency}% of reports
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Theme evolution */}
      {themeEvolution.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Theme Evolution
            </CardTitle>
            <CardDescription>How themes persist or emerge across reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {themeEvolution.map(([theme, data]) => (
              <div key={theme} className="flex items-start justify-between rounded-md border p-3">
                <div className="flex-1">
                  <p className="text-sm text-foreground capitalize">{theme}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.count > 1
                      ? `Appeared in ${data.count} reports (${data.firstSeen} → ${data.lastSeen})`
                      : `First appeared: ${data.firstSeen}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PlatformBadge platform={data.platform} size="sm" />
                  {data.count >= Math.ceil(reports.length * 0.5) && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">persistent</Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Aggregated opportunities */}
      {deduplicatedOpps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" /> Actionable Opportunities (All Reports)
            </CardTitle>
            <CardDescription>Curated from AI trend analyses across all selected reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {deduplicatedOpps.map((o, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <PlatformBadge platform={o.platform} size="sm" />
                <div className="flex-1">
                  <span className="text-foreground">{o.text}</span>
                  <span className="text-xs text-muted-foreground ml-2">({o.date})</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Content Strategy Tab ─── */
function ContentStrategyTab({ reports }: { reports: ParsedReport[] }) {
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

  const pillarData = Object.entries(pillarCounts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const formatData = Object.entries(formatCounts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const platformData = Object.entries(platformCounts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

  // Pillar alignment evolution
  const pillarAlignmentHistory = useMemo(() => {
    return reports
      .map((r) => ({
        date: reportLabel(r),
        alignment: r.rd?.ai_analysis?.sprout_performance_analysis?.pillar_alignment,
      }))
      .filter((a) => a.alignment);
  }, [reports]);

  // All recommendations aggregated
  const allRecs = useMemo(() => {
    return reports.flatMap((r) => {
      const recs = r.rd?.ai_analysis?.sprout_performance_analysis?.pillar_alignment?.recommendations || [];
      return recs.map((rec: string) => ({ rec, date: reportLabel(r) }));
    });
  }, [reports]);

  // Successful formats across all reports
  const successfulFormats = useMemo(() => {
    const formats: { format: string; date: string; platform: string }[] = [];
    reports.forEach((r) => {
      const label = reportLabel(r);
      (r.rd?.ai_analysis?.tiktok_trends_analysis?.successful_formats || []).forEach((f: string) =>
        formats.push({ format: f, date: label, platform: "TikTok" }));
      (r.rd?.ai_analysis?.instagram_trends_analysis?.successful_formats || []).forEach((f: string) =>
        formats.push({ format: f, date: label, platform: "Instagram" }));
    });
    return formats;
  }, [reports]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    {pillarData.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        {formatData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Format Distribution</CardTitle></CardHeader>
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
        {platformData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Platform Distribution</CardTitle></CardHeader>
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

      {/* Pillar alignment evolution */}
      {pillarAlignmentHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Pillar Alignment History</CardTitle>
            <CardDescription>How pillar coverage has evolved across reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pillarAlignmentHistory.map((entry, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-primary mb-2">{entry.date}</p>
                <div className="flex gap-2 flex-wrap">
                  {entry.alignment.well_represented?.map((p: string) => (
                    <Badge key={p} variant="default" className="text-xs">✓ {p}</Badge>
                  ))}
                  {entry.alignment.underrepresented?.map((p: string) => (
                    <Badge key={p} variant="destructive" className="text-xs">⚠ {p}</Badge>
                  ))}
                </div>
                {i < pillarAlignmentHistory.length - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Content strategy recommendations aggregated */}
      {allRecs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Strategy Recommendations (All Reports)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {allRecs.slice(-8).reverse().map((r, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <Badge variant="secondary" className="mt-0.5 shrink-0 text-xs">{r.date}</Badge>
                <span className="text-foreground">{r.rec}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Successful formats */}
      {successfulFormats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Proven Content Formats</CardTitle>
            <CardDescription>Successful formats identified across all reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {successfulFormats.slice(-10).reverse().map((f, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <PlatformBadge platform={f.platform} size="sm" />
                <span className="text-foreground">{f.format}</span>
                <span className="text-xs text-muted-foreground ml-auto">{f.date}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── AI Insights Tab ─── */
function AIInsightsTab({ reports }: { reports: ParsedReport[] }) {
  // MoM summaries
  const momSummaries = reports
    .map((r) => ({
      date: reportLabel(r),
      summary: r.rd?.ai_analysis?.sprout_performance_analysis?.month_over_month_summary,
    }))
    .filter((s) => s.summary);

  // Key insights per report
  const allKeyInsights = reports
    .map((r) => ({
      date: reportLabel(r),
      insights: r.rd?.ai_analysis?.sprout_performance_analysis?.key_insights || [],
    }))
    .filter((r) => r.insights.length > 0);

  // Key takeaways per report per platform
  const allTakeaways: { source: string; takeaways: string[] }[] = [];
  reports.forEach((r) => {
    const label = reportLabel(r);
    const tt = r.rd?.ai_analysis?.tiktok_trends_analysis?.key_takeaways;
    if (tt?.length) allTakeaways.push({ source: `TikTok (${label})`, takeaways: tt });
    const ig = r.rd?.ai_analysis?.instagram_trends_analysis?.key_takeaways;
    if (ig?.length) allTakeaways.push({ source: `Instagram (${label})`, takeaways: ig });
  });

  // Synthesized narrative from all MoM summaries
  const synthesized = useMemo(() => {
    if (momSummaries.length < 2) return null;
    const summaries = momSummaries.map((s) => s.summary);
    // Extract directional signals
    const upSignals = summaries.filter((s: string) => s && (s.includes("increase") || s.includes("grew") || s.includes("improved") || s.includes("up"))).length;
    const downSignals = summaries.filter((s: string) => s && (s.includes("decrease") || s.includes("declined") || s.includes("drop") || s.includes("down"))).length;
    const trend = upSignals > downSignals ? "improving" : downSignals > upSignals ? "declining" : "mixed";
    return {
      trend,
      upSignals,
      downSignals,
      totalPeriods: summaries.length,
    };
  }, [momSummaries]);

  return (
    <div className="space-y-6">
      {/* Data-driven computed insights */}
      <DataDrivenInsights reports={reports} />

      {/* Synthesized trajectory */}
      {synthesized && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Performance Trajectory Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <Badge variant={synthesized.trend === "improving" ? "default" : synthesized.trend === "declining" ? "destructive" : "secondary"} className="text-xs">
                {synthesized.trend === "improving" ? "↑ Improving" : synthesized.trend === "declining" ? "↓ Declining" : "↔ Mixed"}
              </Badge>
              <span className="text-foreground">
                Across {synthesized.totalPeriods} reporting periods: {synthesized.upSignals} positive signals, {synthesized.downSignals} negative signals.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MoM Summaries */}
      {momSummaries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Month-over-Month Summaries
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {momSummaries.reverse().map((s, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-primary mb-1">{s.date}</p>
                <p className="text-sm text-foreground leading-relaxed">{s.summary}</p>
                {i < momSummaries.length - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Key insights */}
      {allKeyInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Performance Insights by Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {allKeyInsights.slice(-4).reverse().map((report, ri) => (
              <div key={ri}>
                <p className="text-xs font-medium text-primary mb-2">{report.date}</p>
                <ul className="space-y-1.5">
                  {report.insights.slice(0, 5).map((insight: string, i: number) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <span className="text-primary shrink-0">•</span>{insight}
                    </li>
                  ))}
                </ul>
                {ri < Math.min(allKeyInsights.length, 4) - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Trend takeaways */}
      {allTakeaways.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Trend Takeaways
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {allTakeaways.slice(-6).reverse().map((group, gi) => (
              <div key={gi}>
                <p className="text-xs font-medium text-primary mb-2">{group.source}</p>
                <ul className="space-y-1.5">
                  {group.takeaways.slice(0, 4).map((t: string, i: number) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <span className="text-emerald-500 shrink-0">→</span>{t}
                    </li>
                  ))}
                </ul>
                {gi < Math.min(allTakeaways.length, 6) - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
