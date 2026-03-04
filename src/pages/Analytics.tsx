import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { ArrowLeft, Eye, Heart, BarChart3, MousePointerClick, Play } from "lucide-react";
import { TrendInsightsSection } from "@/components/analytics/TrendInsightsSection";
import { ConnectedProfiles } from "@/components/analytics/ConnectedProfiles";
import { AIDeepInsights } from "@/components/analytics/AIDeepInsights";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";

type TimeRange = "7d" | "30d" | "90d" | "all";

export default function Analytics() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>("30d");

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
      reactions: parseNum(totals.reactions || totals.likes || totals.engagements || totals.total_engagements),
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
      const sp = r.report_data?.sprout_performance || {};
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
        video_views: totals.video_views,
        engagements: totalEngagements,
        engagement_rate: Math.round(engRate * 100) / 100,
      };
    });
  }, [filtered]);

  // Latest report comparison data
  const latestReport = filtered.length > 0 ? filtered[filtered.length - 1] : null;
  const comparison = useMemo(() => {
    if (!latestReport) return null;
    const sp = (latestReport as any).report_data?.sprout_performance || {};
    return extractComparison(sp);
  }, [latestReport]);

  // Platform breakdown from latest report
  const platformData = useMemo(() => {
    if (!latestReport) return [];
    const sp = (latestReport as any).report_data?.sprout_performance || {};
    const profiles = sp.profiles || sp.by_profile || [];
    if (!Array.isArray(profiles)) return [];
    return profiles.map((p: any) => ({
      name: p.name || p.profile_name || "Unknown",
      network: p.network || p.network_type || "",
    }));
  }, [latestReport]);

  const title = client ? `Analytics: ${client.name}` : "Analytics";

  return (
    <AppLayout title={title}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/setup`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Client
          </Button>
          <div className="flex gap-1">
            {(["7d", "30d", "90d", "all"] as TimeRange[]).map((r) => (
              <Button key={r} variant={range === r ? "default" : "outline"} size="sm" onClick={() => setRange(r)}>
                {r === "all" ? "All Time" : r}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse text-muted-foreground">Loading analytics...</div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="space-y-3">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="font-semibold">No completed reports yet</h3>
              <p className="text-sm text-muted-foreground">Run at least one analysis to see analytics data here.</p>
              <Button onClick={() => navigate(`/clients/${id}/analyze`)}>Run Analysis</Button>
            </div>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <SummaryCard
                icon={<Eye className="h-4 w-4" />}
                label="Total Impressions"
                value={chartData.reduce((s, d) => s + d.impressions, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<Heart className="h-4 w-4" />}
                label="Reactions"
                value={chartData.reduce((s, d) => s + d.reactions, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<MousePointerClick className="h-4 w-4" />}
                label="Link Clicks"
                value={chartData.reduce((s, d) => s + d.link_clicks, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<Play className="h-4 w-4" />}
                label="Video Views"
                value={chartData.reduce((s, d) => s + d.video_views, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<BarChart3 className="h-4 w-4" />}
                label="Reports Analyzed"
                value={filtered.length.toString()}
              />
            </div>

            {/* Month-over-month comparison from latest report */}
            {comparison && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Month-over-Month Comparison{" "}
                    <span className="font-normal text-muted-foreground text-sm">(latest report)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.entries(comparison.changes).map(([key, val]: [string, any]) => {
                      const pct = val?.percent || 0;
                      const isUp = pct > 0;
                      const isDown = pct < 0;
                      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                      return (
                        <div key={key} className="flex items-center gap-3 p-3 rounded-md bg-muted">
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground">{label}</div>
                            <div className="text-lg font-semibold">{(val?.current || 0).toLocaleString()}</div>
                          </div>
                          <Badge variant={isUp ? "default" : isDown ? "destructive" : "secondary"} className="text-xs">
                            {isUp ? "+" : ""}
                            {pct}%
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Impressions + Engagements over time */}
            {chartData.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Performance Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="impressions" fill="hsl(221 83% 53%)" name="Impressions" />
                        <Bar dataKey="reactions" fill="hsl(142 76% 36%)" name="Reactions" />
                        <Bar dataKey="link_clicks" fill="hsl(38 92% 50%)" name="Link Clicks" />
                        <Bar dataKey="video_views" fill="hsl(280 70% 55%)" name="Video Views" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Engagement rate trend */}
            {chartData.length > 1 && chartData.some((d) => d.engagement_rate > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Engagement Rate Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} unit="%" />
                        <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                        <Line
                          type="monotone"
                          dataKey="engagement_rate"
                          stroke="hsl(38 92% 50%)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          name="Eng. Rate"
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

            {/* Trend analysis (TikTok + Instagram) */}
            <TrendInsightsSection reports={filtered} />

            {/* Recent reports table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Report History ({filtered.length} reports)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {filtered.map((r: any) => {
                    const sp = r.report_data?.sprout_performance;
                    const totals = sp?.overall_totals || {};
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-3 rounded-md bg-muted cursor-pointer hover:bg-muted/80"
                        onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant="default">{r.status}</Badge>
                          <span className="text-sm">{new Date(r.created_at).toLocaleString()}</span>
                          {totals.impressions > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {Number(totals.impressions).toLocaleString()} impr
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
    </AppLayout>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
