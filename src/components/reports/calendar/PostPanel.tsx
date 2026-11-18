import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Download, Expand, Loader2, Sparkles, ThumbsDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { mondayOf } from "@/lib/calendarPosts";
import { previewWeek, waitingLine } from "@/lib/designWeek";
import { useDesignRequestForPost, useDesignRequests, useFilmedReasonForPost } from "./DesignRequestsContext";
import { DesignRequestsPanelDock } from "./DesignRequestsDock";
import { FeedbackDialog, PostDesign } from "./PostDesign";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NOT_YET, NotYet, useNotYet } from "@/components/ui/not-yet";
import { CalendarPostActions } from "@/components/calendar/CalendarPostActions";
import { ClipNotAccepted, createDesigns, designVersions, endedWithoutDesign, isDesignOption, isPreparing, ownStatusLine, putDesignInUse, sendDesignFeedback, uploadFilmedClip, type ShotBrief } from "@/lib/designRequests";
import { useAuth } from "@/hooks/useAuth";
import { PlatformBadge } from "@/lib/platform-config";
import { CopyEditor } from "./CopyEditor";
import { SchedulePostModal, scheduledFor, sendStateLine, useScheduledPosts, useSendClock } from "@/components/reports/SchedulePostModal";
import type { ClientContext } from "@/lib/clientContext";
import { formatLabel, isStoryPost, isTextOnlyFormat, isVideoFormat } from "@/lib/platform";
import { storyFileName } from "@/lib/story";
import { StoryLinks } from "./StoryLinks";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarPost } from "@/lib/calendarRevision";
import { tileAspectFor } from "@/lib/tileAspect";
import { useNaturalRatio, useVideoRatio, videoAspectClass } from "@/lib/naturalRatio";
import { mediaInUse, tilesFromIterations, type Iteration, type MediaTile } from "@/lib/postMediaTiles";
import { supabase } from "@/integrations/supabase/client";
import { postCopyOf } from "@/lib/postCopy";
import { finishIterations, type ProductionPlan } from "@/lib/creativeProduction";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any | null;
  /** Best-guess "primary" iteration for the active post — kept for backward-compat. */
  iteration?: Iteration | null;
  /** All iterations matching the active post (across variant groups). */
  postIterations: Iteration[];
  clientContext?: ClientContext;
  clientId?: string;
  reportId?: string;
  clientTimezone?: string;
  onCopySaved?: (post: CalendarPost) => void;
  /** Reject (with a reason the app learns from) or archive a variant. Staff only. */
  onFeedback?: (iterationId: string, verdict: "rejected" | "archived", reason?: string, note?: string) => Promise<void> | void;
  /** The tab to open on, e.g. "design" when arriving from a design progress card. */
  initialTab?: string;
}

/** Tailwind needs whole class names: the tab grid for 2, 3 or 4 tabs. */
const TAB_COLUMNS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)/i.test(url);
}

export function PostPanel({
  open,
  onOpenChange,
  post: sourcePost,
  postIterations,
  clientContext,
  clientId,
  reportId,
  clientTimezone,
  onCopySaved,
  onFeedback,
  initialTab,
}: Props) {
  const { isClient, isMoburstStaff } = useAuth();
  const queryClient = useQueryClient();
  const refreshMedia = () => { void queryClient.invalidateQueries({ queryKey: ["post-iterations", clientId] }); };
  // What the design controls say when a press got no answer (src/components/ui/not-yet.tsx).
  const notYet = useNotYet();
  const clearNotYet = notYet.clear;
  const [editedPost, setEditedPost] = useState<CalendarPost | null>(null);
  useEffect(() => { setEditedPost(null); setScheduleOpen(false); setTab(initialTab || "copy"); clearNotYet(); }, [sourcePost?._calendarPostKey, open, initialTab, clearNotYet]);
  const post = editedPost && editedPost._calendarPostKey === sourcePost?._calendarPostKey ? editedPost : sourcePost;
  const designRequest = useDesignRequestForPost(post);
  // Why this post's video is filmed; it stays known after a video from the posts was chosen instead.
  const filmedReason = useFilmedReasonForPost(post);
  const designRequests = useDesignRequests();
  const preparingDesigns = isPreparing(designRequest, isMoburstStaff);
  const [startingDesigns, setStartingDesigns] = useState(false);
  const [usingId, setUsingId] = useState<string | null>(null);
  // Designs are offered once the client's design settings exist: the
  // lifecycle works them out on its own (decision 2), so nobody confirms them.
  const { data: designSettings, isLoading: designSettingsLoading } = useQuery({
    queryKey: ["design-settings", clientId],
    enabled: !!clientId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("design_brand_settings" as any) as any).select("confirmed_at").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      return data as { confirmed_at: string | null } | null;
    },
  });
  const designsReady = !!designSettings?.confirmed_at;
  // What the client's design setup still waits for, said to staff in the Design tab (the same sentence the week band uses).
  const postDay = typeof post?.date_label === "string" && /^\d{4}-\d{2}-\d{2}/.test(post.date_label) ? post.date_label.slice(0, 10) : null;
  const { data: waitingText } = useQuery({
    queryKey: ["design-waiting", clientId, postDay ? mondayOf(postDay) : null],
    enabled: !!clientId && open && isMoburstStaff && !designSettingsLoading && !designsReady && !!postDay,
    queryFn: async () => {
      const preview = await previewWeek(clientId!, mondayOf(postDay!));
      return preview?.code === "not_set_up" ? waitingLine(preview.waiting_for, preview.client_name ?? clientContext?.client_name) : null;
    },
  });
  // The post's state in Sprout: sent for a time, or not sent yet.
  const { data: scheduledRows } = useScheduledPosts(clientId, open && !isClient);
  const scheduled = scheduledFor(scheduledRows, sourcePost);
  const sendClock = useSendClock(scheduled);
  // A filmed post's video can instead be made in the look of the client's
  // posts; once chosen, making it again follows the same route.
  // The shot brief for a filmed post: only Moburst staff and admins can read it.
  const { data: shotBrief } = useQuery({
    queryKey: ["shot-brief", clientId, post?._calendarPostKey],
    enabled: !!clientId && open && isMoburstStaff && !!filmedReason && !!post?._calendarPostKey,
    queryFn: async () => {
      const { data, error } = await (supabase.from("design_shot_briefs" as any) as any)
        .select("brief").eq("client_id", clientId).eq("calendar_post_key", post!._calendarPostKey).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return (data?.brief ?? null) as ShotBrief | null;
    },
    // Written a few seconds after the post is marked as filmed.
    refetchInterval: (query) => (query.state.data ? false : 5000),
  });
  /** Start the post's design, with the note left on Regenerate; true once it has started. */
  const startDesigns = async (route?: "posts", note?: string): Promise<boolean> => {
    if (!clientId || !post) return false;
    setStartingDesigns(true);
    try {
      // A client whose settings are still being worked out gets its design once they are.
      const started = await createDesigns({ clientId, reportId, post, route: route ?? (filmedReason ? "posts" : undefined), note });
      designRequests?.refresh();
      return !!started.request;
    } catch {
      // Nothing is shown: the panel shows a design being prepared once one is.
      designRequests?.refresh();
      return false;
    } finally {
      setStartingDesigns(false);
    }
  };
  /** Create design and Make this video: when the press got no answer the panel says it is not started yet. */
  const startFromButton = async (route?: "posts") => {
    notYet.clear();
    if (!(await startDesigns(route))) notYet.say(NOT_YET.start);
  };
  const [uploadingClip, setUploadingClip] = useState(false);
  /** A clip that has not gone up yet: it stays selected, so sending it again never means choosing it again. */
  const [pendingClip, setPendingClip] = useState<File | null>(null);
  const [clipNote, setClipNote] = useState<string | null>(null);
  const uploadClip = async (file: File) => {
    if (!clientId || !post) return;
    setUploadingClip(true);
    setClipNote(null);
    try {
      await uploadFilmedClip({ clientId, reportId, post, file });
      setPendingClip(null);
      designRequests?.refresh();
      toast.success("Clip uploaded", { description: "The hook and your logo are being added." });
    } catch (e) {
      if (e instanceof ClipNotAccepted) setClipNote(e.message);
      else setPendingClip(file);
    } finally {
      setUploadingClip(false);
    }
  };
  // Sent again quietly when they do not get through; the designs then show what the server has.
  const applyDesign = async (iterationId: string) => {
    setUsingId(iterationId);
    notYet.clear();
    try {
      await putDesignInUse(iterationId);
      toast.success("In use for this post");
    } catch {
      // The design shown in use is the one the server has.
      notYet.say(NOT_YET.use);
    } finally {
      refreshMedia();
      setUsingId(null);
    }
  };
  const designFeedback = async (iterationId: string, verdict: "rejected" | "deleted", reason?: string, note?: string, makeNew?: boolean): Promise<boolean> => {
    notYet.clear();
    try {
      const { request } = await sendDesignFeedback({ iterationId, verdict, reason, note, makeNew });
      toast.success(verdict === "deleted" ? "Deleted" : request ? "Thanks. A new design is being made with your feedback." : "Thanks. The next designs will take it into account.");
      return true;
    } catch {
      // The post's designs show what the server has.
      notYet.say(verdict === "deleted" ? NOT_YET.delete : NOT_YET.feedback);
      return false;
    } finally {
      refreshMedia();
      designRequests?.refresh();
    }
  };
  // Older media tiles: the parent only sends and throws when the send got no
  // answer. The outcome words are the design's own, shown here.
  const tileFeedback = async (iterationId: string, verdict: "rejected" | "archived", ...details: [reason?: string, note?: string]): Promise<boolean> => {
    if (!onFeedback) return false;
    notYet.clear();
    try {
      await onFeedback(iterationId, verdict, ...details);
      toast.success(verdict === "archived" ? "Deleted" : "Thanks. The next designs will take it into account.");
      return true;
    } catch {
      notYet.say(verdict === "archived" ? NOT_YET.delete : NOT_YET.feedback);
      return false;
    }
  };
  // Artwork the server completed while nobody was watching still needs its
  // headline card, type and logo. Finish it here, once per row.
  const finishingRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isMoburstStaff || !clientId) return;
    const pending = postIterations.filter((it) => it.id && it.finishing === "pending" && /^Reference creative ([0-9a-f-]{36})/.test(String(it.variant_angle || "")) && !finishingRef.current.has(it.id));
    if (!pending.length) return;
    const byPlan = new Map<string, Iteration[]>();
    for (const it of pending) { const planId = String(it.variant_angle).match(/^Reference creative ([0-9a-f-]{36})/)![1]; byPlan.set(planId, [...(byPlan.get(planId) || []), it]); finishingRef.current.add(it.id!); }
    (async () => {
      for (const [planId, rows] of byPlan) {
        try {
          const { data: plan, error } = await supabase.functions.invoke("get-creative-plan", { body: { plan_id: planId, client_id: clientId } });
          if (error || !plan?.id) throw new Error("plan unavailable");
          await finishIterations(rows.map((r, i) => ({ id: r.id!, media_urls: r.media_urls || [], frames: [], finishing: r.finishing || undefined })), { ...(plan as ProductionPlan), client_id: clientId }, { platform: plan.platform || post?.platform, format: plan.format || post?.format });
          refreshMedia();
        } catch (e) {
          console.warn("[PostPanel] finishing failed:", e);
          for (const r of rows) finishingRef.current.delete(r.id!);
        }
      }
    })();
  }, [postIterations, isMoburstStaff, clientId]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  // A post planned as a Reel opens on the tab that makes one. The Design tab
  // only ever produced stills, so clicking it on a video recommendation handed
  // back the wrong asset with nothing to say so.
  const plannedVideo = isVideoFormat(post?.format, post?.platform);
  // A Story is posted by hand: its panel has Message and Design, no Schedule and no Video; its header links it to its post (StoryLinks.tsx).
  const story = isStoryPost(post);
  const [tab, setTab] = useState<string>("copy");
  // A video post's one media tab becomes Video once its design settings load;
  // a click on the older Video list during that moment moves over to it.
  const videoDesignsReady = plannedVideo && designsReady;
  useEffect(() => {
    if (videoDesignsReady && tab === "video") setTab("design");
  }, [videoDesignsReady, tab]);
  if (!post) return null;

  const imageTiles = tilesFromIterations(postIterations, (u) => !isVideoUrl(u));
  const videoTiles = tilesFromIterations(postIterations, isVideoUrl);
  // One design per post; earlier ones stay on the post to switch back to. A
  // video post's design is its video (cover card, footage, end card).
  const videoDesigns = plannedVideo && designsReady;
  // The Video tab lists the videos a post already has; it makes none.
  const showVideoTab = !videoDesigns && !story && videoTiles.length > 0;
  const showScheduleTab = !isClient && !story;
  const versions = designVersions(postIterations, videoDesigns ? isVideoUrl : (u) => !isVideoUrl(u));
  const otherTiles = imageTiles.filter((t) => !isDesignOption({ variant_angle: t.variantAngle }));
  // The format as the cards show it: its kind's label, never the planner's raw text.
  const formatText = formatLabel(post.format, post.platform);
  const isCarouselPost = /carousel|document|pdf/i.test(String(post.format || "")) || (versions[0]?.urls.length ?? 0) > 1;

  const openPreview = (url: string, video: boolean) => {
    setPreviewUrl(url);
    setPreviewIsVideo(video);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto print:hidden bg-[rgba(11,12,16,0.92)] backdrop-blur-[60px] border-l border-white/[0.08]"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 flex-wrap t-h3">
              {post.platform && <PlatformBadge platform={post.platform} size="sm" />}
              {formatText && (
                <Badge
                  variant="outline"
                  className="t-badge tracking-[-0.2px] py-0.5 px-2 rounded-full border-white/15"
                >
                  {formatText}
                </Badge>
              )}
              {post.posting_time && (
                <span className="t-label">
                  {post.posting_time}
                </span>
              )}
              {/* Add a Story, open the post's Story, or open a Story's post: on every tab, for staff and the client's users. */}
              <StoryLinks post={post} clientId={clientId} />
              {isMoburstStaff && post._calendarPostId && (
                <span className="ml-auto mr-6">
                  <CalendarPostActions postId={post._calendarPostId} clientId={clientId} date={String(post.date_label || "")} onDone={() => onOpenChange(false)} />
                </span>
              )}
            </SheetTitle>
          </SheetHeader>
          <SheetDescription className="sr-only">Review the copy and creative for this post.</SheetDescription>

          {notYet.line && <NotYet className="mt-4">{notYet.line}</NotYet>}
          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList className={`grid ${TAB_COLUMNS[2 + (showVideoTab ? 1 : 0) + (showScheduleTab ? 1 : 0)]}`}>
              <TabsTrigger value="copy">{story ? "Message" : "Copy"}</TabsTrigger>
              {/* A video post's design is made as a video, so its one media tab is Video. */}
              <TabsTrigger value="design">{videoDesigns ? "Video" : plannedVideo ? "Cover" : "Design"}</TabsTrigger>
              {showVideoTab && (
                <TabsTrigger value="video" className="gap-1.5">
                  Video
                  {plannedVideo && <span className="h-1.5 w-1.5 rounded-full bg-[#b9e045]" aria-hidden />}
                </TabsTrigger>
              )}
              {showScheduleTab && <TabsTrigger value="schedule">Schedule</TabsTrigger>}
            </TabsList>

            {/* Copy tab */}
            <TabsContent value="copy" className="mt-4">
              <CopyEditor post={post} clientId={clientId} reportId={reportId} brand={clientContext?.client_name ?? null} onCopySaved={(updated) => {
                setEditedPost(updated);
                onCopySaved?.(updated);
              }} />
            </TabsContent>

            {/* Design tab */}
            <TabsContent value="design" className="mt-4 space-y-4">
              {clipNote && <p role="status" className="t-secondary">{clipNote}</p>}
              {pendingClip && !uploadingClip && (
                <div className="glass-inner p-inner flex items-center justify-between gap-3" role="status">
                  <p className="t-secondary min-w-0 truncate">{pendingClip.name} is not uploaded yet.</p>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => void uploadClip(pendingClip)}>Upload</Button>
                </div>
              )}
              {designsReady ? (
                <>
                  <div className="min-w-0">
                    <p className="t-h4">{videoDesigns ? "Video" : isCarouselPost ? "Carousel" : "Design"}</p>
                    {(!filmedReason || versions.length > 0) && (
                      <p className="t-secondary">{!videoDesigns
                        ? "Made in your brand's style, with your logo and the post's words."
                        : filmedReason
                          ? "Made in the look of your brand's posts, with the post's hook, your logo and sound."
                          : "Made in the style of your brand's own videos, with sound. Text and logo appear the way your videos use them."}</p>
                    )}
                  </div>
                  <PostDesign
                    versions={versions}
                    preparing={preparingDesigns ? designRequest : null}
                    notMade={endedWithoutDesign(designRequest) ? designRequest : null}
                    // A filmed post offers its two ways whenever it has no video yet, whatever was tried last.
                    onCamera={filmedReason}
                    textOnly={isTextOnlyFormat(post.format)}
                    onUploadClip={uploadClip}
                    uploadingClip={uploadingClip}
                    isStaff={isMoburstStaff}
                    // A video is made in its platform's upload size (the request's own): its frame has that shape until it loads.
                    aspect={videoDesigns ? videoAspectClass(designRequest?.upload_size) : tileAspectFor(post) || "aspect-[4/5]"}
                    filenameStub={`design-${post.platform || "post"}`}
                    onCreate={() => void startFromButton()}
                    onRegenerate={(note) => startDesigns(undefined, note)}
                    brand={clientContext?.client_name ?? null}
                    onMakeFromPosts={() => void startFromButton("posts")}
                    filmedReason={filmedReason}
                    shotBrief={isMoburstStaff ? shotBrief ?? null : null}
                    creating={startingDesigns}
                    onUse={applyDesign}
                    usingId={usingId}
                    onFeedback={designFeedback}
                    feedbackLine={notYet.line === NOT_YET.feedback ? notYet.line : null}
                    waitingForCopy={!postCopyOf(post).trim()}
                    storyFileName={story ? storyFileName(clientContext?.client_name, String(post.date_label || "")) : null}
                  />
                  {!isClient && otherTiles.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <p className="t-label">Other media for this post</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {otherTiles.map((tile, i) => (
                          <MediaTileCard
                            key={`${tile.iterationId || "media"}:${tile.url}:${i}`}
                            tile={tile}
                            index={i}
                            isVideo={false}
                            tileAspect={tileAspectFor(post)}
                            filenameStub={`design-${post.platform || "post"}`}
                            onPreview={() => openPreview(tile.url, false)}
                            onUse={applyDesign}
                            using={usingId === tile.iterationId}
                            feedbackLine={notYet.line === NOT_YET.feedback ? notYet.line : null}
                            onFeedback={onFeedback ? tileFeedback : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="t-h4">
                      {imageTiles.length > 0
                        ? `${imageTiles.length} design${imageTiles.length === 1 ? "" : "s"}`
                        : "No designs yet"}
                    </p>
                    <p className="t-secondary">
                      {imageTiles.length > 0
                        ? "Click a design to see it at full size."
                        : waitingText ?? "Designs for this post appear here."}
                    </p>
                  </div>

                  {imageTiles.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {imageTiles.map((tile, i) => (
                        <MediaTileCard
                          key={`${tile.iterationId || "media"}:${tile.url}:${i}`}
                          tile={tile}
                          index={i}
                          isVideo={false}
                          tileAspect={tileAspectFor(post)}
                          filenameStub={`design-${post.platform || "post"}`}
                          onPreview={() => openPreview(tile.url, false)}
                          onUse={isClient ? undefined : applyDesign}
                          using={usingId === tile.iterationId}
                          feedbackLine={notYet.line === NOT_YET.feedback ? notYet.line : null}
                          onFeedback={isClient || !onFeedback ? undefined : tileFeedback}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="glass-inner border-dashed border-white/10 p-8 text-center space-y-2">
                      <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
                      <p className="t-secondary">No designs for this post yet.</p>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Video tab */}
            <TabsContent value="video" className="mt-4 space-y-4">
              <div>
                <p className="t-h4">{`${videoTiles.length} video${videoTiles.length === 1 ? "" : "s"}`}</p>
                <p className="t-secondary">Click any video to preview at full size.</p>
              </div>

              {videoTiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videoTiles.map((tile, i) => (
                    <MediaTileCard
                      key={`${tile.iterationId || "media"}:${tile.url}:${i}`}
                      tile={tile}
                      index={i}
                      isVideo={true}
                      tileAspect={tileAspectFor(post)}
                      filenameStub={`video-${post.platform || "post"}`}
                      onPreview={() => openPreview(tile.url, true)}
                      onUse={applyDesign}
                      using={usingId === tile.iterationId}
                      feedbackLine={notYet.line === NOT_YET.feedback ? notYet.line : null}
                      onFeedback={isClient || !onFeedback ? undefined : tileFeedback}
                    />
                  ))}
                </div>
              ) : (
                <div className="glass-inner border-dashed border-white/10 p-8 text-center space-y-2">
                  <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
                  <p className="t-secondary">
                    No videos generated for this post yet.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Schedule tab — hidden for clients */}
            {!isClient && (
              <TabsContent value="schedule" className="mt-4 space-y-3">
                {/* The same state, in the same words, as the send dialog (sendStateOf). */}
                <p className="t-body" role="status">{sendStateLine(scheduled, clientTimezone, sendClock)}</p>
                {clientId ? (
                  <>
                    <Button onClick={() => setScheduleOpen(true)}>Send to Sprout</Button>
                    <SchedulePostModal
                      open={scheduleOpen}
                      onOpenChange={setScheduleOpen}
                      post={post}
                      clientId={clientId}
                      reportId={reportId}
                      // What the Design tab shows as the post's media, from whichever group it is in.
                      generatedMediaUrls={mediaInUse(postIterations)}
                      clientTimezone={clientTimezone}
                    />
                  </>
                ) : (
                  <p className="t-secondary">
                    This post can't be scheduled from here.
                  </p>
                )}
              </TabsContent>
            )}
          </Tabs>
          {/* The panel covers the page's progress cards, so they show here while it is open. */}
          {/* The Design tab says this post's own status; on the other tabs one line does. */}
          {tab !== "design" && ownStatusLine(designRequest) && <NotYet className="mt-6">{ownStatusLine(designRequest)}</NotYet>}
          <DesignRequestsPanelDock exceptPost={post._calendarPostKey} />
        </SheetContent>
      </Sheet>

      {/* Full-size preview overlay */}
      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent className="max-w-5xl bg-black/95 border-white/10 p-0 overflow-hidden">
          {/* Radix labels a dialog by its Title. Without one the dialog is
              announced with no name and Radix logs an error. */}
          <DialogTitle className="sr-only">Full-size preview</DialogTitle>
          {previewUrl && previewIsVideo && (
            <video
              src={previewUrl}
              className="w-full h-auto max-h-[88vh]"
              controls
              autoPlay
              loop
            />
          )}
          {previewUrl && !previewIsVideo && (
            <img
              src={previewUrl}
              alt="Full-size preview"
              className="w-full h-auto max-h-[88vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TileCardProps {
  tile: MediaTile;
  index: number;
  isVideo: boolean;
  /** The box this variant is shown in, matched to the ratio it was made at. */
  tileAspect?: string;
  filenameStub: string;
  onPreview: () => void;
  /** Resolves to whether the feedback got through. */
  onFeedback?: (iterationId: string, verdict: "rejected" | "archived", ...details: [reason?: string, note?: string]) => Promise<boolean>;
  /** Put this one in use for the post: the design's own Use, which leaves every other one of the post not in use. */
  onUse?: (iterationId: string) => void;
  using?: boolean;
  /** The line the panel shows when Not right got no answer, shown inside the dialog the person is looking at. */
  feedbackLine?: string | null;
}

function MediaTileCard({
  tile,
  index,
  isVideo,
  tileAspect,
  filenameStub,
  onPreview,
  onFeedback,
  onUse,
  using,
  feedbackLine,
}: TileCardProps) {
  const canUse = !!tile.iterationId && !!onUse;
  const canReview = !!tile.iterationId && !!onFeedback;
  const [rejecting, setRejecting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const noun = isVideo ? "video" : "design";
  // A tile takes the design's own shape once it has loaded: a design or a video is made in its platform's upload size.
  const { ratio, onLoad } = useNaturalRatio();
  const { ratio: videoShape, onLoadedMetadata } = useVideoRatio();
  // A vertical video keeps the tile it always had; only a landscape one takes its own shape.
  const shown = isVideo ? (videoShape !== null && videoShape > 1 ? videoShape : null) : ratio;
  const shaped = shown !== null;
  // The same words as the post's own design: Not right and Delete.
  const submit = async (verdict: "rejected" | "archived", reason?: string, note?: string): Promise<boolean> => {
    if (!tile.iterationId || !onFeedback) return false;
    setBusy(true);
    try {
      return verdict === "rejected" ? await onFeedback(tile.iterationId, verdict, reason, note) : await onFeedback(tile.iterationId, verdict);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={`glass-inner overflow-hidden border ${
        tile.isSelected ? "border-primary/60 ring-1 ring-primary/40" : "border-white/5"
      }`}
    >
      <button
        type="button"
        onClick={onPreview}
        className={`block w-full bg-black relative group ${shaped ? "" : tileAspect || (isVideo ? "aspect-[9/16]" : "aspect-square")}`}
        style={shaped ? { aspectRatio: String(shown) } : undefined}
      >
        {isVideo ? (
          <video src={tile.url} className="w-full h-full object-contain" muted loop preload="metadata" onLoadedMetadata={onLoadedMetadata} />
        ) : (
          <img src={tile.url} alt={`Variant ${index + 1}`} className="w-full h-full object-contain" onLoad={onLoad} />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <Expand className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {tile.isSelected && (
          <span className="absolute top-2 left-2 bg-primary text-primary-foreground rounded-full p-1.5">
            <Check className="h-3 w-3" />
          </span>
        )}
      </button>

      <div className="flex items-center justify-between px-2 py-1.5 bg-[rgba(0,0,0,0.4)]">
        <span className="t-secondary uppercase tracking-wide">
          #{index + 1}
        </span>
        <div className="flex items-center gap-1">
          {canUse && (tile.isSelected ? (
            <span className="inline-flex items-center gap-1 px-2 text-sm text-primary">
              <Check className="h-3 w-3" aria-hidden />
              In use for this post
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onUse!(tile.iterationId!); }}
              disabled={using}
              aria-label="Use for this post"
            >
              {using ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
              Use
            </Button>
          ))}
          {canReview && (
            <>
              <Button variant="ghost" size="sm" aria-label="Not right: tell us why" onClick={() => setRejecting(true)} disabled={busy}>
                <ThumbsDown className="h-3.5 w-3.5" />Not right
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete this ${noun}`} onClick={() => setDeleteOpen(true)} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button asChild variant="ghost" size="sm">
            <a
              href={tile.url}
              download={`${filenameStub}-${index + 1}.${isVideo ? "mp4" : "png"}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Download /> Download
            </a>
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`Delete this ${noun}?`}
            description="It's removed from this post. To say what was wrong so the next designs improve, use Not right instead."
            confirmLabel="Delete"
            onConfirm={async () => { setDeleteOpen(false); await submit("archived"); }}
          />
          <FeedbackDialog
            open={rejecting}
            isCurrent={false}
            noun={noun}
            line={feedbackLine}
            onOpenChange={setRejecting}
            onSubmit={async (reason, note) => { if (await submit("rejected", reason, note)) setRejecting(false); }}
          />
        </div>
      </div>
    </div>
  );
}
