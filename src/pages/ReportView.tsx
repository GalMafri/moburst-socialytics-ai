import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
  Calendar,
  Clock,
  Lightbulb,
  Copy,
  BarChart3,
  Sparkles,
  Target,
} from "lucide-react";
import { PlatformBadge, PlatformIcon, getPlatformColor } from "@/lib/platform-config";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useState, useRef } from "react";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { ReportActions } from "@/components/reports/ReportActions";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";

export default function ReportView() {
  const { id, reportId } = useParams();
  const reportContentRef = useRef<HTMLDivElement>(null);
  useRealtimeReports(id);

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*, clients(name)")
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
        <div className="animate-pulse text-muted-foreground">Loading report...</div>
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

  const sproutPerformance = rd?.sprout_performance || {};
  const monthComparison = sproutPerformance?.month_comparison || {};
  const aiAnalysis = rd?.ai_analysis || {};
  const tiktokTrends = rd?.tiktok_trends || {};
  const instagramTrends = rd?.instagram_trends || {};
  const contentCalendar = rd?.content_calendar || aiAnalysis?.content_calendar || [];

  // Build available tabs
  const tabs: { value: string; label: string; icon: React.ReactNode }[] = [
    { value: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  ];
  if (aiAnalysis?.content_recommendations?.length > 0 || contentCalendar.length > 0) {
    tabs.push({ value: "content", label: "Content Ideas", icon: <Sparkles className="h-4 w-4" /> });
  }
  if (aiAnalysis?.tiktok_trends_analysis || tiktokTrends?.posts?.length || aiAnalysis?.instagram_trends_analysis || instagramTrends?.posts?.length) {
    tabs.push({ value: "trends", label: "Trends", icon: <TrendingUp className="h-4 w-4" /> });
  }

  return (
    <AppLayout title={`Report: ${clientName}`}>
      <div className="max-w-6xl mx-auto space-y-6" ref={reportContentRef}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">{clientName} Report</h2>
            <p className="text-sm text-muted-foreground">
              {rd?.report_period?.current_month?.start} — {rd?.report_period?.current_month?.end}
              {" · "}Generated {new Date(report.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportPdfButton contentRef={reportContentRef} filename={`${clientName}-report-${new Date(report.created_at).toISOString().slice(0, 10)}`} />
            {(report.gamma_url || rd?.gamma_url) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(report.gamma_url || rd?.gamma_url, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-1.5" /> Gamma Deck
              </Button>
            )}
            <ReportActions report={report} />
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                {t.icon} {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-8">
            {/* Metrics */}
            {monthComparison?.changes && <MetricsCards changes={monthComparison.changes} />}

            {/* Chart */}
            {monthComparison?.current_month && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Month-over-Month Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <PerformanceChart comparison={monthComparison} />
                </CardContent>
              </Card>
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
                      {aiAnalysis.sprout_performance_analysis.month_over_month_summary}
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
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                  {aiAnalysis.sprout_performance_analysis.top_performing_content?.length > 0 && (
                    <div className="mt-5 pt-4 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Top Performing Content Types</p>
                      <div className="flex flex-wrap gap-2">
                        {aiAnalysis.sprout_performance_analysis.top_performing_content.map((c: string, i: number) => (
                          <Badge key={i} variant="secondary">{c}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Top Posts */}
            {sproutPerformance?.top_posts?.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold">Top Performing Posts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sproutPerformance.top_posts.slice(0, 4).map((post: any, i: number) => (
                    <PostCard key={i} post={post} />
                  ))}
                </div>
              </div>
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
                        <p className="text-xs font-medium text-muted-foreground">✅ Well Represented</p>
                        <div className="flex flex-wrap gap-1.5">
                          {aiAnalysis.sprout_performance_analysis.pillar_alignment.well_represented.map((p: string) => (
                            <Badge key={p} variant="secondary">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">⚠️ Needs Attention</p>
                        <div className="flex flex-wrap gap-1.5">
                          {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented.map((p: string) => (
                            <Badge key={p} variant="outline">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations?.length > 0 && (
                    <div className="pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Recommendations</p>
                      <ul className="space-y-1.5">
                        {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations.map((r: string, i: number) => (
                          <li key={i} className="text-sm leading-relaxed text-muted-foreground">• {r}</li>
                        ))}
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
          <TabsContent value="content" className="space-y-8">
            {/* Recommendations */}
            {aiAnalysis?.content_recommendations?.length > 0 && (
              <ContentRecommendations recommendations={aiAnalysis.content_recommendations} />
            )}

            {/* Calendar */}
            {contentCalendar.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Weekly Content Calendar
                </h3>
                <div className="space-y-4">
                  {contentCalendar.map((day: any, dayIdx: number) => (
                    <Card key={dayIdx}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                            {dayIdx + 1}
                          </span>
                          {day.day}
                          {day.date_label && (
                            <span className="text-xs text-muted-foreground font-normal">({day.date_label})</span>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {(day.posts || []).map((post: any, postIdx: number) => (
                          <CalendarPostCard key={postIdx} post={post} />
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
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

/* ─── Content Recommendations ─── */
function ContentRecommendations({ recommendations }: { recommendations: any[] }) {
  const [platformFilter, setPlatformFilter] = useState("all");
  const platforms = [...new Set(recommendations.map((r: any) => r.platform).filter(Boolean))];
  const filtered = platformFilter === "all" ? recommendations : recommendations.filter((r: any) => r.platform === platformFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Content Recommendations
        </h3>
        <div className="flex gap-1.5">
          <Badge
            variant={platformFilter === "all" ? "default" : "outline"}
            className="cursor-pointer text-xs"
            onClick={() => setPlatformFilter("all")}
          >
            All
          </Badge>
          {platforms.map((p) => (
            <span
              key={p}
              className="cursor-pointer"
              onClick={() => setPlatformFilter(p)}
            >
              <PlatformBadge
                platform={p}
                className={platformFilter === p ? "ring-1 ring-offset-1 ring-current" : "opacity-70 hover:opacity-100"}
                size="sm"
              />
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {filtered.map((rec: any, i: number) => (
          <Card key={i}>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <PlatformBadge platform={rec.platform} size="sm" />
                <Badge variant="outline">{rec.format}</Badge>
                {rec.addresses_pillar && (
                  <Badge className="bg-accent text-accent-foreground text-xs">{rec.addresses_pillar}</Badge>
                )}
              </div>
              <blockquote className="border-l-2 border-primary pl-4 text-sm font-medium leading-relaxed">
                {rec.hook}
              </blockquote>
              <p className="text-sm leading-relaxed">{rec.concept}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
                {rec.caption_angle && (
                  <div>
                    <span className="font-medium text-foreground">Caption angle: </span>{rec.caption_angle}
                  </div>
                )}
                {rec.cta && (
                  <div>
                    <span className="font-medium text-foreground">CTA: </span>{rec.cta}
                  </div>
                )}
              </div>
              {rec.visual_direction && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Visual: </span>{rec.visual_direction}
                </p>
              )}
              {rec.why_this && (
                <div className="bg-muted/50 p-3 rounded-md text-sm leading-relaxed text-muted-foreground">
                  💡 {rec.why_this}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─── Calendar Post Card ─── */
function CalendarPostCard({ post }: { post: any }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const fullText =
      post.copy + (post.hashtags?.length ? "\n\n" + post.hashtags.map((h: string) => `#${h}`).join(" ") : "");
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={post.platform} size="sm" />
          <Badge variant="outline">{post.format}</Badge>
          {post.pillar && <Badge className="bg-accent text-accent-foreground text-xs">{post.pillar}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {post.posting_time && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {post.posting_time}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 px-2">
            <Copy className="h-3.5 w-3.5 mr-1" />
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>

      <div className="bg-background rounded-md p-3 border">
        <p className="text-sm leading-relaxed whitespace-pre-line">{post.copy}</p>
        {post.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t">
            {post.hashtags.map((h: string) => (
              <span key={h} className="text-xs text-primary">#{h}</span>
            ))}
          </div>
        )}
      </div>

      {post.visual_direction && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Visual: </span>{post.visual_direction}
        </p>
      )}
      {post.rationale && (
        <div className="bg-muted/50 p-3 rounded-md text-sm leading-relaxed text-muted-foreground">
          💡 {post.rationale}
        </div>
      )}
    </div>
  );
}

/* ─── Metrics Cards ─── */
function MetricsCards({ changes }: { changes: Record<string, any> }) {
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
        return (
          <Card key={key}>
            <CardContent className="pt-4 pb-3 px-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <p className="text-xl font-bold tracking-tight">{(d.current ?? 0).toLocaleString()}</p>
              <div className={`flex items-center gap-1 text-xs font-medium ${color}`}>
                {pct > 0 ? <TrendingUp className="h-3 w-3" /> : pct < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                {pct > 0 ? "+" : ""}{pct}%
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Performance Chart ─── */
function PerformanceChart({ comparison }: { comparison: any }) {
  const chartData = Object.keys(comparison.current_month || {}).map((key) => ({
    name: key.replace(/_/g, " "),
    Current: comparison.current_month[key],
    Previous: comparison.previous_month?.[key] ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" className="text-xs" />
        <YAxis className="text-xs" />
        <Tooltip />
        <Legend />
        <Bar dataKey="Current" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Previous" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{(post.impressions ?? 0).toLocaleString()}</span>
          <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{(post.reactions ?? post.likes ?? 0).toLocaleString()}</span>
          <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{(post.comments ?? 0).toLocaleString()}</span>
          <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{(post.shares ?? 0).toLocaleString()}</span>
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
          {analysis?.overview && (
            <p className="text-sm text-muted-foreground line-clamp-1">{analysis.overview}</p>
          )}
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
                    <Badge
                      key={t}
                      variant="secondary"
                      className="px-3 py-1 text-sm"
                    >
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
                      #{h}
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
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
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
                    {post.engagement_score != null && (
                      <Badge variant="secondary" className="text-xs">
                        Score: {post.engagement_score.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed line-clamp-3">{post.caption}</p>
                  {post.hashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {post.hashtags.slice(0, 5).map((h: string) => (
                        <span key={h} className="text-xs text-primary font-mono">#{h}</span>
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