// Milestone 4: the competitor feed. What every company in the landscape posted
// in the last week (from the newest `feed` snapshot), the topics two or more of
// them converged on, and a one-click way to draft the client's own take, which
// lands in the content planner as an ad-hoc post.

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Segment, SegmentedGroup } from "@/components/ui/segmented";
import { Card, CardContent, CardHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { toast as sonnerToast } from "sonner";
import { mondayOf } from "@/lib/calendarPosts";
import { clipText } from "@/lib/clipText";
import { displayCompanyName } from "@/lib/companyName";
import { useToast } from "@/hooks/use-toast";
import { PostVisual, usePostPreviews, normalizePlatform, platformLabel } from "@/components/competitive/PostVisual";
import { describeInvokeError, withQuietRetry } from "@/lib/invokeError";
import { cleanText, formatDate, formatDateTime, formatRange } from "@/lib/display";
import { fetchOpenTopics } from "@/lib/openTopics";
import { ChangeCards } from "@/components/competitive/ChangeCards";
import { aggregatePosts, pickComparableFeed, diffCompanies, sameCompany } from "@/lib/competitiveChanges";
import { ArrowLeft, RefreshCw, Rss, Sparkles, TrendingUp, X, Loader2, ExternalLink, History } from "lucide-react";

type FeedPost = {
  companyId?: string | number; companyName?: string; channel?: string; type?: string; message?: string; publishedAt?: string;
  engagementTotal?: number; engagementRate?: number; estimatedImpressions?: number; views?: number; postLink?: string | null; image?: string | null;
  /** RivalIQ's paid-promotion signal on Facebook posts: "Likely Boosted", "Not Likely Boosted" or "No Prediction". */
  facebookLikelyBoosted?: string | boolean | null;
  authorship?: "company" | "collaboration";
};
const isBoosted = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() === "likely boosted" : v === true);

const fmt = (n: number | null | undefined) => (n == null ? "–" : Math.round(Number(n)).toLocaleString());


export default function CompetitiveFeed() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canRunAnalysis } = useAuth();
  const [company, setCompany] = useState("all");
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [plat, setPlat] = useState("all");
  // A refresh spends a RivalIQ request and an AI pass, so it is asked first.
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  // So does drafting a post: the draft waits here until it is confirmed.
  /** topic: what the writer is asked to respond to. reason: the plain label the calendar shows for the post. */
  const [pendingDraft, setPendingDraft] = useState<{ topic: string; reason: string; platform: string; alertId?: string; about: string } | null>(null);

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Repeated pulls of this week must not displace the last comparable week.
  const { data: snaps, isLoading, isError: feedFailed, error: feedError, refetch: refetchFeed } = useQuery({
    queryKey: ["competitor-feed", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rivaliq_snapshots")
        .select("id, fetched_at, landscape_id, payload")
        .eq("client_id", id!)
        .eq("endpoint", "feed")
        .order("fetched_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });
  const snapshot = snaps?.[0];
  const prevSnapshot = snapshot ? pickComparableFeed(snapshot, snaps?.slice(1) || []) : null;
  /** The window this page is showing, so its topics can be scoped to it. */
  const windowStart: string | null = (snapshot as any)?.payload?.window?.start ?? null;

  // The one definition of open topics (the newest feed window's topics that
  // nobody dismissed), shared with the dashboard and the weekly planner.
  const { data: alerts } = useQuery({
    queryKey: ["competitive-alerts", id, windowStart],
    queryFn: () => fetchOpenTopics(id!),
    enabled: !!id,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await withQuietRetry(() => supabase.functions.invoke("refresh-competitor-feed", { body: { client_id: id } }));
      if (error || (data as any)?.error) throw new Error(await describeInvokeError(error, data));
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
    mutationFn: async ({ topic, reason, platform, alertId }: { topic: string; reason: string; platform: string; alertId?: string }) => {
      const { data, error } = await withQuietRetry(() => supabase.functions.invoke("generate-ad-hoc-post", { body: { client_id: id, platform, topic } }));
      if (error) throw new Error(await describeInvokeError(error, data));
      const post = (data as any)?.post;
      if (!post) throw new Error("The post was not written. Nothing was added to the calendar.");
      const hashtags = Array.isArray(post.hashtags) ? post.hashtags : typeof post.hashtags === "string" ? post.hashtags.split(/[\s,]+/).filter(Boolean) : null;
      // Drafts go to the client's Calendar (today, to be moved), with the topic as the reason.
      // calendar_posts is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error: insErr } = await (supabase.from("calendar_posts" as never) as any).insert({
        client_id: id!,
        post_date: new Date().toISOString().slice(0, 10),
        platform: post.platform || platform,
        format: post.format || null,
        pillar: post.pillar || null,
        copy: post.caption_angle || post.concept || "",
        hashtags: hashtags || [],
        cta: post.CTA || null,
        visual_direction: post.visual_direction || null,
        rationale: post.concept || null,
        reasons: [{ type: "competitor", label: clipText(reason, 200) }],
        source: "insight",
        raw: post,
      }).select("id, post_date").single();
      if (insErr) {
        console.error("[draft] calendar insert", insErr);
        throw new Error("The post was written but could not be added to the calendar. Try again.");
      }
      if (alertId) await supabase.from("competitive_alerts").update({ status: "drafted" }).eq("id", alertId);
      return row as { id: string; post_date: string };
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["competitive-alerts", id] });
      qc.invalidateQueries({ queryKey: ["calendar-posts", id] });
      const open = () => navigate(`/clients/${id}/calendar?week=${mondayOf(row.post_date)}&post=${row.id}`);
      sonnerToast.success(`Added to ${clientName}'s calendar for today`, { description: "Open it to read the post, move it to its date or change it.", action: { label: "Open the post", onClick: open }, duration: 12000 });
    },
    onError: (e: any) => toast({ title: "Could not draft the post", description: e.message, variant: "destructive" }),
  });

  const dismiss = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.from("competitive_alerts").update({ status: "dismissed" }).eq("id", alertId);
      if (error) {
        console.error("[dismiss topic]", error);
        throw new Error("The topic is still on the feed. Try again in a minute.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["competitive-alerts", id] }),
    onError: (e: any) =>
      toast({ title: "Could not dismiss the topic", description: e.message, variant: "destructive" }),
  });

  const payload: any = snapshot?.payload || {};
  const posts: FeedPost[] = useMemo(() => {
    const list: FeedPost[] = Array.isArray(payload.socialPosts) ? payload.socialPosts : [];
    return [...list].sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
  }, [payload.socialPosts]);
  const companies = useMemo(() => Array.from(new Set(posts.map((p) => p.companyName || String(p.companyId || "")).filter(Boolean))), [posts]);
  // Week-over-week movements, only when the previous pull covers an earlier week rather than the same one.
  const prevWindow: { start: string; end: string } | null = (prevSnapshot?.payload as any)?.window || null;
  const changes = useMemo(() => {
    const prev: any = prevSnapshot?.payload;
    if (!prev?.window || !payload.window) return null;
    const days = (w: { start: string; end: string }) => Math.max(1, Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86400000) + 1);
    return diffCompanies(aggregatePosts(prev.socialPosts || [], days(prev.window), client?.name), aggregatePosts(payload.socialPosts || [], days(payload.window), client?.name), 6);
  }, [prevSnapshot, payload, client?.name]);
  const platforms = useMemo(() => Array.from(new Set(posts.map((p) => normalizePlatform(p.channel)).filter(Boolean))), [posts]);
  // RivalIQ returns X posts with no link, caption or image. A tile for one is an
  // empty box with a "Draft our take" button that has nothing to work from, so
  // they are counted in a footnote instead, as they are on the report.
  const hasContent = (p: FeedPost) => !!(p.postLink || p.message || p.image);
  const FEED_LIMIT = 60;
  const allMatching = posts.filter((p) => (company === "all" || (p.companyName || String(p.companyId)) === company) && (plat === "all" || normalizePlatform(p.channel) === plat));
  // The grid stops at 60. It used to stop silently, so a filter holding 300
  // posts looked like a filter holding 60.
  const matching = allMatching.slice(0, FEED_LIMIT);
  const hiddenByLimit = allMatching.length - matching.length;
  const visible = matching.filter(hasContent);
  const contentless = matching.length - visible.length;
  const { previews } = usePostPreviews(visible.map((p) => ({ url: p.postLink, image: p.image || null, mediaType: p.type })));
  const byUrl = useMemo(() => new Map(posts.filter((p) => p.postLink).map((p) => [p.postLink as string, p])), [posts]);

  const clientName = client?.name || "Client";
  const topicFor = (p: FeedPost) => `Our own take on this competitor post by ${p.companyName || "a competitor"} (${platformLabel(p.channel)}): "${clipText(p.message, 240)}". Do not copy it; use the angle that works and make it ours.`;
  // The client's own posts are in the feed for comparison; a "take" on them makes no sense.
  const isOwnPost = (p: FeedPost) => (p as { source?: string }).source === "sprout" || (!!client?.name && sameCompany(String(p.companyName || ""), client.name.toLowerCase().trim()));
  const reasonFor = (p: FeedPost) => `Our take on a ${displayCompanyName(p.companyName || "competitor")} ${platformLabel(p.channel)} post`;

  return (
    <AppLayout
      title={`Competitor feed: ${clientName}`}
      description="What the competitor set posted in the last seven days, and the topics they converged on."
      back={
        <Button variant="ghost" size="sm" className="-ml-2 border-0 bg-transparent" onClick={() => navigate(`/clients/${id}/competitive/reports`)}>
          <ArrowLeft /> Competitive reports
        </Button>
      }
      meta={snapshot ? <span className="t-label">Pulled {formatDateTime(snapshot.fetched_at)}{payload.window ? ` · ${formatRange(payload.window)}` : ""}{payload.truncated ? ` · capped at ${posts.length} posts` : ""}</span> : undefined}
      actions={
        canRunAnalysis ? (
          <Button onClick={() => setConfirmRefresh(true)} disabled={refresh.isPending}>
            {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh now
          </Button>
        ) : undefined
      }
    >
        {isLoading ? (
          <Loading label="Loading the feed" />
        ) : feedFailed ? (
          <LoadError title="Could not load the feed" error={feedError} onRetry={() => refetchFeed()} />
        ) : !snapshot ? (
          <EmptyState
            icon={Rss}
            title="No competitor posts yet"
            description="The weekly refresh pulls the last seven days of posts from every tracked company on its own."
          />
        ) : (
          <>
            {/* Trends */}
            {(alerts || []).length > 0 && (
              <Card>
                <CardHeading
                  icon={<TrendingUp />}
                  title="Trends this week"
                  description="Topics two or more companies posted about inside the window. Confidence rises with more companies, more posts and tighter timing."
                />
                <CardContent className="grid gap-inner grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))]">
                  {(alerts || []).map((a: any) => {
                    const examples: FeedPost[] = (a.post_urls || []).map((u: string) => byUrl.get(u)).filter(Boolean).slice(0, 3);
                    const conf = Math.round(Number(a.confidence) * 100);
                    return (
                      <div key={a.id} className="glass-inner p-inner space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <p className="t-h4">{a.topic}</p>
                            <div className="flex gap-1.5 flex-wrap">
                              <Badge variant={conf >= 75 ? "default" : "secondary"}>{conf}% confidence</Badge>
                              {(a.companies || []).map((c: string) => <Badge key={c} variant="outline">{c}</Badge>)}
                              {(a.platforms || []).map((p: string) => <Badge key={p} variant="outline">{platformLabel(p)}</Badge>)}
                              {a.status === "drafted" && <Badge>Drafted</Badge>}
                            </div>
                          </div>
                          {canRunAnalysis && (
                            <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => setDismissing(a.id)} aria-label="Dismiss"><X /></Button>
                          )}
                        </div>
                        {a.summary && <p className="t-secondary">{a.summary}</p>}
                        {examples.length > 0 && (
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 items-start">
                            {examples.map((p, i) => <PostVisual key={i} url={p.postLink} image={p.image} preview={p.postLink ? previews[p.postLink] : null} mediaType={p.type} platform={p.channel} compact />)}
                          </div>
                        )}
                        {canRunAnalysis && (
                          <Button size="sm" disabled={draft.isPending} onClick={() => setPendingDraft({ topic: `${a.topic}. ${a.summary || ""} Competitors ${(a.companies || []).join(", ")} are posting about this now; give ${clientName} its own angle.`, reason: `Competitors are posting about ${a.topic}`, platform: (a.platforms || [])[0] ? platformLabel((a.platforms || [])[0]) : "Instagram", alertId: a.id, about: `the shared topic "${a.topic}"` })}>
                            {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft our take
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Since last week */}
            {changes && prevSnapshot && (
              <Card>
                <CardHeading
                  icon={<History />}
                  title="Since last week"
                  description={<>Against the pull of {formatDate(prevSnapshot.fetched_at)}{prevWindow ? ` covering ${formatRange(prevWindow)}` : ""}.</>}
                />
                <CardContent>
                  {changes.length > 0 ? <ChangeCards changes={changes} /> : <EmptyState compact framed={false} icon={History} title="No notable movement" description="Cadence, engagement, channels and formats all held." />}
                </CardContent>
              </Card>
            )}

            {/* Filters */}
            {/* The filters on their own glass band, as on the calendar and the reports. */}
            <div className="glass px-card py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
              <SegmentedGroup label="Company">
                <Segment active={company === "all"} onClick={() => setCompany("all")}>All</Segment>
                {companies.map((c) => <Segment key={c} active={company === c} onClick={() => setCompany(c)}>{c}</Segment>)}
              </SegmentedGroup>
              <SegmentedGroup label="Platform">
                <Segment active={plat === "all"} onClick={() => setPlat("all")}>All</Segment>
                {platforms.map((p) => <Segment key={p} active={plat === p} onClick={() => setPlat(p)}>{platformLabel(p)}</Segment>)}
              </SegmentedGroup>
            </div>

            {/* Posts */}
            {visible.length === 0 ? (
              <EmptyState icon={Rss} title="No posts match these filters" description="Choose another company or platform." />
            ) : (
              <div className="grid gap-inner grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 items-start">
                {visible.map((p, i) => (
                  <div key={`${p.postLink || i}`} className="glass p-inner space-y-2.5">
                    <PostVisual url={p.postLink} image={p.image} preview={p.postLink ? previews[p.postLink] : null} mediaType={p.type} platform={p.channel} />
                    <div className="flex items-center justify-between gap-2 t-secondary">
                      <span className="t-h4 truncate">{p.companyName}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {isBoosted(p.facebookLikelyBoosted) && <Badge variant="secondary" title="RivalIQ estimates this Facebook post was paid promotion">Likely boosted</Badge>}
                        {formatDate(p.publishedAt)}
                      </span>
                    </div>
                    {p.authorship === "collaboration" && <Badge variant="secondary">Company collaboration</Badge>}
                    <p className="t-body line-clamp-3 min-h-[4.5rem] whitespace-pre-line">{p.message ? cleanText(p.message) : "No caption."}</p>
                    <div className="flex gap-2 flex-wrap t-secondary">
                      <span>{fmt(p.engagementTotal)} eng.</span>
                      {p.estimatedImpressions ? <span>· {fmt(p.estimatedImpressions)} est. impr.</span> : null}
                      {p.views ? <span>· {fmt(p.views)} views</span> : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {p.postLink ? (
                        <a href={p.postLink} target="_blank" rel="noreferrer" className="t-link inline-flex items-center gap-1">Open <ExternalLink className="h-3 w-3" /></a>
                      ) : <span />}
                      {canRunAnalysis && !isOwnPost(p) && (
                        <Button size="sm" variant="outline" disabled={draft.isPending} onClick={() => setPendingDraft({ topic: topicFor(p), reason: reasonFor(p), platform: platformLabel(p.channel), about: `this post by ${p.companyName || "a competitor"}` })}>
                          <Sparkles /> Draft our take
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hiddenByLimit > 0 && (
              <p className="t-label">
                Showing the {matching.length} newest of {allMatching.length} posts in this filter.
              </p>
            )}
            {contentless > 0 && (
              <p className="t-label">{contentless} X {contentless === 1 ? "post is" : "posts are"} counted in the totals only: RivalIQ sends no link, caption or image for X.</p>
            )}
          </>
        )}
      <ConfirmDialog
        open={confirmRefresh}
        onOpenChange={setConfirmRefresh}
        title={snapshot ? "Refresh the competitor feed?" : "Pull the last 7 days?"}
        description={
          <>
            <p>
              This pulls the last seven days of posts for every tracked company from RivalIQ, which uses one request from the
              account's hourly allowance, and collects the reviewed LinkedIn pages and {clientName}'s own posts.
            </p>
            <p>The AI then looks for topics two or more companies posted about. It can take a minute or more.</p>
          </>
        }
        confirmLabel={snapshot ? "Refresh now" : "Pull posts"}
        destructive={false}
        onConfirm={() => {
          setConfirmRefresh(false);
          refresh.mutate();
        }}
      />
      <ConfirmDialog
        open={!!pendingDraft}
        onOpenChange={(o) => !o && setPendingDraft(null)}
        title="Draft our take?"
        description={
          <>
            <p>
              One {pendingDraft?.platform || "social"} post is written for {clientName} on {pendingDraft?.about || "this topic"} and
              added to {clientName}'s calendar for today, where it can be moved to its date.
            </p>
            <p>Nothing is published or scheduled.{pendingDraft?.alertId ? " The topic is marked as drafted." : ""}</p>
          </>
        }
        confirmLabel="Draft the post"
        destructive={false}
        onConfirm={() => {
          if (pendingDraft) draft.mutate({ topic: pendingDraft.topic, reason: pendingDraft.reason, platform: pendingDraft.platform, alertId: pendingDraft.alertId });
          setPendingDraft(null);
        }}
      />
      <ConfirmDialog
        open={!!dismissing}
        onOpenChange={(o) => !o && setDismissing(null)}
        title="Dismiss this alert?"
        description={<p>It comes off the feed. The posts behind it stay in the competitor data.</p>}
        confirmLabel="Dismiss"
        destructive={false}
        onConfirm={() => {
          if (dismissing) dismiss.mutate(dismissing);
          setDismissing(null);
        }}
      />
    </AppLayout>
  );
}
