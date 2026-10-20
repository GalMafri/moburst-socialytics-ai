import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Archive, Check, Download, Expand, Loader2, Sparkles, Star, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useDesignRequestForPost, useDesignRequests, useFilmedReasonForPost } from "./DesignRequestsContext";
import { PostDesign } from "./PostDesign";
import { CalendarPostActions } from "@/components/calendar/CalendarPostActions";
import { ClipNotAccepted, createDesigns, designVersions, isDesignOption, isPreparing, putDesignInUse, sendDesignFeedback, uploadFilmedClip, type ShotBrief } from "@/lib/designRequests";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/useAuth";
import { PlatformBadge } from "@/lib/platform-config";
import { CopyEditor } from "./CopyEditor";
import { CreatePostDesignButton } from "@/components/reports/CreatePostDesignButton";
import { useGenerationForPost } from "@/components/reports/calendar/GenerationContext";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";
import { SchedulePostModal, scheduledFor, useScheduledPosts } from "@/components/reports/SchedulePostModal";
import { formatDateTime } from "@/lib/display";
import type { ClientContext } from "@/lib/clientContext";
import { isTextOnlyFormat, isVideoFormat } from "@/lib/platform";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarPost } from "@/lib/calendarRevision";
import { tileAspectFor } from "@/lib/tileAspect";
import { tilesFromIterations, type Iteration, type MediaTile } from "@/lib/postMediaTiles";
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
  /** Toggle is_selected on a variant. */
  onToggleSelected?: (iterationId: string, nextSelected: boolean) => void;
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
  onToggleSelected,
  onFeedback,
  initialTab,
}: Props) {
  const { isClient, isMoburstStaff } = useAuth();
  const queryClient = useQueryClient();
  const refreshMedia = () => { void queryClient.invalidateQueries({ queryKey: ["post-iterations", clientId] }); };
  const [editedPost, setEditedPost] = useState<CalendarPost | null>(null);
  useEffect(() => { setEditedPost(null); setScheduleOpen(false); setTab(initialTab || "copy"); }, [sourcePost?._calendarPostKey, open, initialTab]);
  const post = editedPost && editedPost._calendarPostKey === sourcePost?._calendarPostKey ? editedPost : sourcePost;
  const designRun = useGenerationForPost(post);
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
  // The post's state in Sprout: scheduled for a time, or not scheduled yet.
  const { data: scheduledRows } = useScheduledPosts(clientId, open && !isClient);
  const scheduled = scheduledFor(scheduledRows, sourcePost);
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
  const startDesigns = async (route?: "posts") => {
    if (!clientId || !post) return;
    setStartingDesigns(true);
    try {
      // A client whose settings are still being worked out gets its design once they are.
      await createDesigns({ clientId, reportId, post, route: route ?? (filmedReason ? "posts" : undefined) });
      designRequests?.refresh();
    } catch {
      // Nothing is shown: the panel shows a design being prepared once one is.
      designRequests?.refresh();
    } finally {
      setStartingDesigns(false);
    }
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
    try {
      await putDesignInUse(iterationId);
      toast.success("In use for this post");
    } catch {
      // The design shown in use is the one the server has.
    } finally {
      refreshMedia();
      setUsingId(null);
    }
  };
  const designFeedback = async (iterationId: string, verdict: "rejected" | "deleted", reason?: string, note?: string, makeNew?: boolean) => {
    try {
      const { request } = await sendDesignFeedback({ iterationId, verdict, reason, note, makeNew });
      toast.success(verdict === "deleted" ? "Deleted" : request ? "Thanks. A new design is being made with your feedback." : "Thanks. The next designs will take it into account.");
    } catch {
      // The post's designs show what the server has.
    } finally {
      refreshMedia();
      designRequests?.refresh();
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
  // A still post's Video tab is the team's tool; a client sees it only once the post has a video.
  const showVideoTab = !videoDesigns && (!isClient || videoTiles.length > 0);
  const versions = designVersions(postIterations, videoDesigns ? isVideoUrl : (u) => !isVideoUrl(u));
  const otherTiles = imageTiles.filter((t) => !isDesignOption({ variant_angle: t.variantAngle }));
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
              {post.format && (
                <Badge
                  variant="outline"
                  className="t-badge tracking-[-0.2px] py-0.5 px-2 rounded-full border-white/15"
                >
                  {post.format}
                </Badge>
              )}
              {post.posting_time && (
                <span className="t-label">
                  {post.posting_time}
                </span>
              )}
              {isMoburstStaff && post._calendarPostId && (
                <span className="ml-auto mr-6">
                  <CalendarPostActions postId={post._calendarPostId} clientId={clientId} date={String(post.date_label || "")} onDone={() => onOpenChange(false)} />
                </span>
              )}
            </SheetTitle>
          </SheetHeader>
          <SheetDescription className="sr-only">Review the copy and creative for this post.</SheetDescription>

          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList className={`grid ${TAB_COLUMNS[2 + (showVideoTab ? 1 : 0) + (isClient ? 0 : 1)]}`}>
              <TabsTrigger value="copy">Copy</TabsTrigger>
              {/* A video post's design is made as a video, so its one media tab is Video. */}
              <TabsTrigger value="design">{videoDesigns ? "Video" : plannedVideo ? "Cover" : "Design"}</TabsTrigger>
              {showVideoTab && (
                <TabsTrigger value="video" className="gap-1.5">
                  Video
                  {plannedVideo && <span className="h-1.5 w-1.5 rounded-full bg-[#b9e045]" aria-hidden />}
                </TabsTrigger>
              )}
              {!isClient && <TabsTrigger value="schedule">Schedule</TabsTrigger>}
            </TabsList>

            {/* Copy tab */}
            <TabsContent value="copy" className="mt-4">
              <CopyEditor post={post} clientId={clientId} reportId={reportId} onCopySaved={(updated) => {
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
              {plannedVideo && !designsReady && (
                <div className="glass-inner p-inner flex items-start justify-between gap-3 flex-wrap">
                  <p className="t-body min-w-0">
                    This post is planned as a <span className="font-semibold text-white">{post.format}</span>. Designs here are stills, useful as a cover frame; the clip itself is generated on the Video tab.
                  </p>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setTab("video")}>
                    Go to Video
                  </Button>
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
                    // A filmed post offers its two ways whenever it has no video yet, whatever was tried last.
                    onCamera={filmedReason}
                    textOnly={isTextOnlyFormat(post.format)}
                    onUploadClip={uploadClip}
                    uploadingClip={uploadingClip}
                    isStaff={isMoburstStaff}
                    aspect={videoDesigns ? "aspect-[9/16]" : tileAspectFor(post) || "aspect-[4/5]"}
                    filenameStub={`design-${post.platform || "post"}`}
                    onCreate={() => void startDesigns()}
                    onMakeFromPosts={() => void startDesigns("posts")}
                    filmedReason={filmedReason}
                    shotBrief={isMoburstStaff ? shotBrief ?? null : null}
                    creating={startingDesigns}
                    onUse={applyDesign}
                    usingId={usingId}
                    onFeedback={designFeedback}
                    waitingForCopy={!postCopyOf(post).trim()}
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
                            onToggleSelected={onToggleSelected}
                            onFeedback={onFeedback}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-h4">
                        {imageTiles.length > 0
                          ? `${imageTiles.length} design${imageTiles.length === 1 ? "" : "s"}`
                          : designRun?.status === "running"
                            ? `Generating designs · ${designRun.completed}/${designRun.total} done`
                            : "No designs yet"}
                      </p>
                      <p className="t-secondary">
                        {imageTiles.length > 0
                          ? "Click a design to see it at full size."
                          : designRun?.status === "running"
                            ? "The run continues while this panel is closed. Open Design to follow it."
                            : isMoburstStaff
                              ? "Make one when this post needs it."
                              : "Designs the team makes for this post appear here."}
                      </p>
                    </div>
                    {!designSettingsLoading && isMoburstStaff && <CreatePostDesignButton
                      post={post}
                      clientContext={clientContext}
                      clientId={clientId}
                      onImagesGenerated={refreshMedia}
                    />}
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
                          onToggleSelected={isClient ? undefined : onToggleSelected}
                          onFeedback={isClient ? undefined : onFeedback}
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
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="t-h4">
                    {videoTiles.length > 0
                      ? `${videoTiles.length} video${videoTiles.length === 1 ? "" : "s"}`
                      : "No videos yet"}
                  </p>
                  <p className="t-secondary">
                    {videoTiles.length > 0
                      ? "Click any video to preview at full size."
                      : !isMoburstStaff
                        ? "Your account team adds the video for this post."
                        : clientContext?.design_style_synthesis?.reference_pipeline_version === 1
                          ? "Create a 12-second film with three moving scenes, guided by this client’s real social references."
                          : "Create short video drafts, then preview and choose a favorite."}
                  </p>
                </div>
                {isMoburstStaff && <CreatePostVideoButton
                  post={post}
                  clientContext={clientContext}
                  clientId={clientId}
                  onVideoGenerated={refreshMedia}
                />}
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
                      onToggleSelected={onToggleSelected}
                      onFeedback={isClient ? undefined : onFeedback}
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
                <p className="t-body" role="status">
                  {scheduled?.scheduled_time
                    ? `Scheduled for ${formatDateTime(scheduled.scheduled_time, { timeZone: clientTimezone })}.`
                    : "Not scheduled yet."}
                </p>
                {clientId ? (
                  <>
                    <Button onClick={() => setScheduleOpen(true)}>{scheduled ? "Open scheduler" : "Schedule to Sprout"}</Button>
                    <SchedulePostModal
                      open={scheduleOpen}
                      onOpenChange={setScheduleOpen}
                      post={post}
                      clientId={clientId}
                      reportId={reportId}
                      generatedMediaUrls={imageTiles
                        .filter((t) => t.isSelected)
                        .map((t) => t.url)
                        .concat(videoTiles.filter((t) => t.isSelected).map((t) => t.url))}
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
  onToggleSelected?: (iterationId: string, nextSelected: boolean) => void;
  onFeedback?: (iterationId: string, verdict: "rejected" | "archived", reason?: string, note?: string) => Promise<void> | void;
  /** For a design option: put it in use for the post. */
  onUse?: () => void;
  using?: boolean;
}

const REJECT_REASONS: Array<{ value: string; label: string }> = [
  { value: "off_brand_colours", label: "Off-brand colors" },
  { value: "wrong_style", label: "Wrong style or layout" },
  { value: "text_errors", label: "Text is wrong or garbled" },
  { value: "logo_or_mark", label: "Shows a logo or mark it shouldn't" },
  { value: "not_relevant", label: "Doesn't fit the message" },
  { value: "other", label: "Something else" },
];

function MediaTileCard({
  tile,
  index,
  isVideo,
  tileAspect,
  filenameStub,
  onPreview,
  onToggleSelected,
  onFeedback,
  onUse,
  using,
}: TileCardProps) {
  const canToggle = !!tile.iterationId && !!onToggleSelected;
  const canReview = !!tile.iterationId && !!onFeedback;
  const [rejecting, setRejecting] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reason, setReason] = useState("wrong_style");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (verdict: "rejected" | "archived") => {
    if (!tile.iterationId || !onFeedback) return;
    setBusy(true);
    try {
      await onFeedback(tile.iterationId, verdict, verdict === "rejected" ? reason : undefined, verdict === "rejected" ? note : undefined);
      setRejecting(false);
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
        className={`block w-full bg-black relative group ${tileAspect || (isVideo ? "aspect-[9/16]" : "aspect-square")}`}
      >
        {isVideo ? (
          <video src={tile.url} className="w-full h-full object-contain" muted loop preload="metadata" />
        ) : (
          <img src={tile.url} alt={`Variant ${index + 1}`} className="w-full h-full object-contain" />
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

      {onUse && (
        <div className="px-2 pt-2 bg-[rgba(0,0,0,0.4)]">
          {tile.isSelected ? (
            <span className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-[10px] bg-[rgba(185,224,69,0.10)] text-[#b9e045] text-sm font-medium">
              <Check className="h-3.5 w-3.5" /> In use
            </span>
          ) : (
            <Button size="sm" className="w-full h-9" onClick={(e) => { e.stopPropagation(); onUse(); }} disabled={using}>
              {using ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Use this design
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between px-2 py-1.5 bg-[rgba(0,0,0,0.4)]">
        <span className="t-secondary uppercase tracking-wide">
          #{index + 1}
        </span>
        <div className="flex items-center gap-1">
          {canToggle && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelected!(tile.iterationId!, !tile.isSelected);
              }}
              title={tile.isSelected ? "Unmark as favorite" : "Mark as favorite"}
            >
              <Star
                className={`h-3 w-3 ${tile.isSelected ? "fill-primary text-primary" : ""}`}
              />
            </Button>
          )}
          {canReview && (
            <>
              <Button variant="ghost" size="icon-sm" title="Reject and teach the app why" aria-label="Reject this design" onClick={() => setRejecting(true)} disabled={busy}>
                <ThumbsDown className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" title="Archive without feedback" aria-label="Archive this design" onClick={() => setArchiveOpen(true)} disabled={busy}>
                <Archive className="h-3.5 w-3.5" />
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
            open={archiveOpen}
            onOpenChange={setArchiveOpen}
            title="Archive this design?"
            description={<p>It comes out of the post's designs. Nothing is learned from an archive. Reject it instead if it is wrong for the brand.</p>}
            confirmLabel="Archive"
            destructive={false}
            onConfirm={() => {
              setArchiveOpen(false);
              void submit("archived");
            }}
          />
          {/* The reason is what turns a rejection into a rule for the next design. */}
          <Dialog open={rejecting} onOpenChange={setRejecting}>
            <DialogContent className="max-w-md">
              <div className="space-y-4">
                <div>
                  <DialogTitle className="t-h3">Why is this one wrong?</DialogTitle>
                  <p className="t-secondary mt-1">The design is hidden either way. The reason becomes a rule the next designs for this client follow.</p>
                </div>
                <RadioGroup value={reason} onValueChange={setReason} className="space-y-2">
                  {REJECT_REASONS.map((r) => (
                    <div key={r.value} className="flex items-center gap-2">
                      <RadioGroupItem value={r.value} id={`reason-${tile.iterationId}-${r.value}`} />
                      <Label htmlFor={`reason-${tile.iterationId}-${r.value}`} className="t-body font-normal">{r.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
                <div className="space-y-1.5">
                  <Label htmlFor={`note-${tile.iterationId}`} className="t-label">Anything specific? (optional)</Label>
                  <Textarea id={`note-${tile.iterationId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. the red button, this brand never uses red" className="t-body" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
                  <Button size="sm" onClick={() => submit("rejected")} disabled={busy}>
                    <ThumbsDown className="h-3.5 w-3.5 mr-1.5" /> Reject and learn
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
