import { DateRange, formatRange, isValidRange, PRESET_LABELS, presetRange, rangeDays, rangesOverlap, reportPeriod, toISODate } from "@/lib/dateRange";
import { StatCard } from "@/components/ui/stat-card";
import { PostVisual, usePostPreviews } from "@/components/competitive/PostVisual";
import { PlatformBadge } from "@/lib/platform-config";
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
  Lightbulb,
  Sparkles,
  Crosshair,
  ExternalLink,
} from "lucide-react";
import { TrendInsightsSection } from "@/components/analytics/TrendInsightsSection";
import { ConnectedProfiles } from "@/components/analytics/ConnectedProfiles";
import { AIDeepInsights } from "@/components/analytics/AIDeepInsights";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompetitiveSnapshot } from "@/components/competitive/CompetitiveSnapshot";
import { Loading } from "@/components/ui/loading";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

type TimeRange = "7d" | "30d" | "90d" | "all" | "custom";
type AnalyticsView = "performance" | "trends";

export default function Analytics() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>("30d");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("30d"));
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

  // The window being viewed. A report counts when the period it describes
  // overlaps the window, so "Last 30 days" shows the report about those days
  // rather than whichever report happened to be generated inside them.
  const viewWindow = useMemo<DateRange | null>(() => {
    if (range === "all") return null;
    if (range === "custom") return isValidRange(custom) ? custom : null;
    return presetRange(range);
  }, [range, custom]);
  const filtered = useMemo(() => {
    if (!reports) return [];
    if (!viewWindow) return reports;
    return reports.filter((r: any) => rangesOverlap(reportPeriod(r), viewWindow));
  }, [reports, viewWindow]);
  const rangeLabel = range === "all" ? "All Time" : range === "custom" ? (viewWindow ? formatRange(viewWindow) : "Custom") : PRESET_LABELS[range];

  // Live Sprout numbers for the selected window. Reports only hold month-level
  // snapshots, so presets and custom ranges are answered by Sprout directly,
  // with the equal-length period before the window for comparison.
  const liveQuery = useQuery({
    queryKey: ["sprout-analytics", id, viewWindow?.start, viewWindow?.end],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("sprout-analytics", { body: { client_id: id, start: viewWindow!.start, end: viewWindow!.end } });
      if (error) throw new Error((error as any)?.message || "Could not load Sprout data");
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    enabled: !!id && !!viewWindow,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const liveData = viewWindow ? liveQuery.data : null;

  // "All time" is answered live as well: every day from the first period we
  // have tracked for this client through today, fetched in year-sized chunks
  // (the function answers at most a year per call) and added up.
  const allTimeWindow = useMemo<DateRange | null>(() => {
    if (range !== "all" || !reports) return null;
    const today = toISODate(new Date());
    const starts = reports.map((r: any) => reportPeriod(r).start).filter(Boolean).sort();
    const start = starts[0] || toISODate(new Date(Date.now() - 365 * 86400000));
    return start <= today ? { start, end: today } : { start: today, end: today };
  }, [range, reports]);
  const allTimeQuery = useQuery({
    queryKey: ["sprout-analytics-all", id, allTimeWindow?.start, allTimeWindow?.end],
    queryFn: async () => {
      const chunks: any[] = [];
      for (const w of chunkWindow(allTimeWindow!)) {
        const { data, error } = await supabase.functions.invoke("sprout-analytics", { body: { client_id: id, start: w.start, end: w.end } });
        if (error) throw new Error((error as any)?.message || "Could not load Sprout data");
        if ((data as any)?.error) throw new Error((data as any).error);
        chunks.push(data);
      }
      return mergeSproutChunks(chunks, allTimeWindow!);
    },
    enabled: !!id && !!allTimeWindow,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

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
    <AppLayout
      title={title}
      description={[
        "Live Sprout performance for the selected window, trends from the monthly reports, and the competitive view.",
        client?.geo ? `Market: ${client.geo}` : null,
        client?.language ? `Language: ${client.language}` : null,
      ].filter(Boolean).join(" · ")}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/setup`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Client
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 flex-wrap items-center">
              {(["7d", "30d", "90d", "all", "custom"] as TimeRange[]).map((r) => (
                <Button
                  key={r}
                  variant={range === r ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                >
                  {r === "all" ? "All Time" : r === "custom" ? "Custom" : r}
                </Button>
              ))}
              {range === "custom" && (
                <div className="flex items-center gap-1.5 ml-1">
                  <input
                    type="date"
                    aria-label="Start date"
                    value={custom.start}
                    max={custom.end}
                    onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <span className="t-secondary">to</span>
                  <input
                    type="date"
                    aria-label="End date"
                    value={custom.end}
                    min={custom.start}
                    onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              )}
            </div>
            <ExportPdfButton
              contentRef={exportRef}
              filename={pdfFilename}
              title={`${client?.name || "Client"} — Analytics (${rangeLabel})`}
            />
          </div>
        </div>

        <div ref={exportRef} className="space-y-6">

        {isLoading ? (
          <Loading label="Loading analytics" />
        ) : filtered.length === 0 && !viewWindow ? (
          <Card className="p-12 text-center">
            <div className="space-y-3">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="font-semibold">No completed reports yet</h3>
              <p className="t-secondary">
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
              <TabsList className="grid w-full grid-cols-3 max-w-md">
                <TabsTrigger value="performance" className="gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" /> Performance
                </TabsTrigger>
                <TabsTrigger value="trends" className="gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Trends
                </TabsTrigger>
                <TabsTrigger value="competitive" className="gap-1.5">
                  <Crosshair className="h-4 w-4" /> Competitive
                </TabsTrigger>
              </TabsList>

              <TabsContent value="performance" className="space-y-6 mt-4">
                {viewWindow && (
                  <LiveSproutSection
                    data={liveData}
                    isLoading={liveQuery.isLoading}
                    error={liveQuery.error as Error | null}
                    rangeLabel={rangeLabel}
                    fmtVal={fmtVal}
                  />
                )}
                {range === "all" && allTimeWindow && (
                  <LiveSproutSection
                    data={allTimeQuery.data}
                    isLoading={allTimeQuery.isLoading}
                    error={allTimeQuery.error as Error | null}
                    rangeLabel={`All time (${formatRange(allTimeWindow)})`}
                    fmtVal={fmtVal}
                  />
                )}
                {/* Summary cards — latest report metrics (All Time view) */}
                {viewWindow ? null : latestTotals ? (
                  <div>
                    <p className="t-secondary mb-2 flex items-center gap-1.5">
                      <BarChart3 className="h-3 w-3" />
                      Latest report snapshot{latestReport ? ` for ${formatRange(reportPeriod(latestReport as any))}` : ""}. The all-time totals above cover every tracked day.
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
                          <h4 className="t-body font-semibold">Key Takeaway</h4>
                          <p className="t-secondary leading-relaxed">
                            {formatNumbersInText(latestAISummary)}
                          </p>
                          {topContentInsight && (
                            <p className="t-secondary/80 pt-1 border-t border-[rgba(255,255,255,0.04)] mt-2">
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
                {(reports?.length ?? 0) === 1 && (
                  <Card className="border-dashed">
                    <CardContent className="pt-5 pb-4 px-5 text-center space-y-2">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <TrendingUp className="h-4 w-4" />
                        <span className="t-body font-medium">Want to see trends over time?</span>
                      </div>
                      <p className="t-secondary">
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
                {!viewWindow && comparison && Object.keys(comparison.changes).length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="t-h3">
                        Month-over-Month{" "}
                        <span className="font-normal text-muted-foreground t-body">(latest report)</span>
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
                                <div className="t-secondary">{label}</div>
                                <div className="t-h3">{fmtVal(current)}</div>
                                {previous > 0 && (
                                  <div className="t-secondary">prev: {fmtVal(previous)}</div>
                                )}
                              </div>
                              <div className="text-right">
                                <Badge
                                  variant={isUp ? "default" : isDown ? "destructive" : "secondary"}
                                  className="t-label"
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
                      <CardTitle className="t-h3">
                        Performance Over Time
                        <span className="font-normal text-muted-foreground t-body ml-2">
                          ({filtered.length} report{filtered.length !== 1 ? "s" : ""})
                        </span>
                      </CardTitle>
                      <p className="t-secondary">
                        {chartData.length === 1
                          ? "Showing your latest snapshot. Run more analyses to see trend lines."
                          : "Each data point represents one analysis run. Hover over points for exact values."}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Impressions chart (separate — it dominates if combined) */}
                      {chartData.some((d) => d.impressions > 0) && (
                        <div>
                          <p className="t-label font-medium mb-2 flex items-center gap-1.5">
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
                          <p className="t-label font-medium mb-2 flex items-center gap-1.5">
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
                          <p className="t-label font-medium mb-2 flex items-center gap-1.5">
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
                      <CardTitle className="t-h3">Engagement Rate Trend</CardTitle>
                      <p className="t-secondary">
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
              <TabsContent value="competitive" className="space-y-6 mt-4">
                <CompetitiveSnapshot clientId={id!} />
              </TabsContent>
            </Tabs>

            {/* Recent reports table */}
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Report History</CardTitle>
                <p className="t-secondary">
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
                      <button
                        key={r.id}
                        type="button"
                        className="w-full text-left flex items-center justify-between p-3 rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.06)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}
                        aria-label={`Open report from ${new Date(r.created_at).toLocaleString()}`}
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant="default">{r.status}</Badge>
                          <span className="t-body">{new Date(r.created_at).toLocaleString()}</span>
                          {hasMetrics && (
                            <span className="t-secondary">
                              {fmtVal(totals.impressions)} impr · {fmtVal(totalEng)} eng
                            </span>
                          )}
                        </div>
                        {r.duration_minutes && (
                          <span className="t-secondary">{r.duration_minutes}m</span>
                        )}
                      </button>
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

/* ─── All-time helpers: split a long window into ≤366-day chunks and add the answers up ─── */
const SPROUT_METRIC_KEYS = ["impressions", "reactions", "post_link_clicks", "video_views", "comments", "shares"] as const;
function chunkWindow(w: DateRange, maxDays = 366): DateRange[] {
  const out: DateRange[] = [];
  let s = new Date(`${w.start}T00:00:00Z`);
  const end = new Date(`${w.end}T00:00:00Z`);
  while (s <= end) {
    const e = new Date(Math.min(s.getTime() + (maxDays - 1) * 86400000, end.getTime()));
    out.push({ start: toISODate(s), end: toISODate(e) });
    s = new Date(e.getTime() + 86400000);
  }
  return out;
}
function mergeSproutChunks(chunks: any[], window: DateRange) {
  const zero = () => Object.fromEntries(SPROUT_METRIC_KEYS.map((k) => [k, 0])) as Record<string, number>;
  const totals = zero();
  const byProfile = new Map<string, any>();
  const posts: any[] = [];
  const daily: any[] = [];
  let profiles: any[] = [];
  let client: any = null;
  for (const c of chunks) {
    if (!c) continue;
    client = client || c.client;
    if (Array.isArray(c.profiles) && c.profiles.length) profiles = c.profiles;
    for (const k of SPROUT_METRIC_KEYS) totals[k] += Number(c.totals?.[k] || 0);
    for (const p of c.by_profile || []) {
      const cur = byProfile.get(p.profile_id) || { profile_id: p.profile_id, name: p.name, network: p.network, ...zero() };
      for (const k of SPROUT_METRIC_KEYS) cur[k] += Number(p[k] || 0);
      byProfile.set(p.profile_id, cur);
    }
    posts.push(...(c.top_posts || []));
    if (Array.isArray(c.daily)) daily.push(...c.daily);
  }
  posts.sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0));
  return {
    client,
    range: { start: window.start, end: window.end, days: rangeDays(window) },
    previous_range: null,
    profiles,
    totals,
    previous_totals: null,
    changes: {},
    daily,
    by_profile: [...byProfile.values()],
    top_posts: posts.slice(0, 20),
    chunks: chunks.length,
    fetched_at: new Date().toISOString(),
  };
}

/* ─── Summary Card with optional MoM change ─── */
function SummaryCard({ icon, label, value, change }: { icon: React.ReactNode; label: string; value: string; change?: number }) {
  return <StatCard icon={icon} label={label} value={value} delta={change != null ? { percent: change, label: "vs prev." } : undefined} />;
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
      <p className="t-secondary">{label}</p>
      <p className="text-lg font-bold" style={{ color }}>
        {fmtVal(value)}
      </p>
    </div>
  );
}


/* ─── Live Sprout data for the selected window ─── */
function LiveSproutSection({
  data,
  isLoading,
  error,
  rangeLabel,
  fmtVal,
}: {
  data: any;
  isLoading: boolean;
  error: Error | null;
  rangeLabel: string;
  fmtVal: (v: number) => string;
}) {
  const posts: any[] = data?.top_posts || [];
  const { previews } = usePostPreviews(posts.map((p) => p.permalink));
  if (isLoading) return <Loading label={`Loading Sprout data for ${rangeLabel}`} />;
  if (error) {
    return (
      <Card>
        <CardContent className="pt-5 t-secondary">
          Live Sprout data is not available for this window: {error.message}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;
  const t = data.totals || {};
  const ch = data.changes || {};
  const metric = (key: string) => fmtVal(Number(t[key] || 0));
  const pct = (key: string) => (typeof ch[key]?.percent === "number" ? ch[key].percent : undefined);
  return (
    <div className="space-y-6">
      <div>
        <p className="t-secondary mb-2 flex items-center gap-1.5">
          <BarChart3 className="h-3 w-3" />
          {data.previous_range
            ? <>Sprout data for {rangeLabel} · compared with the {data.previous_range.days} days before ({formatRange(data.previous_range)})</>
            : <>Live Sprout totals for {rangeLabel}: every day from {formatRange(data.range)} added up{data.chunks > 1 ? ` across ${data.chunks} requests` : ""}</>}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard icon={<Eye className="h-3.5 w-3.5" />} label="Impressions" value={metric("impressions")} change={pct("impressions")} />
          <SummaryCard icon={<Heart className="h-3.5 w-3.5" />} label="Reactions" value={metric("reactions")} change={pct("reactions")} />
          <SummaryCard icon={<MousePointerClick className="h-3.5 w-3.5" />} label="Link Clicks" value={metric("post_link_clicks")} change={pct("post_link_clicks")} />
          <SummaryCard icon={<Play className="h-3.5 w-3.5" />} label="Video Views" value={metric("video_views")} change={pct("video_views")} />
          <SummaryCard icon={<MessageCircle className="h-3.5 w-3.5" />} label="Comments" value={metric("comments")} change={pct("comments")} />
          <SummaryCard icon={<Share2 className="h-3.5 w-3.5" />} label="Shares" value={metric("shares")} change={pct("shares")} />
        </div>
      </div>

      {Array.isArray(data.by_profile) && data.by_profile.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="t-h3">By profile <span className="font-normal text-muted-foreground t-body">({rangeLabel})</span></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.by_profile.map((p: any) => (
                <div key={p.profile_id} className="glass-inner p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    {p.network && <PlatformBadge platform={p.network} size="sm" />}
                  </div>
                  <div className="grid grid-cols-3 gap-2 t-body">
                    <div><p className="font-semibold">{fmtVal(p.impressions || 0)}</p><p className="t-secondary uppercase tracking-wider">Impr.</p></div>
                    <div><p className="font-semibold">{fmtVal(p.reactions || 0)}</p><p className="t-secondary uppercase tracking-wider">Reactions</p></div>
                    <div><p className="font-semibold">{fmtVal(p.video_views || 0)}</p><p className="t-secondary uppercase tracking-wider">Views</p></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {posts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="t-h3">Top posts <span className="font-normal text-muted-foreground t-body">({rangeLabel}, by impressions)</span></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {posts.slice(0, 6).map((p: any, i: number) => (
                <div key={i} className="flex gap-4 glass-inner p-4">
                  <PostVisual url={p.permalink} preview={p.permalink ? previews[p.permalink] : null} mediaType={p.post_type} platform={p.network_type} className="w-28 shrink-0" compact />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      {p.network_type ? <PlatformBadge platform={p.network_type} size="sm" /> : <span />}
                      <span className="t-secondary">{p.posted_at ? new Date(p.posted_at).toLocaleDateString() : ""}</span>
                    </div>
                    <p className="t-body line-clamp-3">{p.text || "(no caption)"}</p>
                    <div className="flex items-center gap-4 t-secondary">
                      <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{fmtVal(p.impressions || 0)}</span>
                      <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{fmtVal(p.reactions || 0)}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{fmtVal(p.comments || 0)}</span>
                      <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{fmtVal(p.shares || 0)}</span>
                    </div>
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noopener" className="t-label text-primary hover:underline flex items-center gap-1">
                        View Original <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
