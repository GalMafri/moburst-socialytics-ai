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
  Globe,
  Languages,
  Pencil,
  RefreshCw,
  Loader2,
  Download,
} from "lucide-react";
import { PlatformBadge, PlatformIcon, getPlatformColor } from "@/lib/platform-config";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { ReportActions } from "@/components/reports/ReportActions";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import { CreatePostDesignButton } from "@/components/reports/CreatePostDesignButton";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
import { CreateAdHocPost } from "@/components/reports/CreateAdHocPost";
import { Send, Pencil as PencilEdit } from "lucide-react";
import { DesignEditor } from "@/components/editor/DesignEditor";
import { VideoTrimmer, type VideoEditData, type TextOverlay } from "@/components/editor/VideoTrimmer";

export default function ReportView() {
  const { id, reportId } = useParams();
  const reportContentRef = useRef<HTMLDivElement>(null);
  useRealtimeReports(id);

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*, clients(name, brand_identity)")
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
  const brandIdentity = (report as any).clients?.brand_identity || null;

  const sproutPerformance = rd?.sprout_performance || {};
  const monthComparison = sproutPerformance?.month_comparison || {};
  const aiAnalysis = rd?.ai_analysis || {};
  const tiktokTrends = rd?.tiktok_trends || {};
  const instagramTrends = rd?.instagram_trends || {};
  const contentCalendar = rd?.content_calendar || aiAnalysis?.content_calendar || [];

  // Extract unique platforms from content recommendations and calendar
  const availablePlatforms = [
    ...new Set([
      ...(aiAnalysis?.content_recommendations || []).map((r: any) => r.platform).filter(Boolean),
      ...(contentCalendar || []).flatMap((day: any) =>
        (day.posts || []).map((p: any) => p.platform).filter(Boolean)
      ),
    ]),
  ] as string[];

  // Build available tabs
  const tabs: { value: string; label: string; icon: React.ReactNode }[] = [
    { value: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  ];
  if (aiAnalysis?.content_recommendations?.length > 0 || contentCalendar.length > 0) {
    tabs.push({ value: "content", label: "Content Ideas", icon: <Sparkles className="h-4 w-4" /> });
  }
  if (
    aiAnalysis?.tiktok_trends_analysis ||
    tiktokTrends?.posts?.length ||
    aiAnalysis?.instagram_trends_analysis ||
    instagramTrends?.posts?.length
  ) {
    tabs.push({ value: "trends", label: "Trends", icon: <TrendingUp className="h-4 w-4" /> });
  }

  const gammaUrl = report.gamma_url || rd?.gamma_url;

  return (
    <AppLayout title={`Report: ${clientName}`}>
      <div className="max-w-6xl mx-auto space-y-6" ref={reportContentRef}>
        {/* Presentation Deck Banner */}
        <Card className={gammaUrl ? "border-primary/30 bg-primary/5" : "border-dashed"}>
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center ${gammaUrl ? "bg-primary/10" : "bg-muted"}`}
              >
                <ExternalLink className={`h-5 w-5 ${gammaUrl ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-sm font-medium">{gammaUrl ? "Interactive Presentation" : "Presentation Deck"}</p>
                <p className="text-xs text-muted-foreground">
                  {gammaUrl
                    ? "View the full interactive presentation"
                    : "This feature will be added soon — stay tuned!"}
                </p>
              </div>
            </div>
            {gammaUrl ? (
              <Button onClick={() => window.open(gammaUrl, "_blank")}>
                <ExternalLink className="h-4 w-4 mr-2" /> Open Presentation
              </Button>
            ) : (
              <Badge variant="outline">Pending</Badge>
            )}
          </CardContent>
        </Card>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">{clientName} Report</h2>
            <p className="text-sm text-muted-foreground">
              {rd?.report_period?.current_month?.start} — {rd?.report_period?.current_month?.end}
              {" · "}Generated {new Date(report.created_at).toLocaleDateString()}
            </p>
            {(rd?.context?.languages?.length > 0 || rd?.context?.geo?.length > 0) && (
              <div className="flex items-center gap-2 mt-1">
                {rd?.context?.geo?.length > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {(Array.isArray(rd.context.geo) ? rd.context.geo : [rd.context.geo]).join(", ")}
                  </span>
                )}
                {rd?.context?.languages?.length > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Languages className="h-3 w-3" />
                    {(Array.isArray(rd.context.languages) ? rd.context.languages : [rd.context.languages]).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ExportPdfButton
              contentRef={reportContentRef}
              filename={`${clientName}-report-${new Date(report.created_at).toISOString().slice(0, 10)}`}
            />
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
            {monthComparison?.changes && (
              <MetricsCards changes={monthComparison.changes} previousMonth={monthComparison.previous_month} />
            )}

            {/* Chart */}
            {monthComparison?.current_month && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Period-over-Period Performance
                  </CardTitle>
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
                      {formatNumbersInText(aiAnalysis.sprout_performance_analysis.month_over_month_summary)}
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
                        <span>{formatNumbersInText(insight)}</span>
                      </li>
                    ))}
                  </ul>
                  {aiAnalysis.sprout_performance_analysis.top_performing_content?.length > 0 && (
                    <div className="mt-5 pt-4 border-t">
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
            )}

            {/* Top Posts by Impressions & Engagement */}
            {sproutPerformance?.top_posts?.length > 0 &&
              (() => {
                const posts = [...sproutPerformance.top_posts];
                const byImpressions = [...posts]
                  .sort((a: any, b: any) => (b.impressions ?? 0) - (a.impressions ?? 0))
                  .slice(0, 4);
                const byEngagement = [...posts]
                  .sort(
                    (a: any, b: any) =>
                      (b.reactions ?? b.likes ?? 0) +
                      (b.comments ?? 0) +
                      (b.shares ?? 0) -
                      ((a.reactions ?? a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0)),
                  )
                  .slice(0, 4);
                return (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Eye className="h-4 w-4 text-muted-foreground" /> Top Posts by Impressions
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {byImpressions.map((post: any, i: number) => (
                          <PostCard key={`imp-${i}`} post={post} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Heart className="h-4 w-4 text-muted-foreground" /> Top Posts by Engagement
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {byEngagement.map((post: any, i: number) => (
                          <PostCard key={`eng-${i}`} post={post} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                            <Badge key={p} variant="secondary">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">⚠️ Needs Attention</p>
                        <div className="flex flex-wrap gap-1.5">
                          {aiAnalysis.sprout_performance_analysis.pillar_alignment.underrepresented.map((p: string) => (
                            <Badge key={p} variant="outline">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations?.length > 0 && (
                    <div className="pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Recommendations</p>
                      <ul className="space-y-1.5">
                        {aiAnalysis.sprout_performance_analysis.pillar_alignment.recommendations.map(
                          (r: string, i: number) => (
                            <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                              • {r}
                            </li>
                          ),
                        )}
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
            {/* Ad Hoc Post Creation */}
            {availablePlatforms.length > 0 && (
              <div className="flex justify-end">
                <CreateAdHocPost
                  clientId={id!}
                  platforms={availablePlatforms}
                  brandIdentity={brandIdentity}
                />
              </div>
            )}

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
                          <CalendarPostCard
                            key={postIdx}
                            post={post}
                            brandIdentity={brandIdentity}
                            clientId={id}
                            reportId={reportId}
                            clientTimezone={(report?.report_data as any)?.context?.timezone || "UTC"}
                          />
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
  const filtered =
    platformFilter === "all" ? recommendations : recommendations.filter((r: any) => r.platform === platformFilter);

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
            <span key={p} className="cursor-pointer" onClick={() => setPlatformFilter(p)}>
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
                    <span className="font-medium text-foreground">Caption angle: </span>
                    {rec.caption_angle}
                  </div>
                )}
                {rec.cta && (
                  <div>
                    <span className="font-medium text-foreground">CTA: </span>
                    {rec.cta}
                  </div>
                )}
              </div>
              {rec.visual_direction && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Visual: </span>
                  {rec.visual_direction}
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
function CalendarPostCard({
  post,
  brandIdentity,
  clientId,
  reportId,
  clientTimezone,
}: {
  post: any;
  brandIdentity?: any;
  clientId?: string;
  reportId?: string;
  clientTimezone?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [generatedMediaUrls, setGeneratedMediaUrls] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingMediaIndex, setEditingMediaIndex] = useState<number | null>(null);
  const [editingMediaType, setEditingMediaType] = useState<"image" | "video" | null>(null);
  // Store video edit data per media index (overlays, trim)
  const [videoEdits, setVideoEdits] = useState<Record<number, VideoEditData>>({});

  // Load previously generated media + video edits from post_iterations on mount
  useEffect(() => {
    if (!clientId) return;
    let query = supabase
      .from("post_iterations")
      .select("media_urls, video_edits")
      .eq("client_id", clientId)
      .not("media_urls", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (post.platform) query = query.eq("platform", post.platform);
    const postCopy = post.copy || post.caption_angle || "";
    if (postCopy) query = query.eq("post_copy", postCopy);

    query.then(({ data }) => {
      if (data?.[0]?.media_urls?.length) {
        setGeneratedMediaUrls(data[0].media_urls);
      }
      // Restore saved video edits
      if (data?.[0]?.video_edits && typeof data[0].video_edits === "object") {
        setVideoEdits(data[0].video_edits as Record<number, VideoEditData>);
      }
    }, () => {});
  }, [clientId, post.platform]);
  const initialCopy = post.copy || post.caption_angle || post.concept || "";
  const [editedCopy, setEditedCopy] = useState(initialCopy);
  const [displayCopy, setDisplayCopy] = useState(initialCopy);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleCopy = () => {
    const fullText =
      displayCopy + (post.hashtags?.length ? "\n\n" + post.hashtags.map((h: string) => h.startsWith('#') ? h : `#${h}`).join(" ") : "");
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = async () => {
    if (!clientId || !editedCopy.trim()) return;
    setIsSavingEdit(true);
    try {
      // Save original version (version 1)
      await supabase.from("post_iterations").insert({
        client_id: clientId,
        report_id: reportId || null,
        version: 1,
        platform: post.platform || null,
        post_copy: displayCopy,
        hashtags: post.hashtags || null,
        cta: post.CTA || post.cta || null,
        concept: post.concept || null,
        visual_direction: post.visual_direction || null,
        format: post.format || null,
        source: "calendar",
      });

      // Save edited version (version 2)
      await supabase.from("post_iterations").insert({
        client_id: clientId,
        report_id: reportId || null,
        version: 2,
        platform: post.platform || null,
        post_copy: editedCopy,
        hashtags: post.hashtags || null,
        cta: post.CTA || post.cta || null,
        concept: post.concept || null,
        visual_direction: post.visual_direction || null,
        format: post.format || null,
        source: "calendar",
      });

      // Call analyze-post-edits edge function
      supabase.functions.invoke("analyze-post-edits", {
        body: {
          client_id: clientId,
          original_copy: displayCopy,
          edited_copy: editedCopy,
        },
      });

      // Update local display
      setDisplayCopy(editedCopy);
      setIsEditing(false);
      toast.success("Post updated and preferences saved");
    } catch (err: any) {
      toast.error("Failed to save edit: " + (err.message || "Unknown error"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleRegenerate = async () => {
    if (!clientId) return;
    setIsRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("regenerate-post-copy", {
        body: {
          client_id: clientId,
          platform: post.platform || null,
          concept: post.concept || post.copy || post.caption_angle || post.rationale || displayCopy || "social media post",
          pillar: post.pillar || null,
          current_copy: displayCopy,
          current_cta: post.CTA || post.cta || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const postResult = data?.post || data;
      const newCopy = postResult?.caption_angle || postResult?.copy || postResult?.post_copy;
      if (newCopy) {
        // Save regenerated version to post_iterations
        await supabase.from("post_iterations").insert({
          client_id: clientId,
          report_id: reportId || null,
          version: 1,
          platform: post.platform || null,
          post_copy: newCopy,
          hashtags: postResult?.hashtags || post.hashtags || null,
          cta: postResult?.CTA || postResult?.cta || post.CTA || post.cta || null,
          concept: post.concept || null,
          visual_direction: post.visual_direction || null,
          format: post.format || null,
          source: "regeneration",
        });

        setDisplayCopy(newCopy);
        setEditedCopy(newCopy);
        toast.success("Copy regenerated");
      }
    } catch (err: any) {
      toast.error("Failed to regenerate: " + (err.message || "Unknown error"));
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={post.platform} size="sm" />
          <Badge variant="outline">{post.format}</Badge>
          {post.language && (
            <Badge variant="secondary" className="text-xs uppercase">
              {post.language}
            </Badge>
          )}
          {post.pillar && <Badge className="bg-accent text-accent-foreground text-xs">{post.pillar}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {post.posting_time && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {post.posting_time}
            </span>
          )}
          <CreatePostDesignButton
            post={post}
            brandIdentity={brandIdentity}
            clientId={clientId}
            onImagesGenerated={(urls) => setGeneratedMediaUrls(urls)}
          />
          <CreatePostVideoButton
            post={post}
            brandIdentity={brandIdentity}
            clientId={clientId}
            onVideoGenerated={(url) => setGeneratedMediaUrls([url])}
          />
          {clientId && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setEditedCopy(displayCopy);
                  setIsEditing(true);
                }}
                disabled={isEditing || isRegenerating}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={handleRegenerate}
                disabled={isRegenerating || isEditing}
              >
                {isRegenerating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                {isRegenerating ? "Regenerating..." : "Regenerate"}
              </Button>
            </>
          )}
          {clientId && reportId && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setScheduleOpen(true);
                }}
              >
                <Send className="h-3 w-3 mr-1" /> Schedule
              </Button>
              <SchedulePostModal
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                post={post}
                clientId={clientId}
                reportId={reportId}
                generatedMediaUrls={generatedMediaUrls}
                clientTimezone={clientTimezone}
              />
            </>
          )}
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 px-2">
            <Copy className="h-3.5 w-3.5 mr-1" />
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={editedCopy}
            onChange={(e) => setEditedCopy(e.target.value)}
            rows={5}
            className="text-sm"
            placeholder="Edit post copy..."
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={isSavingEdit || !editedCopy.trim()}
            >
              {isSavingEdit ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : null}
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditedCopy(displayCopy);
                setIsEditing(false);
              }}
              disabled={isSavingEdit}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-background rounded-md p-3 border">
          <p className="text-sm leading-relaxed whitespace-pre-line">{displayCopy}</p>
          {post.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t">
              {post.hashtags.map((h: string) => (
                <span key={h} className="text-xs text-primary">
                  {h.startsWith('#') ? h : `#${h}`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {post.visual_direction && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Visual: </span>
          {post.visual_direction}
        </p>
      )}
      {post.rationale && (
        <div className="bg-muted/50 p-3 rounded-md text-sm leading-relaxed text-muted-foreground">
          💡 {post.rationale}
        </div>
      )}

      {/* Show previously generated media — compact thumbnails with edit */}
      {generatedMediaUrls.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Generated Media</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {generatedMediaUrls.map((url, i) => {
              const isVideo = url.includes(".mp4") || url.includes(".webm") || url.includes("video") || url.includes("generativelanguage");
              return (
                <div key={i} className="relative group">
                  {isVideo ? (
                    <>
                      <video
                        src={url}
                        className="w-full h-32 object-cover rounded-md border bg-black"
                        muted
                        preload="metadata"
                      />
                      {/* Render saved text overlays on video thumbnail */}
                      {videoEdits[i]?.overlays?.map((ov) => (
                        <div
                          key={ov.id}
                          className="pointer-events-none"
                          style={{
                            position: "absolute",
                            left: `${ov.x}%`,
                            top: `${ov.y}%`,
                            transform: "translate(-50%, -50%)",
                            fontSize: `${Math.max(ov.fontSize * 0.4, 10)}px`,
                            fontWeight: ov.fontWeight,
                            color: ov.color,
                            textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ov.text}
                        </div>
                      ))}
                      {videoEdits[i]?.trimStart > 0 && (
                        <span className="absolute top-1 left-1 bg-primary/80 text-primary-foreground text-[9px] px-1 rounded">
                          Trimmed
                        </span>
                      )}
                    </>
                  ) : (
                    <img
                      src={url}
                      alt={`Design ${i + 1}`}
                      className="w-full h-32 object-cover rounded-md border"
                    />
                  )}
                  {/* Action buttons overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-md flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setEditingMediaIndex(i);
                        setEditingMediaType(isVideo ? "video" : "image");
                      }}
                    >
                      <PencilEdit className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <a
                      href={url}
                      download={`${post.platform || "design"}-${i + 1}.${isVideo ? "mp4" : "png"}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button variant="secondary" size="sm" className="h-7 px-2 text-xs">
                        <Download className="h-3 w-3" />
                      </Button>
                    </a>
                  </div>
                  {/* Type label */}
                  <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                    {isVideo ? "Video" : `Slide ${i + 1}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Image editor dialog */}
      {editingMediaType === "image" && editingMediaIndex !== null && generatedMediaUrls[editingMediaIndex] && (
        <DesignEditor
          imageUrl={generatedMediaUrls[editingMediaIndex]}
          brandIdentity={brandIdentity}
          clientId={clientId || ""}
          onSave={(dataUrl) => {
            setGeneratedMediaUrls((prev) => {
              const updated = [...prev];
              updated[editingMediaIndex!] = dataUrl;
              return updated;
            });
            setEditingMediaIndex(null);
            setEditingMediaType(null);
            toast.success("Design updated!");
          }}
          onClose={() => { setEditingMediaIndex(null); setEditingMediaType(null); }}
        />
      )}

      {/* Video editor dialog */}
      {editingMediaType === "video" && editingMediaIndex !== null && generatedMediaUrls[editingMediaIndex] && (
        <VideoTrimmer
          videoUrl={generatedMediaUrls[editingMediaIndex]}
          clientId={clientId}
          initialEdits={videoEdits[editingMediaIndex]}
          onSave={(url, edits) => {
            // Store in local state
            const updatedEdits = { ...videoEdits, [editingMediaIndex!]: edits };
            setVideoEdits(updatedEdits);
            setEditingMediaIndex(null);
            setEditingMediaType(null);

            // Persist to database
            if (clientId) {
              const postCopy = post.copy || post.caption_angle || "";
              supabase
                .from("post_iterations")
                .update({ video_edits: updatedEdits } as any)
                .eq("client_id", clientId)
                .eq("platform", post.platform || "")
                .not("media_urls", "is", null)
                .then(() => {}, (err: any) => console.error("Failed to save video edits:", err));
            }
          }}
          onClose={() => { setEditingMediaIndex(null); setEditingMediaType(null); }}
        />
      )}
    </div>
  );
}

/* ─── Metrics Cards ─── */
function MetricsCards({
  changes,
  previousMonth,
}: {
  changes: Record<string, any>;
  previousMonth?: Record<string, any>;
}) {
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
        const prevValue = previousMonth?.[key];
        return (
          <Card key={key}>
            <CardContent className="pt-4 pb-3 px-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <p className="text-xl font-bold tracking-tight">{(d.current ?? 0).toLocaleString()}</p>
              {prevValue != null && <p className="text-xs text-muted-foreground">prev: {prevValue.toLocaleString()}</p>}
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

/* ─── Performance Chart (per-metric mini bars) ─── */
function PerformanceChart({ comparison }: { comparison: any }) {
  const metrics = Object.keys(comparison.current_month || {}).map((key) => {
    const current = comparison.current_month[key] ?? 0;
    const previous = comparison.previous_month?.[key] ?? 0;
    const max = Math.max(current, previous, 1);
    return { key, label: key.replace(/_/g, " "), current, previous, max };
  });

  const fmtVal = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {metrics.map(({ key, label, current, previous, max }) => (
        <div key={key} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground capitalize">{label}</p>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-1))]"
                  style={{ width: `${Math.max((current / max) * 100, 2)}%` }}
                />
              </div>
              <span className="text-xs font-semibold w-14 text-right">{fmtVal(current)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3.5 rounded bg-muted overflow-hidden">
                <div
                  className="h-full rounded bg-[hsl(var(--chart-4))] opacity-60"
                  style={{ width: `${Math.max((previous / max) * 100, 2)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground w-14 text-right">{fmtVal(previous)}</span>
            </div>
          </div>
        </div>
      ))}
      <div className="col-span-full flex items-center gap-4 text-xs text-muted-foreground pt-1">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--chart-1))]" /> Current Period
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--chart-4))] opacity-60" /> Previous Period
        </span>
      </div>
    </div>
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
            className="text-xs text-primary hover:underline flex items-center gap-1 pt-1"
          >
            View Original <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Score + Formatting Helpers ─── */
function getScoreLabel(score: number, platform: string): { label: string; color: string } {
  if (platform === "tiktok") {
    if (score > 100000) return { label: "Viral", color: "text-success" };
    if (score > 50000) return { label: "High", color: "text-primary" };
    if (score > 10000) return { label: "Medium", color: "text-warning" };
    return { label: "Emerging", color: "text-muted-foreground" };
  }
  if (score > 10000) return { label: "Viral", color: "text-success" };
  if (score > 5000) return { label: "High", color: "text-primary" };
  if (score > 1000) return { label: "Medium", color: "text-warning" };
  return { label: "Emerging", color: "text-muted-foreground" };
}

function getScoreExplanation(platform: string): string {
  if (platform === "tiktok") {
    return "Score = likes + (comments \u00d7 2) + (shares \u00d7 3) + (views \u00f7 1,000)";
  }
  return "Score = likes + (comments \u00d7 2) + (views \u00f7 1,000)";
}

function formatNumbersInText(text: string): string {
  return text.replace(/(?<![,.\d])(\d{4,})(?![,.\d])/g, (match) => Number(match).toLocaleString());
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
          {analysis?.overview && <p className="text-sm text-muted-foreground line-clamp-1">{analysis.overview}</p>}
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
                    <Badge key={t} variant="secondary" className="px-3 py-1 text-sm">
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
                      {h.startsWith('#') ? h : `#${h}`}
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
                    {post.engagement_score != null &&
                      (() => {
                        const sl = getScoreLabel(post.engagement_score, platform);
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="text-xs cursor-help">
                                Score: {post.engagement_score.toLocaleString()}{" "}
                                <span className={`ml-1 ${sl.color}`}>{sl.label}</span>
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              <p className="font-medium mb-1">{getScoreExplanation(platform)}</p>
                              <p className="text-muted-foreground">
                                Scores are platform-relative. {platform === "tiktok" ? "TikTok" : "Instagram"}{" "}
                                thresholds differ due to typical engagement volumes.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                  </div>
                  <p className="text-sm leading-relaxed line-clamp-3">{post.caption}</p>
                  {post.hashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {post.hashtags.slice(0, 5).map((h: string) => (
                        <span key={h} className="text-xs text-primary font-mono">
                          {h.startsWith('#') ? h : `#${h}`}
                        </span>
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
