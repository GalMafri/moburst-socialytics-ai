// Milestone 4: the competitor feed. What every company in the landscape posted
// in the last week (from the newest `feed` snapshot), the topics two or more of
// them converged on, and a one-click way to draft the client's own take, which
// lands in the content planner as an ad-hoc post.

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { PostVisual, usePostPreviews, normalizePlatform, platformLabel } from "@/components/competitive/PostVisual";
import { describeInvokeError } from "@/lib/invokeError";
import { ArrowLeft, RefreshCw, Rss, Sparkles, TrendingUp, X, Loader2, ExternalLink } from "lucide-react";

type FeedPost = {
  companyId?: string | number; companyName?: string; channel?: string; type?: string; message?: string; publishedAt?: string;
  engagementTotal?: number; engagementRate?: number; estimatedImpressions?: number; views?: number; postLink?: string | null; image?: string | null;
};

const fmt = (n: number | null | undefined) => (n == null ? "–" : Math.round(Number(n)).toLocaleString());

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`px-3 py-1.5 rounded-[9px] text-[14px] font-medium transition-colors ${active ? "bg-[rgba(255,255,255,0.12)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

export default function CompetitiveFeed() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canRunAnalysis } = useAuth();
  const [company, setCompany] = useState("all");
  const [plat, setPlat] = useState("all");

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ["competitor-feed", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rivaliq_snapshots")
        .select("id, fetched_at, landscape_id, payload")
        .eq("client_id", id!)
        .eq("endpoint", "feed")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: alerts } = useQuery({
    queryKey: ["competitive-alerts", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_alerts")
        .select("*")
        .eq("client_id", id!)
        .neq("status", "dismissed")
        .order("window_start", { ascending: false })
        .order("confidence", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("refresh-competitor-feed", { body: { client_id: id } });
      if (error) throw new Error(await describeInvokeError(error));
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["competitor-feed", id] });
      qc.invalidateQueries({ queryKey: ["competitive-alerts", id] });
      toast({ title: "Feed refreshed", description: `${d.posts} posts from the last week, ${d.alerts} shared topic${d.alerts === 1 ? "" : "s"} detected.` });
    },
    onError: (e: any) => toast({ title: "Could not refresh the feed", description: e.message, variant: "destructive" }),
  });

  const draft = useMutation({
    mutationFn: async ({ topic, platform, alertId }: { topic: string; platform: string; alertId?: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-ad-hoc-post", { body: { client_id: id, platform, topic } });
      if (error) throw new Error(await describeInvokeError(error));
      const post = (data as any)?.post;
      if (!post) throw new Error("The generator returned no post.");
      const hashtags = Array.isArray(post.hashtags) ? post.hashtags : typeof post.hashtags === "string" ? post.hashtags.split(/[\s,]+/).filter(Boolean) : null;
      const { error: insErr } = await supabase.from("post_iterations").insert({
        client_id: id!,
        version: 1,
        platform: post.platform || platform,
        post_copy: post.caption_angle,
        hashtags,
        cta: post.CTA,
        concept: post.concept,
        visual_direction: post.visual_direction,
        format: post.format,
        source: "ad_hoc",
      });
      if (insErr) throw insErr;
      if (alertId) await supabase.from("competitive_alerts").update({ status: "drafted" }).eq("id", alertId);
      return post;
    },
    onSuccess: (post: any) => {
      qc.invalidateQueries({ queryKey: ["competitive-alerts", id] });
      toast({ title: "Draft saved to Content Ideas", description: post.hook || post.concept?.slice(0, 120) });
    },
    onError: (e: any) => toast({ title: "Could not draft the post", description: e.message, variant: "destructive" }),
  });

  const dismiss = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.from("competitive_alerts").update({ status: "dismissed" }).eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["competitive-alerts", id] }),
  });

  const payload: any = snapshot?.payload || {};
  const posts: FeedPost[] = useMemo(() => {
    const list: FeedPost[] = Array.isArray(payload.socialPosts) ? payload.socialPosts : [];
    return [...list].sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
  }, [payload.socialPosts]);
  const companies = useMemo(() => Array.from(new Set(posts.map((p) => p.companyName || String(p.companyId || "")).filter(Boolean))), [posts]);
  const platforms = useMemo(() => Array.from(new Set(posts.map((p) => normalizePlatform(p.channel)).filter(Boolean))), [posts]);
  const visible = posts.filter((p) => (company === "all" || (p.companyName || String(p.companyId)) === company) && (plat === "all" || normalizePlatform(p.channel) === plat)).slice(0, 60);
  const { previews } = usePostPreviews(visible.map((p) => ({ url: p.postLink, image: p.image || null, mediaType: p.type })));
  const byUrl = useMemo(() => new Map(posts.filter((p) => p.postLink).map((p) => [p.postLink as string, p])), [posts]);

  const clientName = client?.name || "Client";
  const topicFor = (p: FeedPost) => `Our own take on this competitor post by ${p.companyName || "a competitor"} (${platformLabel(p.channel)}): "${String(p.message || "").slice(0, 240)}". Do not copy it; use the angle that works and make it ours.`;

  return (
    <AppLayout title={`Competitor feed: ${clientName}`}>
      <div className="w-full space-y-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/clients/${id}/competitive/reports`)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Competitive reports
            </Button>
            <h2 className="text-[30px] leading-[36px] font-bold tracking-[-0.5px]">What the field posted this week</h2>
            <p className="text-[15px] text-[#9ca3af]">
              {snapshot ? <>Pulled {new Date(snapshot.fetched_at).toLocaleString()}{payload.window ? ` · ${payload.window.start} to ${payload.window.end}` : ""}{payload.truncated ? " · capped at 100 posts" : ""}</> : "No pull yet for this client."}
            </p>
          </div>
          {canRunAnalysis && (
            <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              {refresh.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />} Refresh now
            </Button>
          )}
        </div>

        {isLoading ? (
          <Loading label="Loading the feed" />
        ) : !snapshot ? (
          <EmptyState
            icon={Rss}
            title="No competitor feed yet"
            description="Pull the last week of posts for this client's RivalIQ landscape. The weekly scheduler keeps it fresh afterwards."
            action={canRunAnalysis ? <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>Pull the last 7 days</Button> : undefined}
          />
        ) : (
          <>
            {/* Trends */}
            {(alerts || []).length > 0 && (
              <Card className="glass-elevated">
                <CardHeader>
                  <CardTitle className="text-[20px] leading-7 tracking-[-0.5px] flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Trends this week</CardTitle>
                  <CardDescription>Topics two or more companies posted about inside the window. Confidence rises with more companies, more posts and tighter timing.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  {(alerts || []).map((a: any) => {
                    const examples: FeedPost[] = (a.post_urls || []).map((u: string) => byUrl.get(u)).filter(Boolean).slice(0, 3);
                    const conf = Math.round(Number(a.confidence) * 100);
                    return (
                      <div key={a.id} className="rounded-[12px] p-4 bg-[rgba(255,255,255,0.04)] space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <p className="font-semibold leading-snug">{a.topic}</p>
                            <div className="flex gap-1.5 flex-wrap">
                              <Badge variant={conf >= 75 ? "default" : "secondary"}>{conf}% confidence</Badge>
                              {(a.companies || []).map((c: string) => <Badge key={c} variant="outline">{c}</Badge>)}
                              {(a.platforms || []).map((p: string) => <Badge key={p} variant="outline">{platformLabel(p)}</Badge>)}
                              {a.status === "drafted" && <Badge>drafted</Badge>}
                            </div>
                          </div>
                          {canRunAnalysis && (
                            <Button size="sm" variant="ghost" className="shrink-0" onClick={() => dismiss.mutate(a.id)} aria-label="Dismiss"><X className="h-4 w-4" /></Button>
                          )}
                        </div>
                        {a.summary && <p className="text-[15px] leading-6 text-[#9ca3af]">{a.summary}</p>}
                        {examples.length > 0 && (
                          <div className="grid grid-cols-3 gap-2 items-start">
                            {examples.map((p, i) => <PostVisual key={i} url={p.postLink} image={p.image} preview={p.postLink ? previews[p.postLink] : null} mediaType={p.type} platform={p.channel} compact />)}
                          </div>
                        )}
                        {canRunAnalysis && (
                          <Button size="sm" disabled={draft.isPending} onClick={() => draft.mutate({ topic: `${a.topic}. ${a.summary || ""} Competitors ${(a.companies || []).join(", ")} are posting about this now; give ${clientName} its own angle.`, platform: (a.platforms || [])[0] ? platformLabel((a.platforms || [])[0]) : "Instagram", alertId: a.id })}>
                            {draft.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} Draft our take
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[12px] font-medium uppercase tracking-wider text-[#9ca3af]">Company</span>
              <div className="flex items-center gap-0.5 p-1 rounded-[12px] bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.07)] flex-wrap">
                <Seg active={company === "all"} onClick={() => setCompany("all")}>All</Seg>
                {companies.map((c) => <Seg key={c} active={company === c} onClick={() => setCompany(c)}>{c}</Seg>)}
              </div>
              <span className="text-[12px] font-medium uppercase tracking-wider text-[#9ca3af] ml-2">Platform</span>
              <div className="flex items-center gap-0.5 p-1 rounded-[12px] bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.07)] flex-wrap">
                <Seg active={plat === "all"} onClick={() => setPlat("all")}>All</Seg>
                {platforms.map((p) => <Seg key={p} active={plat === p} onClick={() => setPlat(p)}>{platformLabel(p)}</Seg>)}
              </div>
            </div>

            {/* Posts */}
            {visible.length === 0 ? (
              <p className="text-[15px] text-[#9ca3af]">No posts match these filters.</p>
            ) : (
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4 items-start">
                {visible.map((p, i) => (
                  <div key={`${p.postLink || i}`} className="rounded-[12px] p-3 bg-[rgba(255,255,255,0.04)] space-y-2.5">
                    <PostVisual url={p.postLink} image={p.image} preview={p.postLink ? previews[p.postLink] : null} mediaType={p.type} platform={p.channel} />
                    <div className="flex items-center justify-between gap-2 text-[13px] text-[#9ca3af]">
                      <span className="font-medium text-foreground truncate">{p.companyName}</span>
                      <span>{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : ""}</span>
                    </div>
                    <p className="text-[15px] leading-6 line-clamp-3 min-h-[4.5rem]">{p.message || "(no caption)"}</p>
                    <div className="flex gap-2 flex-wrap text-[13px] text-[#9ca3af]">
                      <span>{fmt(p.engagementTotal)} eng.</span>
                      {p.estimatedImpressions ? <span>· {fmt(p.estimatedImpressions)} est. impr.</span> : null}
                      {p.views ? <span>· {fmt(p.views)} views</span> : null}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {p.postLink ? (
                        <a href={p.postLink} target="_blank" rel="noreferrer" className="text-[13px] text-primary hover:underline inline-flex items-center gap-1">Open <ExternalLink className="h-3 w-3" /></a>
                      ) : <span />}
                      {canRunAnalysis && (
                        <Button size="sm" variant="outline" className="h-7 text-[13px]" disabled={draft.isPending} onClick={() => draft.mutate({ topic: topicFor(p), platform: platformLabel(p.channel) })}>
                          <Sparkles className="h-3 w-3 mr-1" /> Draft our take
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
