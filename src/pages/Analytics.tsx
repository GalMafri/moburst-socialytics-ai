import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  Filter,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useState, useMemo } from "react";

type TimeFilter = "weekly" | "monthly" | "quarterly";
type ViewMode = "trends" | "performance" | "both";

export default function Analytics() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("monthly");
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [excludedReportIds, setExcludedReportIds] = useState<Set<string>>(new Set());

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("name").eq("id", id!).maybeSingle();
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

  const toggleReportExclusion = (reportId: string) => {
    setExcludedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  };

  const filteredReports = useMemo(() => {
    if (!reports) return [];
    let filtered = reports.filter((r) => !excludedReportIds.has(r.id));

    const now = new Date();
    if (timeFilter === "weekly") {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7 * 12);
      filtered = filtered.filter((r) => new Date(r.created_at!) >= weekAgo);
    } else if (timeFilter === "monthly") {
      const monthsAgo = new Date(now);
      monthsAgo.setMonth(monthsAgo.getMonth() - 12);
      filtered = filtered.filter((r) => new Date(r.created_at!) >= monthsAgo);
    } else if (timeFilter === "quarterly") {
      const quartersAgo = new Date(now);
      quartersAgo.setMonth(quartersAgo.getMonth() - 36);
      filtered = filtered.filter((r) => new Date(r.created_at!) >= quartersAgo);
    }

    return filtered;
  }, [reports, excludedReportIds, timeFilter]);

  const performanceData = useMemo(() => {
    return filteredReports.map((r) => {
      const rd = Array.isArray(r.report_data) ? (r.report_data as any)[0] : (r.report_data as any);
      const current = rd?.sprout_performance?.month_comparison?.current_month || {};
      const changes = rd?.sprout_performance?.month_comparison?.changes || {};
      return {
        date: new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        report_id: r.id,
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
  }, [filteredReports]);

  const trendsData = useMemo(() => {
    return filteredReports.map((r) => {
      const rd = Array.isArray(r.report_data) ? (r.report_data as any)[0] : (r.report_data as any);
      const tiktok = rd?.tiktok_trends?.posts || [];
      const instagram = rd?.instagram_trends?.posts || [];
      const recs = rd?.ai_analysis?.content_recommendations || [];
      return {
        date: new Date(r.created_at!).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        report_id: r.id,
        tiktok_trends: tiktok.filter((p: any) => !p._empty).length,
        instagram_trends: instagram.filter((p: any) => !p._empty).length,
        recommendations: recs.length,
        avg_tiktok_engagement: tiktok.length > 0
          ? Math.round(tiktok.reduce((s: number, p: any) => s + (p.engagement_score || 0), 0) / tiktok.length)
          : 0,
        avg_instagram_engagement: instagram.length > 0
          ? Math.round(instagram.reduce((s: number, p: any) => s + (p.engagement_score || 0), 0) / instagram.length)
          : 0,
      };
    });
  }, [filteredReports]);

  const insights = useMemo(() => {
    if (performanceData.length < 2) return [];
    const result: string[] = [];
    const latest = performanceData[performanceData.length - 1];
    const prev = performanceData[performanceData.length - 2];

    if (latest.impressions > prev.impressions) {
      const pct = prev.impressions > 0 ? Math.round(((latest.impressions - prev.impressions) / prev.impressions) * 100) : 0;
      result.push(`Impressions grew ${pct}% from the previous report period, indicating expanding reach.`);
    } else if (latest.impressions < prev.impressions) {
      const pct = prev.impressions > 0 ? Math.round(((prev.impressions - latest.impressions) / prev.impressions) * 100) : 0;
      result.push(`Impressions declined ${pct}% from the previous report period. Consider boosting content distribution.`);
    }

    if (latest.reactions > prev.reactions) {
      result.push(`Engagement (reactions) is trending upward, suggesting content resonates well with the audience.`);
    }

    if (performanceData.length >= 3) {
      const avgImpressions = performanceData.reduce((s, d) => s + d.impressions, 0) / performanceData.length;
      if (latest.impressions > avgImpressions * 1.2) {
        result.push(`Current impressions are above the historical average, indicating a positive growth trend.`);
      }
    }

    if (trendsData.length >= 2) {
      const latestTrends = trendsData[trendsData.length - 1];
      if (latestTrends.avg_tiktok_engagement > 0) {
        result.push(`Average TikTok trend engagement score this period: ${latestTrends.avg_tiktok_engagement.toLocaleString()}.`);
      }
    }

    return result;
  }, [performanceData, trendsData]);

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return value.toString();
  };

  if (isLoading) {
    return (
      <AppLayout>
        <p className="text-muted-foreground p-8">Loading analytics...</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-8 max-w-7xl mx-auto">

        {/* Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {client?.name} Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              Aggregated insights from {filteredReports.length} reports
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="both">Trends &amp; Performance</TabsTrigger>
                <TabsTrigger value="performance">Performance Only</TabsTrigger>
                <TabsTrigger value="trends">Trends Only</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </div>

        {/* Report Filter */}
        {reports && reports.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" /> Report Filter
              </CardTitle>
              <CardDescription>Uncheck reports to exclude them from analytics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {reports.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={!excludedReportIds.has(r.id)}
                      onCheckedChange={() => toggleReportExclusion(r.id)}
                    />
                    <Label className="text-sm cursor-pointer">
                      {new Date(r.created_at).toLocaleDateString()}
                    </Label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4" /> Aggregated Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm text-foreground">
                    <Badge variant="secondary" className="mt-0.5 shrink-0">
                      {i + 1}
                    </Badge>
                    {insight}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Performance Charts */}
        {(viewMode === "performance" || viewMode === "both") && performanceData.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground">
              <BarChart3 className="h-5 w-5" /> Performance Over Time
            </h2>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Engagement Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis tickFormatter={formatYAxis} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(value: number) => [value.toLocaleString(), undefined]} />
                    <Legend />
                    <Line type="monotone" dataKey="impressions" name="Impressions" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="reactions" name="Reactions" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="link_clicks" name="Link Clicks" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="video_views" name="Video Views" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* MoM Change Rates */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Month-over-Month Change (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis tickFormatter={(v: number) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(value: number) => [`${value}%`, undefined]} />
                    <Legend />
                    <Line type="monotone" dataKey="impressions_pct" name="Impressions %" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="reactions_pct" name="Reactions %" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="video_views_pct" name="Video Views %" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trends Charts */}
        {(viewMode === "trends" || viewMode === "both") && trendsData.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground">
              <TrendingUp className="h-5 w-5" /> Trends Over Time
            </h2>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Trend Volume &amp; Engagement</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={trendsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--card-foreground))" }} formatter={(value: number) => [value.toLocaleString(), undefined]} />
                    <Legend />
                    <Line type="monotone" dataKey="tiktok_trends" name="TikTok Trends" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="instagram_trends" name="Instagram Trends" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="recommendations" name="Recommendations" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="avg_tiktok_engagement" name="Avg TikTok Engagement" stroke="hsl(var(--chart-4))" strokeDasharray="5 5" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {filteredReports.length === 0 && (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground mb-4">No completed reports to analyze yet.</p>
            <Button onClick={() => navigate(`/clients/${id}/analyze`)}>
              Run your first analysis
            </Button>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}