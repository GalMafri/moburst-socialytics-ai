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
import { Check, Download, Expand, Sparkles, Star } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PlatformBadge } from "@/lib/platform-config";
import { CopyEditor } from "./CopyEditor";
import { CreatePostDesignButton } from "@/components/reports/CreatePostDesignButton";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
import type { ClientContext } from "@/lib/clientContext";
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
}: Props) {
  const { isClient } = useAuth();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
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
                  className="text-xs font-bold tracking-[-0.2px] py-0.5 px-2 rounded-full border-white/15"
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

          <Tabs defaultValue="copy" className="mt-4">
            <TabsList className={`grid ${isClient ? "grid-cols-3" : "grid-cols-4"}`}>
              <TabsTrigger value="copy">Copy</TabsTrigger>
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="video">Video</TabsTrigger>
              {!isClient && <TabsTrigger value="schedule">Schedule</TabsTrigger>}
            </TabsList>

            {/* Copy tab */}
            <TabsContent value="copy" className="mt-4">
              <CopyEditor post={post} clientId={clientId} reportId={reportId} />
            </TabsContent>

            {/* Design tab */}
            <TabsContent value="design" className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {imageTiles.length > 0
                      ? `${imageTiles.length} design${imageTiles.length === 1 ? "" : "s"}`
                      : "No designs yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
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
                    />
                  ))}
                </div>
              ) : (
                <div className="glass-inner border-dashed border-white/10 p-8 text-center space-y-2">
                  <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">
                    No designs generated for this post yet.
                  </p>
                  <p className="text-sm text-muted-foreground/70">
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
                  <p className="text-sm text-muted-foreground">
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
                    />
                  ))}
                </div>
              ) : (
                <div className="glass-inner border-dashed border-white/10 p-8 text-center space-y-2">
                  <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">
                    No videos generated for this post yet.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Schedule tab — hidden for clients */}
            {!isClient && (
              <TabsContent value="schedule" className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
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
                  <p className="text-sm text-muted-foreground">
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
}

function MediaTileCard({
  tile,
  index,
  isVideo,
  filenameStub,
  onPreview,
  onToggleSelected,
}: TileCardProps) {
  const canToggle = !!tile.iterationId && !!onToggleSelected;
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
        <span className="text-xs text-muted-foreground uppercase tracking-wide">
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
          <a
            href={tile.url}
            download={`${filenameStub}-${index + 1}.${isVideo ? "mp4" : "png"}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="ghost" size="sm" className="h-8 px-2 text-sm">
              <Download className="h-3 w-3 mr-1" /> Download
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
