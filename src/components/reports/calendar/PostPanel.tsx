import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Archive, Check, Download, Expand, Sparkles, Star, ThumbsDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/useAuth";
import { PlatformBadge } from "@/lib/platform-config";
import { CopyEditor } from "./CopyEditor";
import { CreatePostDesignButton } from "@/components/reports/CreatePostDesignButton";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
import type { ClientContext } from "@/lib/clientContext";
import { isVideoFormat } from "@/lib/platform";
import { useState } from "react";

interface Iteration {
  id?: string;
  media_urls?: string[] | null;
  is_selected?: boolean | null;
  variant_group_id?: string | null;
  created_at?: string | null;
}

interface MediaTile {
  iterationId?: string;
  url: string;
  isSelected: boolean;
}

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
  /** Toggle is_selected on a variant. */
  onToggleSelected?: (iterationId: string, nextSelected: boolean) => void;
  /** Reject (with a reason the app learns from) or archive a variant. Staff only. */
  onFeedback?: (iterationId: string, verdict: "rejected" | "archived", reason?: string, note?: string) => Promise<void> | void;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)/i.test(url);
}

/**
 * Resolve which variant group to display: most recent one with media. Return
 * one tile per (iteration row × url) pair so multi-url rows (carousels) all
 * surface. Falls back gracefully if no group is present.
 */
function tilesFromIterations(
  iterations: Iteration[],
  filter: (url: string) => boolean,
): MediaTile[] {
  if (!iterations || iterations.length === 0) return [];

  // Bucket by variant_group_id (or per-row when no group).
  const byGroup = new Map<string, Iteration[]>();
  for (const it of iterations) {
    const key = it.variant_group_id || `solo:${it.id}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(it);
  }

  // Find the group whose latest member is the most recent overall.
  let bestGroup: Iteration[] | null = null;
  let bestTs = "";
  for (const group of byGroup.values()) {
    const ts = group
      .map((it) => it.created_at || "")
      .sort()
      .reverse()[0];
    if (ts > bestTs) {
      bestTs = ts;
      bestGroup = group;
    }
  }
  if (!bestGroup) return [];

  // Stable order: created_at asc so variant #1 lands first, then variant #2, etc.
  const ordered = [...bestGroup].sort((a, b) =>
    (a.created_at || "").localeCompare(b.created_at || ""),
  );

  const tiles: MediaTile[] = [];
  for (const it of ordered) {
    for (const url of it.media_urls || []) {
      if (!filter(url)) continue;
      tiles.push({
        iterationId: it.id,
        url,
        isSelected: !!it.is_selected,
      });
    }
  }
  return tiles;
}

export function PostPanel({
  open,
  onOpenChange,
  post,
  postIterations,
  clientContext,
  clientId,
  reportId,
  clientTimezone,
  onToggleSelected,
  onFeedback,
}: Props) {
  const { isClient } = useAuth();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  // A post planned as a Reel opens on the tab that makes one. The Design tab
  // only ever produced stills, so clicking it on a video recommendation handed
  // back the wrong asset with nothing to say so.
  const plannedVideo = isVideoFormat(post?.format, post?.platform);
  const [tab, setTab] = useState<string>("copy");
  if (!post) return null;

  const imageTiles = tilesFromIterations(postIterations, (u) => !isVideoUrl(u));
  const videoTiles = tilesFromIterations(postIterations, isVideoUrl);

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
            </SheetTitle>
          </SheetHeader>

          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList className={`grid ${isClient ? "grid-cols-3" : "grid-cols-4"}`}>
              <TabsTrigger value="copy">Copy</TabsTrigger>
              <TabsTrigger value="design">{plannedVideo ? "Cover" : "Design"}</TabsTrigger>
              <TabsTrigger value="video" className="gap-1.5">
                Video
                {plannedVideo && <span className="h-1.5 w-1.5 rounded-full bg-[#b9e045]" aria-hidden />}
              </TabsTrigger>
              {!isClient && <TabsTrigger value="schedule">Schedule</TabsTrigger>}
            </TabsList>

            {/* Copy tab */}
            <TabsContent value="copy" className="mt-4">
              <CopyEditor post={post} clientId={clientId} reportId={reportId} />
            </TabsContent>

            {/* Design tab */}
            <TabsContent value="design" className="mt-4 space-y-4">
              {plannedVideo && (
                <div className="glass-inner p-4 flex items-start justify-between gap-3 flex-wrap">
                  <p className="t-body min-w-0">
                    This post is planned as a <span className="font-semibold text-white">{post.format}</span>. Designs here are stills, useful as a cover frame; the clip itself is generated on the Video tab.
                  </p>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setTab("video")}>
                    Go to Video
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {imageTiles.length > 0
                      ? `${imageTiles.length} design${imageTiles.length === 1 ? "" : "s"}`
                      : "No designs yet"}
                  </p>
                  <p className="t-secondary">
                    {imageTiles.length > 0
                      ? "Click any design to preview at full size. Star your favorites."
                      : "Generate brand-aligned variants to get started."}
                  </p>
                </div>
                <CreatePostDesignButton
                  post={post}
                  clientContext={clientContext}
                  clientId={clientId}
                />
              </div>

              {imageTiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {imageTiles.map((tile, i) => (
                    <MediaTileCard
                      key={tile.iterationId || i}
                      tile={tile}
                      index={i}
                      isVideo={false}
                      filenameStub={`design-${post.platform || "post"}`}
                      onPreview={() => openPreview(tile.url, false)}
                      onToggleSelected={onToggleSelected}
                      onFeedback={isClient ? undefined : onFeedback}
                    />
                  ))}
                </div>
              ) : (
                <div className="glass-inner border-dashed border-white/10 p-8 text-center space-y-2">
                  <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
                  <p className="t-secondary">
                    No designs generated for this post yet.
                  </p>
                  <p className="t-secondary/70">
                    Click "Design" above to generate 2–6 brand-aligned variants.
                  </p>
                </div>
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
                      : "Generate 2–3 video variants — takes ~30–120s each."}
                  </p>
                </div>
                <CreatePostVideoButton
                  post={post}
                  clientContext={clientContext}
                  clientId={clientId}
                />
              </div>

              {videoTiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videoTiles.map((tile, i) => (
                    <MediaTileCard
                      key={tile.iterationId || i}
                      tile={tile}
                      index={i}
                      isVideo={true}
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
                {clientId && reportId ? (
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
                    Cannot schedule — missing client or report context.
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
  filenameStub: string;
  onPreview: () => void;
  onToggleSelected?: (iterationId: string, nextSelected: boolean) => void;
  onFeedback?: (iterationId: string, verdict: "rejected" | "archived", reason?: string, note?: string) => Promise<void> | void;
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
  filenameStub,
  onPreview,
  onToggleSelected,
  onFeedback,
}: TileCardProps) {
  const canToggle = !!tile.iterationId && !!onToggleSelected;
  const canReview = !!tile.iterationId && !!onFeedback;
  const [rejecting, setRejecting] = useState(false);
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
        className={`block w-full bg-black relative group ${isVideo ? "aspect-[9/16]" : "aspect-square"}`}
      >
        {isVideo ? (
          <video src={tile.url} className="w-full h-full object-cover" muted loop preload="metadata" />
        ) : (
          <img src={tile.url} alt={`Variant ${index + 1}`} className="w-full h-full object-cover" />
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
              <Button variant="ghost" size="sm" className="h-9 px-2" title="Archive without feedback" aria-label="Archive this design" onClick={() => submit("archived")} disabled={busy}>
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
          {/* The reason is what turns a rejection into a rule for the next design. */}
          <Dialog open={rejecting} onOpenChange={setRejecting}>
            <DialogContent className="max-w-md">
              <div className="space-y-4">
                <div>
                  <h2 className="t-h3">Why is this one wrong?</h2>
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
                  <Textarea id={`note-${tile.iterationId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. the red button — this brand never uses red" className="t-body" />
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
