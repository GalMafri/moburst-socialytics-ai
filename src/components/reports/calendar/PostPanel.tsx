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
import { Archive, Check, Download, Expand, Loader2, Settings2, Sparkles, Star, ThumbsDown } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useDesignRequestForPost, useDesignRequests } from "./DesignRequestsContext";
import { PostDesign } from "./PostDesign";
import { CalendarPostActions } from "@/components/calendar/CalendarPostActions";
import { createDesigns, designVersions, isDesignOption, isPreparing, putDesignInUse, sendDesignFeedback, uploadFilmedClip } from "@/lib/designRequests";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/useAuth";
import { PlatformBadge } from "@/lib/platform-config";
import { CopyEditor } from "./CopyEditor";
import { CreatePostDesignButton } from "@/components/reports/CreatePostDesignButton";
import { useGenerationForPost } from "@/components/reports/calendar/GenerationContext";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
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
  const designRequests = useDesignRequests();
  const preparingDesigns = isPreparing(designRequest, isMoburstStaff);
  const [startingDesigns, setStartingDesigns] = useState(false);
  const [usingId, setUsingId] = useState<string | null>(null);
  // Whether this client's design settings are confirmed decides who sees what:
  // staff get a way to confirm them, clients only ever see a ready feature.
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
  // Staff see when a client's social accounts are not connected: without them
  // there are no posts or videos of its own for designs to learn from.
  const { data: accountsConnected } = useQuery({
    queryKey: ["client-accounts-connected", clientId],
    enabled: !!clientId && open && isMoburstStaff,
    queryFn: async () => {
      const { count, error } = await supabase.from("sprout_profiles").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("is_active", true);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  const startDesigns = async () => {
    if (!clientId || !post) return;
    setStartingDesigns(true);
    try {
      const result = await createDesigns({ clientId, reportId, post });
      if (result.notSetUp) {
        toast.error("Design settings are not confirmed for this client yet.");
        return;
      }
      if (result.needsFilming) {
        designRequests?.refresh();
        return;
      }
      designRequests?.refresh();
    } catch (e) {
      toast.error("Could not start the designs", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setStartingDesigns(false);
    }
  };
  const [uploadingClip, setUploadingClip] = useState(false);
  const uploadClip = async (file: File) => {
    if (!clientId || !post) return;
    setUploadingClip(true);
    try {
      await uploadFilmedClip({ clientId, reportId, post, file });
      designRequests?.refresh();
      toast.success("Clip uploaded", { description: "The hook and your logo are being added." });
    } catch (e) {
      toast.error("Could not use the clip", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setUploadingClip(false);
    }
  };
  const applyDesign = async (iterationId: string) => {
    setUsingId(iterationId);
    try {
      await putDesignInUse(iterationId);
      refreshMedia();
      toast.success("In use for this post");
    } catch (e) {
      toast.error("Could not use this design", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setUsingId(null);
    }
  };
  const designFeedback = async (iterationId: string, verdict: "rejected" | "deleted", reason?: string, note?: string, makeNew?: boolean) => {
    try {
      const { request } = await sendDesignFeedback({ iterationId, verdict, reason, note, makeNew });
      refreshMedia();
      designRequests?.refresh();
      toast.success(verdict === "deleted" ? "Deleted" : request ? "Thanks. A new design is being made with your feedback." : "Thanks. The next designs will take it into account.");
    } catch (e) {
      toast.error(verdict === "deleted" ? "Could not delete it" : "Could not send that", { description: e instanceof Error ? e.message : "Try again." });
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
            <SheetTitle className="flex items-center gap-2 flex-wrap text-[18px] font-semibold tracking-[-0.5px]">
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
                <span className="text-sm font-normal text-muted-foreground tracking-[-0.5px]">
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
              {isMoburstStaff && accountsConnected === false && (
                <div className="glass-inner p-4 border border-[#f5b14c]/30">
                  <p className="t-body">This client's social accounts aren't connected in Sprout, so its designs and videos have none of its own posts to learn from yet. Connect them in Client setup.</p>
                </div>
              )}
              {plannedVideo && !designsReady && (
                <div className="glass-inner p-4 flex items-start justify-between gap-3 flex-wrap">
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
                    <p className="text-sm font-semibold">{videoDesigns ? "Video" : isCarouselPost ? "Carousel" : "Design"}</p>
                    {designRequest?.status !== "needs_filming" && (
                      <p className="t-secondary">{videoDesigns
                        ? "Made in the style of your brand's own videos, with sound. Text and logo appear the way your videos use them."
                        : "Made in your brand's style, with your logo and the post's words."}</p>
                    )}
                  </div>
                  <PostDesign
                    versions={versions}
                    preparing={preparingDesigns ? designRequest : null}
                    onCamera={designRequest?.status === "needs_filming" ? designRequest.on_camera || "it needs footage filmed for it" : null}
                    textOnly={isTextOnlyFormat(post.format)}
                    onUploadClip={uploadClip}
                    uploadingClip={uploadingClip}
                    isStaff={isMoburstStaff}
                    aspect={videoDesigns ? "aspect-[9/16]" : tileAspectFor(post) || "aspect-[4/5]"}
                    filenameStub={`design-${post.platform || "post"}`}
                    onCreate={startDesigns}
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
                      <p className="text-sm font-semibold">
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
                            : isMoburstStaff ? "Generate brand-aligned variants to get started." : "The design for this post will appear here."}
                      </p>
                    </div>
                    {!designSettingsLoading && isMoburstStaff && <CreatePostDesignButton
                      post={post}
                      clientContext={clientContext}
                      clientId={clientId}
                      onImagesGenerated={refreshMedia}
                    />}
                  </div>

                  {!designSettingsLoading && isMoburstStaff && clientId && (
                    <div className="glass-inner p-3 flex items-center justify-between gap-3 flex-wrap">
                      <p className="t-secondary min-w-0">Confirm this client's design settings once to offer designs here, for your team and the client.</p>
                      <Button asChild size="sm" variant="outline" className="shrink-0">
                        <Link to={`/clients/${clientId}/setup?tab=designs`}><Settings2 className="h-3.5 w-3.5 mr-1.5" />Design settings</Link>
                      </Button>
                    </div>
                  )}

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
                  <p className="text-sm font-semibold">
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
                <p className="t-secondary">
                  Schedule this post to your Sprout profile. Make sure design and copy are
                  finalized first.
                </p>
                {clientId ? (
                  <>
                    <Button onClick={() => setScheduleOpen(true)}>Open scheduler</Button>
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
  { value: "off_brand_colours", label: "Off-brand colours" },
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
              size="sm"
              className="h-8 px-2 text-sm"
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
              <Button variant="ghost" size="sm" className="h-9 px-2" title="Reject and teach the app why" aria-label="Reject this design" onClick={() => setRejecting(true)} disabled={busy}>
                <ThumbsDown className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-9 px-2" title="Archive without feedback" aria-label="Archive this design" onClick={() => setArchiveOpen(true)} disabled={busy}>
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <a
            href={tile.url}
            download={`${filenameStub}-${index + 1}.${isVideo ? "mp4" : "png"}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="ghost" size="sm" className="h-9 px-2">
              <Download className="h-3 w-3 mr-1" /> Download
            </Button>
          </a>
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
