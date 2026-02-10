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
  Calendar,
  Clock,
  Lightbulb,
  Copy,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useState } from "react";

export default function ReportView() {
  const { id, reportId } = useParams();

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

  return (
    <AppLayout title={`Report: ${clientName}`}>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Executive Summary */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{clientName} Report</h2>
              <p className="text-sm text-muted-foreground">
                {rd?.report_period?.current_month?.start} — {rd?.report_period?.current_month?.end}
                {" • "}Generated {new Date(report.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              {(report.gamma_url || rd?.gamma_url) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(report.gamma_url || rd?.gamma_url, "_blank")}
                >
                  <ExternalLink className="h-4 w-4 mr-1" /> Gamma Presentation
                </Button>
              )}
            </div>
          </div>

          {monthComparison?.changes && <MetricsCards changes={monthComparison.changes} />}
        </section>

        {/* Performance Chart */}
        {monthComparison?.current_month && (
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Month-over-Month Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <PerformanceChart comparison={monthComparison} />
              </CardContent>
            </Card>
          </section>
        )}

        {/* Performance Insights */}
        {aiAnalysis?.sprout_performance_analysis?.key_insights?.length > 0 && (
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" /> Performance Insights
                </CardTitle>
                {aiAnalysis.sprout_performance_analysis.month_over_month_summary && (
                  <CardDescription className="text-sm mt-1">
                    {aiAnalysis.sprout_performance_analysis.month_over_month_summary}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  {aiAnalysis.sprout_performance_analysis.key_insights.map((insight: string, i: number) => (
                    <li key={i}>{insight}</li>
                  ))}
                </ol>
                {aiAnalysis.sprout_performance_analysis.top_performing_content?.length > 0 && (
                  <div className="mt-4">
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
          </section>
        )}

        {/* Top Posts */}
        {sproutPerformance?.top_posts?.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Top Performing Posts</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sproutPerformance.top_posts.slice(0, 6).map((post: any, i: number) => (
                <PostCard key={i} post={post} />
              ))}
            </div>
          </section>
        )}

        {/* Pillar Analysis */}
        {aiAnalysis?.sprout_performance_analysis?.pillar_alignment && (
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Content Pillar Alignment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {aiAnalysis.sprout_performance_analysis.pillar_alignment.well_represented?.map((p: string) => (
                    <Badge key={p} className="bg-success text-success-foreground">
                      {p}
                    </Badge>
                  ))}
                  {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented?.map((p: string) => (
                    <Badge key={p} variant="destructive">
                      {p}
                    </Badge>
                  ))}
                </div>
                {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations && (
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations.map(
                      (r: string, i: number) => (
                        <li key={i}>{r}</li>
                      ),
                    )}
                  </ol>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Trends */}
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

        {/* Content Recommendations */}
        {aiAnalysis?.content_recommendations?.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Content Recommendations</h3>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {["Instagram", "TikTok", "LinkedIn", "Facebook"].map((p) => (
                  <TabsTrigger key={p} value={p}>
                    {p}
                  </TabsTrigger>
                ))}
              </TabsList>
              {["all", "Instagram", "TikTok", "LinkedIn", "Facebook"].map((tab) => (
                <TabsContent key={tab} value={tab} className="space-y-4 mt-4">
                  {aiAnalysis.content_recommendations
                    .filter((r: any) => tab === "all" || r.platform === tab)
                    .map((rec: any, i: number) => (
                      <Card key={i}>
                        <CardContent className="pt-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{rec.platform}</Badge>
                            <Badge variant="outline">{rec.format}</Badge>
                            {rec.addresses_pillar && (
                              <Badge className="bg-accent text-accent-foreground text-xs">{rec.addresses_pillar}</Badge>
                            )}
                          </div>
                          <blockquote className="border-l-2 border-accent pl-3 italic text-sm font-medium">
                            {rec.hook}
                          </blockquote>
                          <p className="text-sm">{rec.concept}</p>
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div>
                              <strong>Caption angle:</strong> {rec.caption_angle}
                            </div>
                            <div>
                              <strong>CTA:</strong> {rec.cta}
                            </div>
                          </div>
                          {rec.visual_direction && (
                            <p className="text-xs text-muted-foreground">
                              <strong>Visual:</strong> {rec.visual_direction}
                            </p>
                          )}
                          {rec.why_this && (
                            <p className="text-xs text-muted-foreground bg-muted p-2 rounded">{rec.why_this}</p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                </TabsContent>
              ))}
            </Tabs>
          </section>
        )}

        {/* Content Calendar */}
        {contentCalendar.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5" /> Weekly Content Calendar
            </h3>
            <div className="space-y-6">
              {contentCalendar.map((day: any, dayIdx: number) => (
                <Card key={dayIdx}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="bg-primary text-primary-foreground rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold">
                        {dayIdx + 1}
                      </span>
                      {day.day}
                      {day.date_label && (
                        <span className="text-xs text-muted-foreground font-normal">({day.date_label})</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(day.posts || []).map((post: any, postIdx: number) => (
                      <CalendarPostCard key={postIdx} post={post} />
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Data Sources */}
        {rd?.data_counts && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Sources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>{rd.data_counts.sprout_top_posts ?? 0} Sprout posts</span>
                <span>{rd.data_counts.tiktok_trends ?? 0} TikTok trends</span>
                <span>{rd.data_counts.instagram_trends ?? 0} Instagram trends</span>
                <span>{rd.data_counts.total_recommendations ?? 0} recommendations</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

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
    <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{post.platform}</Badge>
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

      {/* Full post copy */}
      <div className="bg-background rounded-md p-3 border">
        <p className="text-sm whitespace-pre-line">{post.copy}</p>
        {post.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t">
            {post.hashtags.map((h: string) => (
              <span key={h} className="text-xs text-accent">
                #{h}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Visual direction */}
      {post.visual_direction && (
        <p className="text-xs text-muted-foreground">
          <strong>Visual direction:</strong> {post.visual_direction}
        </p>
      )}

      {/* Rationale */}
      {post.rationale && <p className="text-xs text-muted-foreground bg-muted p-2 rounded">{post.rationale}</p>}
    </div>
  );
}

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
            <CardContent className="pt-4 pb-3 px-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <p className="text-lg font-bold">{(d.current ?? 0).toLocaleString()}</p>
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
        <Bar dataKey="Current" fill="hsl(189, 93%, 37%)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Previous" fill="hsl(214, 20%, 90%)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PostCard({ post }: { post: any }) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{post.network_type || post.platform}</Badge>
          <span className="text-xs text-muted-foreground">
            {post.posted_at && new Date(post.posted_at).toLocaleDateString()}
          </span>
        </div>
        <p className="text-sm line-clamp-3">{post.text || post.content}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
            className="text-xs text-accent hover:underline flex items-center gap-1"
          >
            View Original <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

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

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      {analysis && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            {analysis.overview && <p className="text-sm">{analysis.overview}</p>}
            {analysis.top_themes?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Top Themes</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.top_themes.map((t: string) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {analysis.top_hashtags?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Trending Hashtags</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.top_hashtags.map((h: string) => (
                    <Badge key={h} variant="outline">
                      #{h}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {analysis.successful_formats?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Successful Formats</p>
                <ul className="list-disc list-inside text-sm text-muted-foreground">
                  {analysis.successful_formats.map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.opportunities_for_client?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Opportunities for Your Brand</p>
                <ol className="list-decimal list-inside text-sm space-y-1">
                  {analysis.opportunities_for_client.map((o: string, i: number) => (
                    <li key={i}>{o}</li>
                  ))}
                </ol>
              </div>
            )}
            {analysis.key_takeaways?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Key Takeaways</p>
                <ol className="list-decimal list-inside text-sm space-y-1">
                  {analysis.key_takeaways.map((t: string, i: number) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {validPosts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {validPosts.slice(0, 4).map((post: any, i: number) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">@{post.author}</span>
                  <Badge variant="outline">Score: {(post.engagement_score ?? 0).toLocaleString()}</Badge>
                </div>
                <p className="text-sm line-clamp-3">{post.caption}</p>
                {post.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {post.hashtags.slice(0, 5).map((h: string) => (
                      <Badge key={h} variant="outline" className="text-xs">
                        #{h}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {post.views != null && <span>{post.views.toLocaleString()} views</span>}
                  <span>{(post.likes ?? 0).toLocaleString()} likes</span>
                  <span>{(post.comments ?? 0).toLocaleString()} comments</span>
                </div>
                {post.url && (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-accent hover:underline flex items-center gap-1"
                  >
                    Watch <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
