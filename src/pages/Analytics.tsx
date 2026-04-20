import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMemo, useRef, useState } from "react";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import {
  ArrowLeft,
  Eye,
  Heart,
  BarChart3,
  MousePointerClick,
  Play,
  MessageCircle,
  Share2,
  TrendingUp,
  TrendingDown,
  Minus,
  Lightbulb,
  Info,
  Sparkles,
  Globe,
  Languages,
} from "lucide-react";
import { TrendInsightsSection } from "@/components/analytics/TrendInsightsSection";
import { ConnectedProfiles } from "@/components/analytics/ConnectedProfiles";
import { AIDeepInsights } from "@/components/analytics/AIDeepInsights";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

type TimeRange = "7d" | "30d" | "90d" | "all";
type AnalyticsView = "performance" | "trends";

export default function Analytics() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>("30d");
  const [view, setView] = useState<AnalyticsView>("performance");

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ["analytics-reports", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("client_id", id!)
        .eq("status", "completed")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Filter reports by time range
  const filtered = useMemo(() => {
    if (!reports) return [];
    if (range === "all") return reports;
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return reports.filter((r: any) => new Date(r.created_at) >= cutoff);
  }, [reports, range]);

  // Helper: extract totals from sprout_performance with flexible key lookup
  function extractTotals(sp: any): {
    impressions: number;
    reactions: number;
    link_clicks: number;
    comments: number;
    shares: number;
    video_views: number;
  } {
    // Try multiple possible locations for totals — including month_comparison.current_month
    const totals = sp?.overall_totals || sp?.totals || sp?.summary || sp?.month_comparison?.current_month || {};
    const parseNum = (v: any): number => {
      if (!v) return 0;
      const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
      return isNaN(n) ? 0 : n;
    };
    return {
      impressions: parseNum(totals.impressions || totals.reach || totals.views),
      reactions: parseNum(totals.reactions || totals.likes),
      link_clicks: parseNum(totals.link_clicks || totals.clicks),
      comments: parseNum(totals.comments),
      shares: parseNum(totals.shares || totals.retweets),
      video_views: parseNum(totals.video_views),
    };
  }

  // Extract month-over-month comparison from sprout_performance
  function extractComparison(sp: any) {
    const mc = sp?.month_comparison;
    if (!mc) return null;
    return {
      current: mc.current_month || {},
      previous: mc.previous_month || {},
      changes: mc.changes || {},
    };
  }

  // Extract time-series metrics from report_data.sprout_performance
  const chartData = useMemo(() => {
    return filtered.map((r: any) => {
      const rawRd = r.report_data;
      const rd = Array.isArray(rawRd) ? rawRd[0] : rawRd;
      const sp = rd?.sprout_performance || {};
      const totals = extractTotals(sp);
      const totalEngagements = totals.reactions + totals.link_clicks + totals.comments + totals.shares;
      const engRate = totals.impressions > 0 ? (totalEngagements / totals.impressions) * 100 : 0;
      return {
        date: new Date(r.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        fullDate: r.created_at,
        impressions: totals.impressions,
        reactions: totals.reactions,
        link_clicks: totals.link_clicks,
        comments: totals.comments,
        shares: totals.shares,
        video_views: totals.video_views,
        engagements: totalEngagements,
        engagement_rate: Math.round(engRate * 100) / 100,
      };
    });
  }, [filtered]);

  // Latest report data (unwrap array if needed)
  const latestReport = filtered.length > 0 ? filtered[filtered.length - 1] : null;
  const latestRd = useMemo(() => {
    if (!latestReport) return null;
    const rawRd = (latestReport as any).report_data;
    return Array.isArray(rawRd) ? rawRd[0] : rawRd;
  }, [latestReport]);

  // Latest report comparison data
  const comparison = useMemo(() => {
    if (!latestRd) return null;
    const sp = latestRd.sprout_performance || {};
    return extractComparison(sp);
  }, [latestRd]);

  // Latest report totals (for summary cards)
  const latestTotals = useMemo(() => {
    if (!latestRd) return null;
    const sp = latestRd.sprout_performance || {};
    const t = extractTotals(sp);
    const hasData = t.impressions > 0 || t.reactions > 0 || t.link_clicks > 0 || t.video_views > 0;
    return hasData ? t : null;
  }, [latestRd]);

  // Platform profiles from latest report
  const platformData = useMemo(() => {
    if (!latestRd) return [];
    const sp = latestRd.sprout_performance || {};
    const profiles = sp.profiles || sp.by_profile || [];
    if (!Array.isArray(profiles)) return [];
    return profiles.map((p: any) => ({
      name: p.name || p.native_name || p.profile_name || "Unknown",
      network: p.network || p.network_type || "",
    }));
  }, [latestRd]);

  // Extract AI summary from latest report for "Key Takeaway" card
  const latestAISummary = useMemo(() => {
    if (!latestRd) return null;
    const ai = latestRd.ai_analysis || {};
    // Try multiple paths where the AI summary might live
    const summary =
      ai.sprout_performance_analysis?.month_over_month_summary ||
      ai.sprout_performance_analysis?.overall_summary ||
      ai.executive_summary ||
      ai.summary ||
      null;
    if (!summary || (typeof summary === "string" && summary.trim().length === 0)) return null;
    return typeof summary === "string" ? summary : JSON.stringify(summary);
  }, [latestRd]);

  // Extract top-performing content insight
  const topContentInsight = useMemo(() => {
    if (!latestRd) return null;
    const ai = latestRd.ai_analysis || {};
    const topContent = ai.sprout_performance_analysis?.top_performing_content || ai.top_content_summary || null;
    if (!topContent) return null;
    if (typeof topContent === "string") return topContent;
    if (Array.isArray(topContent) && topContent.length > 0) {
      // If it's an array of posts, summarize the first one
      const first = topContent[0];
      return first.insight || first.summary || first.description || null;
    }
    return null;
  }, [latestRd]);

  const title = client ? `Analytics: ${client.name}` : "Analytics";

  // Format large numbers for display
  const fmtVal = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  // Format numbers embedded in text strings (e.g., "5000 impressions" → "5,000 impressions")
  const formatNumbersInText = (text: string): string => {
    return text.replace(/\b(\d{4,})\b/g, (match) => {
      return Number(match).toLocaleString();
    });
  };

  const exportRef = useRef<HTMLDivElement>(null);
  const pdfFilename = `${client?.name || "client"}_analytics_${range}_${new Date().toISOString().split("T")[0]}`;

  return (
    <AppLayout title={title}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/setup`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Client
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(["7d", "30d", "90d", "all"] as TimeRange[]).map((r) => (
                <Button key={r} variant={range === r ? "default" : "outline"} size="sm" onClick={() => setRange(r)}>
                  {r === "all" ? "All Time" : r}
                </Button>
              ))}
            </div>
            <ExportPdfButton
              contentRef={exportRef}
              filename={pdfFilename}
              title={`${client?.name || "Client"} — Analytics (${range === "all" ? "All Time" : range})`}
            />
          </div>
        </div>

        <div ref={exportRef} className="space-y-6">
        {/* Guidance text */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.04)]">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Track your social media performance over time. Each report generates a snapshot of your metrics — the more
              reports you run, the richer your trend data becomes.
            </p>
            {client && (client.geo || client.language) && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {client.geo && (
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3" /> {client.geo}
                  </span>
                )}
                {client.language && (
                  <span className="flex items-center gap-1">
                    <Languages className="h-3 w-3" /> {client.language}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse text-muted-foreground">Loading analytics...</div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="space-y-3">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="font-semibold">No completed reports yet</h3>
              <p className="text-sm text-muted-foreground">
                Run your first analysis to start tracking performance trends.
              </p>
              <Button onClick={() => navigate(`/clients/${id}/analyze`)} className="gap-2">
                <Play className="h-4 w-4" /> Run First Analysis
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* View segmentation */}
            <Tabs value={view} onValueChange={(v) => setView(v as AnalyticsView)}>
              <TabsList className="grid w-full grid-cols-2 max-w-xs">
                <TabsTrigger value="performance" className="gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" /> Performance
                </TabsTrigger>
                <TabsTrigger value="trends" className="gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Trends
                </TabsTrigger>
              </TabsList>

              <TabsContent value="performance" className="space-y-6 mt-4">
                {/* Summary cards — latest report metrics */}
                {latestTotals ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                      <BarChart3 className="h-3 w-3" />
                      Latest Report Metrics —{" "}
                      {latestReport &&
                        new Date((latestReport as any).created_at).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      <SummaryCard
                        icon={<Eye className="h-3.5 w-3.5" />}
                        label="Impressions"
                        value={fmtVal(latestTotals.impressions)}
                        change={comparison?.changes?.impressions?.percent}
                      />
                      <SummaryCard
                        icon={<Heart className="h-3.5 w-3.5" />}
                        label="Reactions"
                        value={fmtVal(latestTotals.reactions)}
                        change={comparison?.changes?.reactions?.percent}
                      />
                      <SummaryCard
                        icon={<MousePointerClick className="h-3.5 w-3.5" />}
                        label="Link Clicks"
                        value={fmtVal(latestTotals.link_clicks)}
                        change={comparison?.changes?.link_clicks?.percent}
                      />
                      <SummaryCard
                        icon={<Play className="h-3.5 w-3.5" />}
                        label="Video Views"
                        value={fmtVal(latestTotals.video_views)}
                        change={comparison?.changes?.video_views?.percent}
                      />
                      <SummaryCard
                        icon={<MessageCircle className="h-3.5 w-3.5" />}
                        label="Comments"
                        value={fmtVal(latestTotals.comments)}
                        change={comparison?.changes?.comments?.percent}
                      />
                      <SummaryCard
                        icon={<Share2 className="h-3.5 w-3.5" />}
                        label="Shares"
                        value={fmtVal(latestTotals.shares)}
                        change={comparison?.changes?.shares?.percent}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <SummaryCard
                      icon={<BarChart3 className="h-3.5 w-3.5" />}
                      label="Reports Analyzed"
                      value={filtered.length.toString()}
                    />
                  </div>
                )}

                {/* Key Takeaway — AI summary from latest report */}
                {latestAISummary && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="pt-5 pb-4 px-5">
                      <div className="flex items-start gap-3">
                        <div className="rounded-full bg-primary/10 p-2 shrink-0">
                          <Sparkles className="h-4 w-4 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-sm font-semibold">Key Takeaway</h4>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {formatNumbersInText(latestAISummary)}
                          </p>
                          {topContentInsight && (
                            <p className="text-xs text-muted-foreground/80 pt-1 border-t border-[rgba(255,255,255,0.04)] mt-2">
                              <Lightbulb className="h-3 w-3 inline mr-1" />
                              {formatNumbersInText(topContentInsight)}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Single report CTA — encourage running more analyses */}
                {filtered.length === 1 && (
                  <Card className="border-dashed">
                    <CardContent className="pt-5 pb-4 px-5 text-center space-y-2">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <TrendingUp className="h-4 w-4" />
                        <span className="text-sm font-medium">Want to see trends over time?</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        You have 1 report. Run more analyses to unlock trend charts, engagement rate tracking, and
                        richer insights.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/clients/${id}/analyze`)}
                        className="gap-2 mt-1"
                      >
                        <Play className="h-3.5 w-3.5" /> Run Another Analysis
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Month-over-month comparison from latest report */}
                {comparison && Object.keys(comparison.changes).length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Month-over-Month{" "}
                        <span className="font-normal text-muted-foreground text-sm">(latest report)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {Object.entries(comparison.changes).map(([key, val]: [string, any]) => {
                          const pct = typeof val?.percent === "number" ? val.percent : 0;
                          const isUp = pct > 0;
                          const isDown = pct < 0;
                          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                          const current = val?.current ?? 0;
                          const previous = val?.previous ?? comparison.previous?.[key] ?? 0;
                          return (
                            <div key={key} className="flex items-center gap-3 p-3 rounded-md bg-[rgba(255,255,255,0.04)]">
                              <div className="flex-1">
                                <div className="text-xs text-muted-foreground">{label}</div>
                                <div className="text-lg font-semibold">{fmtVal(current)}</div>
                                {previous > 0 && (
                                  <div className="text-xs text-muted-foreground">prev: {fmtVal(previous)}</div>
                                )}
                              </div>
                              <div className="text-right">
                                <Badge
                                  variant={isUp ? "default" : isDown ? "destructive" : "secondary"}
                                  className="text-xs"
                                >
                                  {isUp ? (
                                    <TrendingUp className="h-3 w-3 mr-1 inline" />
                                  ) : isDown ? (
                                    <TrendingDown className="h-3 w-3 mr-1 inline" />
                                  ) : null}
                                  {isUp ? "+" : ""}
                                  {pct}%
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Performance Over Time — Per-metric line charts */}
                {chartData.length >= 1 && chartData.some((d) => d.impressions > 0 || d.reactions > 0) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Performance Over Time
                        <span className="font-normal text-muted-foreground text-sm ml-2">
                          ({filtered.length} report{filtered.length !== 1 ? "s" : ""})
                        </span>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {chartData.length === 1
                          ? "Showing your latest snapshot. Run more analyses to see trend lines."
                          : "Each data point represents one analysis run. Hover over points for exact values."}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Impressions chart (separate — it dominates if combined) */}
                      {chartData.some((d) => d.impressions > 0) && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                            <Eye className="h-3 w-3" /> Impressions
                          </p>
                          {chartData.length === 1 ? (
                            <MetricBarSingle
                              label="Impressions"
                              value={chartData[0].impressions}
                              fmtVal={fmtVal}
                              color="hsl(221 83% 53%)"
                            />
                          ) : (
                            <div className="h-48">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtVal(v)} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any) => [Number(v).toLocaleString(), "Impressions"]} />
                                  <Line
                                    type="monotone"
                                    dataKey="impressions"
                                    stroke="hsl(221 83% 53%)"
                                    strokeWidth={2}
                                    dot={{ r: 3 }}
                                    name="Impressions"
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Engagement metrics (all on same scale) */}
                      {chartData.some((d) => d.reactions > 0 || d.link_clicks > 0 || d.comments > 0) && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                            <Heart className="h-3 w-3" /> Engagement Metrics
                          </p>
                          {chartData.length === 1 ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <MetricBarSingle
                                label="Reactions"
                                value={chartData[0].reactions}
                                fmtVal={fmtVal}
                                color="hsl(142 76% 36%)"
                              />
                              <MetricBarSingle
                                label="Link Clicks"
                                value={chartData[0].link_clicks}
                                fmtVal={fmtVal}
                                color="hsl(38 92% 50%)"
                              />
                              <MetricBarSingle
                                label="Comments"
                                value={chartData[0].comments}
                                fmtVal={fmtVal}
                                color="hsl(280 70% 55%)"
                              />
                              <MetricBarSingle
                                label="Shares"
                                value={chartData[0].shares}
                                fmtVal={fmtVal}
                                color="hsl(340 65% 50%)"
                              />
                            </div>
                          ) : (
                            <div className="h-48">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtVal(v)} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any, name: any) => [Number(v).toLocaleString(), name]} />
                                  <Legend />
                                  <Line
                                    type="monotone"
                                    dataKey="reactions"
                                    stroke="hsl(142 76% 36%)"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    name="Reactions"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="link_clicks"
                                    stroke="hsl(38 92% 50%)"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    name="Link Clicks"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="comments"
                                    stroke="hsl(280 70% 55%)"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    name="Comments"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="shares"
                                    stroke="hsl(340 65% 50%)"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    name="Shares"
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Video Views (separate if significant) */}
                      {chartData.some((d) => d.video_views > 0) && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                            <Play className="h-3 w-3" /> Video Views
                          </p>
                          {chartData.length === 1 ? (
                            <MetricBarSingle
                              label="Video Views"
                              value={chartData[0].video_views}
                              fmtVal={fmtVal}
                              color="hsl(280 70% 55%)"
                            />
                          ) : (
                            <div className="h-40">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtVal(v)} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any) => [Number(v).toLocaleString(), "Video Views"]} />
                                  <Line
                                    type="monotone"
                                    dataKey="video_views"
                                    stroke="hsl(280 70% 55%)"
                                    strokeWidth={2}
                                    dot={{ r: 3 }}
                                    name="Video Views"
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Engagement rate trend */}
                {chartData.length > 1 && chartData.some((d) => d.engagement_rate > 0) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Engagement Rate Trend</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        (Reactions + Clicks + Comments + Shares) / Impressions. Higher is better.
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 12 }}
                              label={{
                                value: "Report Date",
                                position: "insideBottom",
                                offset: -5,
                                fontSize: 11,
                                fill: "hsl(var(--muted-foreground))",
                              }}
                            />
                            <YAxis
                              tick={{ fontSize: 12 }}
                              unit="%"
                              label={{
                                value: "Eng. Rate %",
                                angle: -90,
                                position: "insideLeft",
                                fontSize: 11,
                                fill: "hsl(var(--muted-foreground))",
                              }}
                            />
                            <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "Engagement Rate"]} />
                            <Line
                              type="monotone"
                              dataKey="engagement_rate"
                              stroke="hsl(38 92% 50%)"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              name="Engagement Rate"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Connected profiles */}
                <ConnectedProfiles profiles={platformData} />

                {/* AI-powered cumulative insights */}
                <AIDeepInsights reports={filtered} chartData={chartData} />
              </TabsContent>

              <TabsContent value="trends" className="space-y-6 mt-4">
                {/* Trend analysis (TikTok + Instagram) */}
                <TrendInsightsSection reports={filtered} />
              </TabsContent>
            </Tabs>

            {/* Recent reports table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Report History</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {filtered.length} report{filtered.length !== 1 ? "s" : ""} in selected time range. Click any report to
                  view full details.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...filtered].reverse().map((r: any) => {
                    const rawRd = r.report_data;
                    const rd = Array.isArray(rawRd) ? rawRd[0] : rawRd;
                    const sp = rd?.sprout_performance;
                    const totals = extractTotals(sp);
                    const hasMetrics = totals.impressions > 0 || totals.reactions > 0;
                    const totalEng = totals.reactions + totals.link_clicks + totals.comments + totals.shares;
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-3 rounded-md bg-[rgba(255,255,255,0.04)] cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                        onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant="default">{r.status}</Badge>
                          <span className="text-sm">{new Date(r.created_at).toLocaleString()}</span>
                          {hasMetrics && (
                            <span className="text-xs text-muted-foreground">
                              {fmtVal(totals.impressions)} impr · {fmtVal(totalEng)} eng
                            </span>
                          )}
                        </div>
                        {r.duration_minutes && (
                          <span className="text-xs text-muted-foreground">{r.duration_minutes}m</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
        </div>
      </div>
    </AppLayout>
  );
}

/* ─── Summary Card with optional MoM change ─── */
function SummaryCard({
  icon,
  label,
  value,
  change,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4 space-y-1">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {icon}
          {label}
        </div>
        <div className="text-xl font-bold">{value}</div>
        {change != null && change !== 0 && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${change > 0 ? "text-[#10b981]" : "text-destructive"}`}
          >
            {change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {change > 0 ? "+" : ""}
            {change}% MoM
          </div>
        )}
        {change != null && change === 0 && (
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Minus className="h-3 w-3" /> 0% MoM
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Single-value metric bar (for when there's only 1 report) ─── */
function MetricBarSingle({
  label,
  value,
  fmtVal,
  color,
}: {
  label: string;
  value: number;
  fmtVal: (v: number) => string;
  color: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-[rgba(255,255,255,0.03)] space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold" style={{ color }}>
        {fmtVal(value)}
      </p>
    </div>
  );
}
