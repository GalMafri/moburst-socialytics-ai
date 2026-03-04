import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Users, Heart, Eye, BarChart3, Lightbulb } from "lucide-react";
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

  // Extract time-series metrics from report_data.sprout_performance
  const chartData = useMemo(() => {
    return filtered.map((r: any) => {
      const sp = r.report_data?.sprout_performance || {};
      const totals = sp.totals || sp.summary || {};
      return {
        date: new Date(r.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        fullDate: r.created_at,
        followers: totals.followers || totals.net_follower_growth || 0,
        impressions: totals.impressions || 0,
        engagements: totals.engagements || totals.total_engagements || 0,
        engagement_rate: parseFloat((totals.engagement_rate || totals.avg_engagement_rate || 0).toString()),
        posts: totals.posts_sent || totals.total_posts || 0,
      };
    });
  }, [filtered]);

  // Platform breakdown from latest report
  const latestReport = filtered.length > 0 ? filtered[filtered.length - 1] : null;
  const platformData = useMemo(() => {
    if (!latestReport) return [];
    const sp = (latestReport as any).report_data?.sprout_performance || {};
    const byProfile = sp.by_profile || sp.profiles || [];
    if (!Array.isArray(byProfile)) return [];
    return byProfile.map((p: any) => ({
      name: p.profile_name || p.name || "Unknown",
      network: p.network || p.network_type || "",
      impressions: p.impressions || 0,
      engagements: p.engagements || p.total_engagements || 0,
      followers: p.followers || p.net_follower_growth || 0,
    }));
  }, [latestReport]);

  // Auto-generated insights
  const insights = useMemo(() => {
    if (chartData.length < 2) return [];
    const result: { text: string; type: "up" | "down" | "neutral" }[] = [];
    const first = chartData[0];
    const last = chartData[chartData.length - 1];

    if (last.engagements > first.engagements) {
      const pct =
        first.engagements > 0 ? Math.round(((last.engagements - first.engagements) / first.engagements) * 100) : 0;
      result.push({
        text: `Engagements grew ${pct}% over this period (${first.engagements.toLocaleString()} → ${last.engagements.toLocaleString()})`,
        type: "up",
      });
    } else if (last.engagements < first.engagements) {
      const pct =
        first.engagements > 0 ? Math.round(((first.engagements - last.engagements) / first.engagements) * 100) : 0;
      result.push({
        text: `Engagements dropped ${pct}% over this period`,
        type: "down",
      });
    }

    if (last.impressions > first.impressions) {
      const pct =
        first.impressions > 0 ? Math.round(((last.impressions - first.impressions) / first.impressions) * 100) : 0;
      result.push({
        text: `Impressions increased ${pct}% (${first.impressions.toLocaleString()} → ${last.impressions.toLocaleString()})`,
        type: "up",
      });
    } else if (last.impressions < first.impressions) {
      result.push({ text: `Impressions decreased over this period`, type: "down" });
    }

    if (last.engagement_rate > first.engagement_rate) {
      result.push({
        text: `Engagement rate improved from ${first.engagement_rate.toFixed(2)}% to ${last.engagement_rate.toFixed(2)}%`,
        type: "up",
      });
    }

    // Best performing report
    const bestEng = chartData.reduce((best, d) => (d.engagements > best.engagements ? d : best));
    if (bestEng.engagements > 0) {
      result.push({
        text: `Peak engagement was ${bestEng.engagements.toLocaleString()} on ${bestEng.date}`,
        type: "neutral",
      });
    }

    return result;
  }, [chartData]);

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                icon={<Eye className="h-4 w-4" />}
                label="Total Impressions"
                value={chartData.reduce((s, d) => s + d.impressions, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<Heart className="h-4 w-4" />}
                label="Total Engagements"
                value={chartData.reduce((s, d) => s + d.engagements, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<Users className="h-4 w-4" />}
                label="Follower Growth"
                value={chartData.reduce((s, d) => s + d.followers, 0).toLocaleString()}
              />
              <SummaryCard
                icon={<BarChart3 className="h-4 w-4" />}
                label="Reports Analyzed"
                value={filtered.length.toString()}
              />
            </div>

            {/* Engagement + Impressions over time */}
            {chartData.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Performance Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 89.8%)" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="impressions"
                          stroke="hsl(221 83% 53%)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          name="Impressions"
                        />
                        <Line
                          type="monotone"
                          dataKey="engagements"
                          stroke="hsl(142 76% 36%)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          name="Engagements"
                        />
                      </LineChart>
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
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 89.8%)" />
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

            {/* Platform breakdown from latest report */}
            {platformData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Platform Breakdown{" "}
                    <span className="font-normal text-muted-foreground text-sm">(latest report)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={platformData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 89.8%)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="impressions" fill="hsl(221 83% 53%)" name="Impressions" />
                        <Bar dataKey="engagements" fill="hsl(142 76% 36%)" name="Engagements" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Auto-generated insights */}
            {insights.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" /> Auto-Generated Insights
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {insights.map((ins, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        {ins.type === "up" ? (
                          <TrendingUp className="h-4 w-4 text-success shrink-0 mt-0.5" />
                        ) : ins.type === "down" ? (
                          <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        ) : (
                          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <span>{ins.text}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent reports table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Report History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {filtered.map((r: any) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-3 rounded-md bg-muted cursor-pointer hover:bg-muted/80"
                      onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="default">{r.status}</Badge>
                        <span className="text-sm">{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      {r.duration_minutes && (
                        <span className="text-xs text-muted-foreground">{r.duration_minutes}m</span>
                      )}
                    </div>
                  ))}
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
