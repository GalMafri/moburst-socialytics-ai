import { SPROUT_RATE_LABEL, SPROUT_RATE_NOTE } from "@/lib/rateLabels";
import { chunkWindow, DateRange, isValidRange, localToday, PRESET_LABELS, presetRange, rangeDays, rangesOverlap, reportPeriod, toISODate, yesterdayIn } from "@/lib/dateRange";
import { cleanText, countOf, countryNames, NO_DATA, firstRunSentence, formatDate, formatDateTime, formatNumbersInText, formatRange, languageNames } from "@/lib/display";
import { useNextRun } from "@/lib/nextRun";
import { useStrategyOnlyClients } from "@/lib/strategyOnly";
import { sproutEngagementRate, sproutEngagements } from "@/lib/reportFigures";
import { describeChange, StatCard } from "@/components/ui/stat-card";
import { Section, SectionNav } from "@/components/ui/section";
import { PostVisual, postType, usePostPreviews } from "@/components/competitive/PostVisual";
import { PlatformBadge } from "@/lib/platform-config";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatGrid } from "@/components/ui/stat-card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/hooks/useAuth";
import { Segment, SegmentedGroup } from "@/components/ui/segmented";
import { Card, CardContent } from "@/components/ui/card";
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
import { LoadRetry } from "@/components/ui/load-error";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { coverageLine, formatCount, reportsMeasure } from "@/lib/platformMeasures";
import { useReportInsights } from "@/hooks/useReportInsights";
import { shownSocial } from "../../supabase/functions/_shared/reports/shownFields";
import { withoutDashes } from "../../supabase/functions/_shared/trends/text";

type TimeRange = "7d" | "30d" | "90d" | "all" | "custom";
type AnalyticsView = "performance" | "trends";

/** Where "All time" starts for the weekly trends: before the first week ever collected. */
const TRENDS_ALL_TIME_FROM = "2000-01-01";

export default function Analytics() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();
  const [range, setRange] = useState<TimeRange>("30d");
  // What is typed in the two date fields, and the last complete valid window it made. Only a
  // complete valid window is applied, so a field emptied while typing keeps the last figures.
  const [draft, setDraft] = useState<DateRange | null>(null);
  const [applied, setApplied] = useState<DateRange | null>(null);
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

  // Days are the client's own: a preset ends on the client's yesterday, and no date past it can be asked for.
  const zone = client?.timezone || undefined;
  const lastDay = yesterdayIn(zone);
  const defaultCustom = useMemo(() => presetRange("30d", new Date(), zone), [zone]);
  const fields: DateRange = draft ?? applied ?? defaultCustom;
  const customWindow: DateRange = applied ?? defaultCustom;
  const changeField = (key: keyof DateRange, value: string) => {
    const next = { ...fields, [key]: value };
    setDraft(next);
    if (isValidRange(next) && next.end <= lastDay) setApplied(next);
  };

  const nextMonthly = useNextRun(id, "monthly");
  const { data: reports, isLoading, isError: reportsFailed, error: reportsError, refetch: refetchReports } = useQuery({
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
    if (range === "custom") return customWindow;
    return presetRange(range, new Date(), zone);
  }, [range, customWindow, zone]);
  const filtered = useMemo(() => {
    if (!reports) return [];
    if (!viewWindow) return reports;
    return reports.filter((r: any) => rangesOverlap(reportPeriod(r), viewWindow));
  }, [reports, viewWindow]);
  // Weekly trends are stored by the Monday their week starts. The Trends tab asks
  // for the weeks inside the same window as the rest of the page; "All time" asks for every week stored.
  const trendsWindow = useMemo<DateRange>(() => viewWindow ?? { start: TRENDS_ALL_TIME_FROM, end: localToday(zone) }, [viewWindow, zone]);
  const rangeLabel = range === "all" ? "All time" : range === "custom" ? formatRange(customWindow) : PRESET_LABELS[range];

  // Live Sprout numbers for the selected window. Reports only hold month-level
  // snapshots, so presets and custom ranges are answered by Sprout directly.
  // A window the function answers in one call comes with the equal-length
  // period before it for comparison; a longer one is asked for in year-sized
  // calls without a comparison and combined (the same path All time takes).
  // QA 22 Nov 2026: the strategy-only and access gates mount this page hidden
  // while they decide, so Sprout is asked only once the client row has loaded
  // (a client the viewer cannot read has none) and it is known not to be
  // strategy-only. Asking before that drew a 422 or 403 on every such visit.
  const strategyOnly = useStrategyOnlyClients();
  const mayAskSprout = !!id && !!client && !strategyOnly.isLoading && !strategyOnly.has(id);
  const liveQuery = useQuery({
    queryKey: ["sprout-analytics", id, viewWindow?.start, viewWindow?.end],
    queryFn: () => fetchSproutWindow(id!, viewWindow!),
    enabled: mayAskSprout && !!viewWindow,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    refetchInterval: askAgainWhileNetworkMissing,
  });
  const liveData = viewWindow ? liveQuery.data : null;

  // "All time" is answered live as well: every day from the first period we
  // have tracked for this client through today, in year-sized calls.
  const allTimeWindow = useMemo<DateRange | null>(() => {
    if (range !== "all" || !reports) return null;
    const today = localToday(zone);
    const starts = reports.map((r: any) => reportPeriod(r).start).filter(Boolean).sort();
    const start = starts[0] || toISODate(new Date(Date.now() - 365 * 86400000));
    return start <= today ? { start, end: today } : { start: today, end: today };
  }, [range, reports, zone]);
  const allTimeQuery = useQuery({
    queryKey: ["sprout-analytics-all", id, allTimeWindow?.start, allTimeWindow?.end],
    queryFn: () => fetchSproutWindow(id!, allTimeWindow!, true),
    enabled: mayAskSprout && !!allTimeWindow,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    refetchInterval: askAgainWhileNetworkMissing,
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
      // The one definition: engagements divided by impressions (reportFigures.ts).
      const raw = sp?.overall_totals || sp?.totals || sp?.summary || sp?.month_comparison?.current_month || {};
      const totalEngagements = sproutEngagements(raw) ?? 0;
      const engRate = (sproutEngagementRate(raw) ?? 0) * 100;
      return {
        date: formatDate(r.created_at, { year: false }),
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

  // The client's connected profiles: the active ones as they are now, whatever window is shown.
  const { data: profilesRows } = useQuery({
    queryKey: ["analytics-profiles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("id, profile_name, native_name, network_type")
        .eq("client_id", id!)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    // A read that did not answer is asked again, quietly; the card appears when it does.
    retry: 3,
    refetchInterval: (q) => (q.state.status === "error" ? 15_000 : false),
  });
  const platformData = useMemo(
    () => (profilesRows ?? []).map((p: any) => ({ name: p.profile_name || p.native_name || "", network: p.network_type || "" })),
    [profilesRows],
  );

  // The latest report's insights, worked out from its figures (report_insights); its own fields otherwise (shownFields.ts).
  const { data: latestInsightsRow } = useReportInsights("reports", (latestReport as { id?: string } | null)?.id);

  // The latest report's analysis, read one way for both Takeaway lines.
  const latestAnalysis = useMemo(() => {
    if (!latestRd) return null;
    return shownSocial(latestRd.ai_analysis, latestInsightsRow).analysis || {};
  }, [latestRd, latestInsightsRow]);

  // Extract AI summary from latest report for the Takeaway card
  const latestAISummary = useMemo(() => {
    const ai = latestAnalysis;
    if (!ai) return null;
    // Try multiple paths where the AI summary might live
    const summary =
      ai.sprout_performance_analysis?.month_over_month_summary ||
      ai.sprout_performance_analysis?.overall_summary ||
      ai.executive_summary ||
      ai.summary ||
      null;
    if (!summary || (typeof summary === "string" && summary.trim().length === 0)) return null;
    return withoutDashes(typeof summary === "string" ? summary : JSON.stringify(summary));
  }, [latestAnalysis]);

  // The top-performing content line: the reports store a list of sentences; older ones a list of objects.
  const topContentInsight = useMemo(() => {
    const ai = latestAnalysis;
    if (!ai) return null;
    const topContent = ai.sprout_performance_analysis?.top_performing_content || ai.top_content_summary || null;
    if (!topContent) return null;
    const line = (x: any): string | null => {
      if (typeof x === "string") return x.trim() || null;
      return x?.insight || x?.summary || x?.description || null;
    };
    const text = Array.isArray(topContent) ? line(topContent[0]) : line(topContent);
    return text ? withoutDashes(text) : null;
  }, [latestAnalysis]);

  const title = client ? `Analytics: ${client.name}` : "Analytics";

  // Format large numbers for display
  const fmtVal = formatCount;

  const exportRef = useRef<HTMLDivElement>(null);
  const pdfFilename = `${client?.name || "client"}_analytics_${range}_${new Date().toISOString().split("T")[0]}`;

  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* The period is a filter, so it is the shared segmented control, not a
          row of lime buttons (lime is for the page's primary action). */}
      <SegmentedGroup label="Period">
        {(["7d", "30d", "90d", "all", "custom"] as TimeRange[]).map((r) => (
          <Segment key={r} active={range === r} onClick={() => setRange(r)}>
            {r === "all" ? "All time" : PRESET_LABELS[r]}
          </Segment>
        ))}
      </SegmentedGroup>
      {range === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Start date"
            value={fields.start}
            max={fields.end || lastDay}
            onChange={(e) => changeField("start", e.target.value)}
            className="h-9 w-40"
          />
          <span className="t-label">to</span>
          <Input
            type="date"
            aria-label="End date"
            value={fields.end}
            min={fields.start}
            max={lastDay}
            onChange={(e) => changeField("end", e.target.value)}
            className="h-9 w-40"
          />
        </div>
      )}
      <ExportPdfButton
        contentRef={exportRef}
        filename={pdfFilename}
        title={`${client?.name || "Client"}: Analytics (${rangeLabel})`}
      />
    </div>
  );

  // One running order per tab. The rail drops what this client has no data for.
  const navItems =
    view === "performance"
      ? [
          { id: "live-by-profile", label: "By profile" },
          { id: "live-top-posts", label: "Top posts" },
          { id: "mom", label: "Month over month" },
          { id: "over-time", label: "Performance over time" },
          { id: "engagement-rate", label: SPROUT_RATE_LABEL },
          { id: "profiles", label: "Connected profiles" },
          { id: "insights", label: "Across the reports in this window" },
          { id: "history", label: "Report history" },
        ]
      : view === "trends"
        ? [{ id: "trends", label: "Trend insights" }]
        : [
            { id: "snapshot-numbers", label: "The numbers" },
            { id: "snapshot-summary", label: "Summary" },
            { id: "snapshot-takeaways", label: "What the report used" },
            { id: "snapshot-gaps", label: "Gaps to fill" },
            { id: "snapshot-airtime", label: "Empty airtime" },
          ];

  // The view tabs. Trends are collected weekly and the competitive view has its own reports, so neither waits for a monthly report.
  const viewTabList = (
    <TabsList className="grid w-full grid-cols-3 sm:max-w-md">
      <TabsTrigger value="performance" className="gap-1.5">
        <BarChart3 className="h-3.5 w-3.5" /> Performance
      </TabsTrigger>
      <TabsTrigger value="trends" className="gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" /> Trends
      </TabsTrigger>
      <TabsTrigger value="competitive" className="gap-1.5">
        <Crosshair className="h-3.5 w-3.5" /> Competitive
      </TabsTrigger>
    </TabsList>
  );
  const reportFreeTabs = (
    <>
      <TabsContent value="trends" className="space-y-section mt-section">
        {/* The weekly themes of the client's industry, across every platform. */}
        <TrendInsightsSection clientId={id!} from={trendsWindow.start} to={trendsWindow.end} />
      </TabsContent>
      <TabsContent value="competitive" className="space-y-section mt-section">
        <div id="competitive" className="scroll-mt-[156px]">
          <CompetitiveSnapshot clientId={id!} />
        </div>
      </TabsContent>
    </>
  );

  return (
    <AppLayout
      nav={<SectionNav items={navItems} />}
      title={title}
      description="Performance for the selected window, weekly industry trends, and the competitive view."
      back={
        // Client setup is the team's page; a client user goes back to their dashboard.
        <Button variant="ghost" size="sm" className="-ml-2 border-0 bg-transparent" onClick={() => navigate(isMoburstStaff ? `/clients/${id}/setup` : "/")}>
          <ArrowLeft /> {isMoburstStaff ? "Back to client" : "Back to dashboard"}
        </Button>
      }
      actions={toolbar}
      meta={
        client && (client.geo || client.language) ? (
          <>
            {countryNames(client.geo) && <Badge variant="outline">Market: {countryNames(client.geo)}</Badge>}
            {languageNames(client.language) && <Badge variant="outline">Language: {languageNames(client.language)}</Badge>}
          </>
        ) : undefined
      }
    >
        <div ref={exportRef} className="space-y-section">

        {isLoading ? (
          <Loading label="Loading analytics" />
        ) : reportsFailed ? (
          // "No completed reports yet" would be a claim about this client's
          // history made on the strength of a request that never answered.
          <LoadRetry
            context="client reports"
            error={reportsError}
            onRetry={() => refetchReports()}
          />
        ) : filtered.length === 0 && !viewWindow && !allTimeQuery.data && !allTimeQuery.isLoading && !allTimeQuery.isError ? (
          // Performance has nothing to show without a report and without live
          // figures (QA 22 Nov 2026: All time is answered live, so a client in
          // its first month sees them here; only a client with no Sprout
          // profiles has none). Trends and Competitive do not need one, so their tabs stay open.
          <Tabs value={view} onValueChange={(v) => setView(v as AnalyticsView)}>
            {viewTabList}
            <TabsContent value="performance" className="mt-section">
              {/* What exists: when the first report runs, if one is scheduled. Never a setup step. */}
              <EmptyState
                icon={BarChart3}
                title="No reports yet"
                description={firstRunSentence("monthly", nextMonthly.data, client?.timezone || undefined) || "Figures appear here once the first monthly report is ready."}
              />
            </TabsContent>
            {reportFreeTabs}
          </Tabs>
        ) : (
          <>
            {/* View segmentation */}
            <Tabs value={view} onValueChange={(v) => setView(v as AnalyticsView)}>
              {viewTabList}

              <TabsContent value="performance" className="space-y-section mt-section">
                {viewWindow && (
                  <LiveSproutSection
                    data={liveData}
                    isLoading={liveQuery.isLoading}
                    error={liveQuery.error as Error | null}
                    onRetry={() => liveQuery.refetch()}
                    rangeLabel={rangeLabel}
                    fmtVal={fmtVal}
                    idPrefix="live"
                  />
                )}
                {range === "all" && allTimeWindow && (
                  <LiveSproutSection
                    data={allTimeQuery.data}
                    isLoading={allTimeQuery.isLoading}
                    error={allTimeQuery.error as Error | null}
                    onRetry={() => allTimeQuery.refetch()}
                    rangeLabel={`All time · ${formatRange(allTimeWindow)}`}
                    fmtVal={fmtVal}
                    idPrefix="live"
                  />
                )}
                {/* Summary cards — latest report metrics (All time view) */}
                {viewWindow || filtered.length === 0 ? null : latestTotals ? (
                  <div>
                    <p className="t-secondary mb-2 flex items-center gap-1.5">
                      <BarChart3 className="h-3 w-3" />
                      Latest report snapshot{latestReport ? ` for ${formatRange(reportPeriod(latestReport as any))}` : ""}
                    </p>
                    <StatGrid>
                      <SummaryCard
                        icon={<Eye className="h-3.5 w-3.5" />}
                        label="Impressions"
                        value={fmtVal(latestTotals.impressions)}
                        change={comparison?.changes?.impressions}
                      />
                      <SummaryCard
                        icon={<Heart className="h-3.5 w-3.5" />}
                        label="Reactions"
                        value={fmtVal(latestTotals.reactions)}
                        change={comparison?.changes?.reactions}
                      />
                      <SummaryCard
                        icon={<MousePointerClick className="h-3.5 w-3.5" />}
                        label="Link clicks"
                        value={fmtVal(latestTotals.link_clicks)}
                        change={comparison?.changes?.link_clicks}
                      />
                      <SummaryCard
                        icon={<Play className="h-3.5 w-3.5" />}
                        label="Video views"
                        value={fmtVal(latestTotals.video_views)}
                        change={comparison?.changes?.video_views}
                      />
                      <SummaryCard
                        icon={<MessageCircle className="h-3.5 w-3.5" />}
                        label="Comments"
                        value={fmtVal(latestTotals.comments)}
                        change={comparison?.changes?.comments}
                      />
                      <SummaryCard
                        icon={<Share2 className="h-3.5 w-3.5" />}
                        label="Shares"
                        value={fmtVal(latestTotals.shares)}
                        change={comparison?.changes?.shares}
                      />
                    </StatGrid>
                  </div>
                ) : (
                  <StatGrid>
                    <SummaryCard
                      icon={<BarChart3 className="h-3.5 w-3.5" />}
                      label="Reports"
                      value={filtered.length.toString()}
                    />
                  </StatGrid>
                )}

                {/* Key Takeaway — AI summary from latest report */}
                {latestAISummary && (
                  <Card className="glass-accent">
                    <CardContent>
                      <div className="flex items-start gap-3">
                        <div className="rounded-full bg-primary/10 p-2 shrink-0">
                          <Sparkles className="h-4 w-4 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <p className="t-h4">Takeaway from the latest monthly report</p>
                          {latestReport && <p className="t-label">Written from the report for {formatRange(reportPeriod(latestReport as any))}.</p>}
                          <p className="t-secondary leading-relaxed">
                            {formatNumbersInText(latestAISummary)}
                          </p>
                          {topContentInsight && (
                            <p className="t-label pt-2 border-t border-[rgba(255,255,255,0.06)] mt-2">
                              <Lightbulb className="h-3 w-3 inline mr-1" />
                              {formatNumbersInText(topContentInsight)}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Month over month comparison from the latest report */}
                {!viewWindow && comparison && Object.keys(comparison.changes).length > 0 && (
                  <Section id="mom" title="Month over month" meta="Latest report">
                  <Card>
                    <CardContent className="pt-5">
                      <div className="grid gap-inner [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
                        {Object.entries(comparison.changes).map(([key, val]: [string, any]) => {
                          const current = val?.current ?? 0;
                          const previous = val?.previous ?? comparison.previous?.[key] ?? 0;
                          // The one wording of a change: a percent, or "from 1 to 19" on a tiny base.
                          const change = describeChange({ previous, current, percent: typeof val?.percent === "number" ? val.percent : null });
                          const isUp = change?.direction === "up";
                          const isDown = change?.direction === "down";
                          return (
                            <div key={key} className="glass-inner flex items-center gap-3 p-inner">
                              <div className="flex-1">
                                <div className="t-secondary">{metricLabel(key)}</div>
                                <div className="t-h3">{fmtVal(current)}</div>
                                {previous > 0 && (
                                  <div className="t-secondary">Previous: {fmtVal(previous)}</div>
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
                                  {change ? change.text : NO_DATA}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  </Section>
                )}

                {/* Performance over time — Per-metric line charts */}
                {chartData.length >= 1 && chartData.some((d) => d.impressions > 0 || d.reactions > 0) && (
                  <Section id="over-time" title="Performance over time" meta={`${filtered.length} report${filtered.length !== 1 ? "s" : ""}`} description={chartData.length === 1 ? "The figures from the latest report." : "One point for each report. Hover over a point for its exact value."}>
                  <Card>
                    <CardContent className="pt-5 space-y-6">
                      {/* Impressions chart (separate — it dominates if combined) */}
                      {chartData.some((d) => d.impressions > 0) && (
                        <div>
                          <p className="t-subhead mb-2 flex items-center gap-1.5">
                            <Eye className="h-3 w-3" /> Impressions
                          </p>
                          {chartData.length === 1 ? (
                            <MetricBarSingle
                              label="Impressions"
                              value={chartData[0].impressions}
                              fmtVal={fmtVal}
                              color="#b9e045"
                            />
                          ) : (
                            <div className="h-48">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtVal(v)} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any) => [Number(v).toLocaleString(), "Impressions"]} />
                                  <Line
                                    type="monotone"
                                    dataKey="impressions"
                                    stroke="#b9e045"
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 2, stroke: "#0b0c10" }}
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
                          <p className="t-subhead mb-2 flex items-center gap-1.5">
                            <Heart className="h-3 w-3" /> Engagement metrics
                          </p>
                          {chartData.length === 1 ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <MetricBarSingle
                                label="Reactions"
                                value={chartData[0].reactions}
                                fmtVal={fmtVal}
                                color="hsl(var(--chart-2))"
                              />
                              <MetricBarSingle
                                label="Link clicks"
                                value={chartData[0].link_clicks}
                                fmtVal={fmtVal}
                                color="hsl(var(--chart-3))"
                              />
                              <MetricBarSingle
                                label="Comments"
                                value={chartData[0].comments}
                                fmtVal={fmtVal}
                                color="hsl(var(--chart-5))"
                              />
                              <MetricBarSingle
                                label="Shares"
                                value={chartData[0].shares}
                                fmtVal={fmtVal}
                                color="hsl(var(--warning))"
                              />
                            </div>
                          ) : (
                            <div className="h-48">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtVal(v)} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any, name: any) => [Number(v).toLocaleString(), name]} />
                                  <Legend />
                                  <Line
                                    type="monotone"
                                    dataKey="reactions"
                                    stroke="hsl(var(--chart-2))"
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 2, stroke: "#0b0c10" }}
                                    name="Reactions"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="link_clicks"
                                    stroke="hsl(var(--chart-3))"
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 2, stroke: "#0b0c10" }}
                                    name="Link clicks"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="comments"
                                    stroke="hsl(var(--chart-5))"
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 2, stroke: "#0b0c10" }}
                                    name="Comments"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="shares"
                                    stroke="hsl(var(--warning))"
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 2, stroke: "#0b0c10" }}
                                    name="Shares"
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Video views (separate if significant) */}
                      {chartData.some((d) => d.video_views > 0) && (
                        <div>
                          <p className="t-subhead mb-2 flex items-center gap-1.5">
                            <Play className="h-3 w-3" /> Video views
                          </p>
                          {chartData.length === 1 ? (
                            <MetricBarSingle
                              label="Video views"
                              value={chartData[0].video_views}
                              fmtVal={fmtVal}
                              color="hsl(var(--chart-5))"
                            />
                          ) : (
                            <div className="h-40">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtVal(v)} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any) => [Number(v).toLocaleString(), "Video views"]} />
                                  <Line
                                    type="monotone"
                                    dataKey="video_views"
                                    stroke="hsl(var(--chart-5))"
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 2, stroke: "#0b0c10" }}
                                    name="Video views"
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  </Section>
                )}

                {/* Engagement rate trend */}
                {chartData.length > 1 && chartData.some((d) => d.engagement_rate > 0) && (
                  <Section id="engagement-rate" title={<>{SPROUT_RATE_LABEL} trend</>} description={<>{SPROUT_RATE_NOTE}.</>}>
                  <Card>
                    <CardContent className="pt-5">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 12 }}
                              label={{
                                value: "Report date",
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
                                value: "Engagement rate (%)",
                                angle: -90,
                                position: "insideLeft",
                                fontSize: 11,
                                fill: "hsl(var(--muted-foreground))",
                              }}
                            />
                            <Tooltip contentStyle={{ backgroundColor: "rgba(26, 29, 35, 0.95)", borderColor: "rgba(255, 255, 255, 0.08)", borderRadius: "12px", backdropFilter: "blur(16px)", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} formatter={(v: any) => [`${Number(v).toFixed(2)}%`, SPROUT_RATE_LABEL]} />
                            <Line
                              type="monotone"
                              dataKey="engagement_rate"
                              stroke="hsl(var(--chart-3))"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              name={SPROUT_RATE_LABEL}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                  </Section>
                )}

                {/* Connected profiles */}
                <div id="profiles" className="scroll-mt-[156px]">
                  <ConnectedProfiles profiles={platformData} />
                </div>

                {/* AI-powered cumulative insights */}
                <div id="insights" className="scroll-mt-[156px]">
                  <AIDeepInsights clientId={id!} reports={filtered} chartData={chartData} />
                </div>

                {/* Report history: part of Performance, and only when the window holds a report. */}
                {filtered.length > 0 && (
                <Section id="history" title="Report history" meta={countOf(filtered.length, "report")} description="Every report in the selected period, each with its full detail.">
                <Card>
                  <CardContent>
                    <div className="space-y-2">
                      {[...filtered].reverse().map((r: any) => {
                        const rawRd = r.report_data;
                        const rd = Array.isArray(rawRd) ? rawRd[0] : rawRd;
                        const sp = rd?.sprout_performance;
                        const totals = extractTotals(sp);
                        const hasMetrics = totals.impressions > 0 || totals.reactions > 0;
                        const totalEng = sproutEngagements(sp?.overall_totals || sp?.totals || sp?.summary || sp?.month_comparison?.current_month) ?? 0;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className="glass-inner w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 p-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}
                            aria-label={`Open report from ${formatDateTime(r.created_at)}`}
                          >
                              <span className="t-body">{formatDateTime(r.created_at)}</span>
                              {hasMetrics && (
                                <span className="t-label">
                                  {fmtVal(totals.impressions)} impressions · {fmtVal(totalEng)} engagements
                                </span>
                              )}
                            {/* How long a run took is for the team, not the client. */}
                            <span className="ml-auto flex items-center gap-3">
                              {isMoburstStaff && r.duration_minutes ? <span className="t-label">{r.duration_minutes} min</span> : null}
                              <span className="t-link">Open report</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
                </Section>
                )}
              </TabsContent>

              {reportFreeTabs}
            </Tabs>

          </>
        )}
        </div>
    </AppLayout>
  );
}

/* ─── Long windows: split into year-sized calls and combine the answers ─── */
const SPROUT_METRIC_KEYS = ["impressions", "reactions", "post_link_clicks", "video_views", "comments", "shares"] as const;
/** sprout-analytics answers 422 when no Sprout profile is assigned to the client (it has no live figures). */
function noSproutProfiles(error: unknown): boolean {
  return (error as { context?: { status?: unknown } } | null)?.context?.status === 422;
}
/**
 * A network whose posts did not answer leaves the other networks' posts on screen and is asked
 * again, quietly, a few times (no note about it: a gap that fills itself needs no flag).
 */
const askAgainWhileNetworkMissing = (q: { state: { data?: unknown; dataUpdateCount: number } }) =>
  ((q.state.data as { top_posts_failed_networks?: unknown[] } | null | undefined)?.top_posts_failed_networks?.length ?? 0) > 0 && q.state.dataUpdateCount < 4 ? 30_000 : false;

/**
 * The live figures for a window. One call answers up to a year; a longer window (or All time) is
 * asked for year by year with no comparison read (the page does not show one) and combined.
 */
async function fetchSproutWindow(clientId: string, window: DateRange, combine = false) {
  const parts = chunkWindow(window);
  const chunked = combine || parts.length > 1;
  const chunks: any[] = [];
  for (const w of parts) {
    const { data, error } = await supabase.functions.invoke("sprout-analytics", {
      body: chunked ? { client_id: clientId, start: w.start, end: w.end, compare: false } : { client_id: clientId, start: w.start, end: w.end },
    });
    // A client with no Sprout profiles has no live figures: that is its state, not a load to try again.
    if (noSproutProfiles(error)) return null;
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    chunks.push(data);
  }
  return chunked ? mergeSproutChunks(chunks, window) : chunks[0];
}
/** A post's reach as the function ranks it (views on YouTube, impressions elsewhere). */
const postReach = (p: any) => Number(p?.reach ?? p?.impressions ?? 0);
function mergeSproutChunks(chunks: any[], window: DateRange) {
  const zero = () => Object.fromEntries(SPROUT_METRIC_KEYS.map((k) => [k, 0])) as Record<string, number>;
  const totals = zero();
  const byProfile = new Map<string, any>();
  const posts: any[] = [];
  const daily: any[] = [];
  let profiles: any[] = [];
  let client: any = null;
  const failedNetworks = new Set<string>();
  for (const c of chunks) {
    if (!c) continue;
    for (const n of c.top_posts_failed_networks || []) failedNetworks.add(n);
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
  posts.sort((a, b) => postReach(b) - postReach(a));
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
    top_posts_failed_networks: [...failedNetworks],
    chunks: chunks.length,
    fetched_at: new Date().toISOString(),
  };
}

/* ─── Summary Card with optional MoM change ─── */
/** The two period values of a change, as the stored reports and the live answer both carry them. */
type MetricChange = { percent?: number | null; previous?: number | null; current?: number | null } | null | undefined;
/** The comparison label every tile and the report page use. */
const VS_PREVIOUS = "vs previous period";
function SummaryCard({ icon, label, value, change, sub }: { icon: React.ReactNode; label: string; value: string; change?: MetricChange; sub?: string }) {
  const hasChange = change != null && (typeof change.percent === "number" || (typeof change.previous === "number" && typeof change.current === "number"));
  return (
    <StatCard
      icon={icon}
      label={label}
      value={value}
      sub={sub}
      delta={hasChange ? { percent: change?.percent ?? undefined, from: change?.previous ?? undefined, to: change?.current ?? undefined, label: VS_PREVIOUS } : undefined}
    />
  );
}

/** One sentence-case label per measure, for every place the page names one. */
const METRIC_LABELS: Record<string, string> = {
  impressions: "Impressions",
  reactions: "Reactions",
  link_clicks: "Link clicks",
  post_link_clicks: "Link clicks",
  video_views: "Video views",
  comments: "Comments",
  shares: "Shares",
  engagements: "Engagements",
  engagement_rate: "Engagement rate",
};
const metricLabel = (key: string) => METRIC_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

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
    <div className="glass-inner p-inner space-y-1 border-l-2" style={{ borderLeftColor: color }}>
      <p className="t-subhead">{label}</p>
      <p className="t-h3">{fmtVal(value)}</p>
    </div>
  );
}


/* ─── Live Sprout data for the selected window ─── */
function LiveSproutSection({
  data,
  isLoading,
  error,
  onRetry,
  rangeLabel,
  fmtVal,
  idPrefix,
}: {
  data: any;
  isLoading: boolean;
  error: Error | null;
  /** Asks Sprout again; a load that did not answer keeps loading and tries again on its own. */
  onRetry: () => unknown;
  rangeLabel: string;
  fmtVal: (v: number) => string;
  /** This block renders twice on the page (window and all-time), so its
   *  section ids carry a prefix and stay unique for the nav to anchor to. */
  idPrefix?: string;
}) {
  const posts: any[] = data?.top_posts || [];
  // The top posts' own picture (from Sprout) and type are the hint that lets the preview be kept.
  const { previews } = usePostPreviews(posts.map((p) => ({ url: p.permalink, image: p.thumbnail_url, mediaType: p.media_type })));
  if (isLoading) return <Loading label={`Loading figures for ${rangeLabel}`} />;
  if (error) return <LoadRetry context="live Sprout figures" error={error} label={`Loading figures for ${rangeLabel}`} onRetry={onRetry} />;
  if (!data) return null;
  const t = data.totals || {};
  const ch = data.changes || {};
  // The networks the client has, so a total that leaves one out can say which it covers.
  const networks: string[] = (Array.isArray(data.by_profile) && data.by_profile.length ? data.by_profile : data.profiles || []).map((p: any) => p.network).filter(Boolean);
  const measureFor = (key: string) => (key === "post_link_clicks" ? "link_clicks" : key);
  const metric = (key: string) => {
    const measure = measureFor(key);
    // A measure none of the client's networks report has no figure to show.
    if (networks.length > 0 && !networks.some((n) => reportsMeasure(n, measure))) return NO_DATA;
    return fmtVal(Number(t[key] || 0));
  };
  const note = (key: string) => coverageLine(networks, measureFor(key)) ?? undefined;
  const change = (key: string) => ch[key] as MetricChange;
  return (
    <div className="space-y-section">
      <div className="space-y-3">
        <p className="t-secondary flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#b1b7c1]" aria-hidden />
          {data.previous_range
            ? <>{rangeLabel} · compared with the {data.previous_range.days} days before ({formatRange(data.previous_range)})</>
            : <>{rangeLabel}</>}
        </p>
        <StatGrid>
          <SummaryCard icon={<Eye className="h-3.5 w-3.5" />} label={metricLabel("impressions")} value={metric("impressions")} change={change("impressions")} sub={note("impressions")} />
          <SummaryCard icon={<Heart className="h-3.5 w-3.5" />} label={metricLabel("reactions")} value={metric("reactions")} change={change("reactions")} sub={note("reactions")} />
          <SummaryCard icon={<MousePointerClick className="h-3.5 w-3.5" />} label={metricLabel("post_link_clicks")} value={metric("post_link_clicks")} change={change("post_link_clicks")} sub={note("post_link_clicks")} />
          <SummaryCard icon={<Play className="h-3.5 w-3.5" />} label={metricLabel("video_views")} value={metric("video_views")} change={change("video_views")} sub={note("video_views")} />
          <SummaryCard icon={<MessageCircle className="h-3.5 w-3.5" />} label={metricLabel("comments")} value={metric("comments")} change={change("comments")} sub={note("comments")} />
          <SummaryCard icon={<Share2 className="h-3.5 w-3.5" />} label={metricLabel("shares")} value={metric("shares")} change={change("shares")} sub={note("shares")} />
        </StatGrid>
      </div>

      {Array.isArray(data.by_profile) && data.by_profile.length > 0 && (
        <Section id={idPrefix ? `${idPrefix}-by-profile` : undefined} title="By profile" meta={rangeLabel}>
        <Card>
          <CardContent>
            <div className="grid gap-inner [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
              {data.by_profile.map((p: any) => (
                <div key={p.profile_id} className="glass-inner p-inner space-y-2">
                  <div className="flex items-center gap-2">
                    {p.network && <PlatformBadge platform={p.network} size="sm" />}
                    <span className="t-h4 truncate">{p.name}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {reportsMeasure(p.network, "impressions") && <div><p className="t-h3 tabular-nums">{fmtVal(p.impressions || 0)}</p><p className="t-label">Impressions</p></div>}
                    <div><p className="t-h3 tabular-nums">{fmtVal(p.reactions || 0)}</p><p className="t-label">Reactions</p></div>
                    <div><p className="t-h3 tabular-nums">{fmtVal(p.video_views || 0)}</p><p className="t-label">Video views</p></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        </Section>
      )}

      {posts.length > 0 && (
        <Section id={idPrefix ? `${idPrefix}-top-posts` : undefined} title="Top posts" meta={`${rangeLabel}, ranked by reach`} description="Totals to date for each post.">
        <Card>
          <CardContent>
            <div className="grid gap-inner md:grid-cols-2">
              {posts.slice(0, 6).map((p: any, i: number) => (
                <div key={i} className="flex gap-4 glass-inner p-inner">
                  <PostVisual url={p.permalink} image={p.thumbnail_url} preview={p.permalink ? previews[p.permalink] : null} mediaType={p.media_type || postType(p)} platform={p.network_type} className="w-28 shrink-0 self-start" compact />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      {p.network_type ? <PlatformBadge platform={p.network_type} size="sm" /> : <span />}
                      <span className="t-secondary">{formatDate(p.posted_at)}</span>
                    </div>
                    <p className="t-body line-clamp-3 whitespace-pre-line">{p.text ? cleanText(p.text) : "No caption."}</p>
                    <div className="flex items-center gap-4 t-secondary">
                      {(() => {
                        // Views on YouTube, impressions where the network reports them.
                        const reach = postReach(p);
                        return (reportsMeasure(p.network_type, "impressions") || reach > 0) ? <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{fmtVal(reach)}</span> : null;
                      })()}
                      <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{fmtVal(p.reactions || 0)}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{fmtVal(p.comments || 0)}</span>
                      <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{fmtVal(p.shares || 0)}</span>
                    </div>
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noopener" className="t-link inline-flex items-center gap-1 min-h-[24px]">
                        View original <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        </Section>
      )}
    </div>
  );
}
