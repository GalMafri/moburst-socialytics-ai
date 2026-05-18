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
import { Download, Expand, Sparkles } from "lucide-react";
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
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any | null;
  iteration: Iteration | null;
  clientContext?: ClientContext;
  clientId?: string;
  reportId?: string;
  clientTimezone?: string;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)/i.test(url);
}

export function PostPanel({
  open,
  onOpenChange,
  post,
  iteration,
  clientContext,
  clientId,
  reportId,
  clientTimezone,
}: Props) {
  const { isClient } = useAuth();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  if (!post) return null;

  const mediaUrls = iteration?.media_urls || [];
  const imageUrls = mediaUrls.filter((u) => !isVideoUrl(u));
  const videoUrls = mediaUrls.filter((u) => isVideoUrl(u));

  const openPreview = (url: string, video: boolean) => {
    setPreviewUrl(url);
    setPreviewIsVideo(video);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto print:hidden bg-background border-l border-white/10"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 flex-wrap text-base">
              {post.platform && <PlatformBadge platform={post.platform} size="sm" />}
              {post.format && <Badge variant="outline">{post.format}</Badge>}
              {post.posting_time && (
                <span className="text-xs text-muted-foreground">{post.posting_time}</span>
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
              {/* Primary action — generate */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {imageUrls.length > 0
                      ? `${imageUrls.length} design${imageUrls.length === 1 ? "" : "s"}`
                      : "No designs yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {imageUrls.length > 0
                      ? "Click any design to preview at full size."
                      : "Generate brand-aligned variants to get started."}
                  </p>
                </div>
                <CreatePostDesignButton
                  post={post}
                  clientContext={clientContext}
                  clientId={clientId}
                />
              </div>

              {imageUrls.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {imageUrls.map((url, i) => (
                    <div
                      key={i}
                      className="glass-elevated rounded-lg overflow-hidden border border-white/5"
                    >
                      <button
                        type="button"
                        onClick={() => openPreview(url, false)}
                        className="block w-full aspect-square bg-black relative group"
                      >
                        <img src={url} alt={`Design ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <Expand className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </button>
                      <div className="flex items-center justify-between px-2 py-1.5 bg-[rgba(0,0,0,0.4)]">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          #{i + 1}
                        </span>
                        <a
                          href={url}
                          download={`design-${post.platform || "post"}-${i + 1}.png`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <Download className="h-3 w-3 mr-1" /> Download
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass-elevated rounded-lg border border-dashed border-white/10 p-8 text-center space-y-2">
                  <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">
                    No designs generated for this post yet.
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Use the "Design" button above to generate 2–6 brand-aligned variants and pick your
                    favorite.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Video tab */}
            <TabsContent value="video" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {videoUrls.length > 0
                      ? `${videoUrls.length} video${videoUrls.length === 1 ? "" : "s"}`
                      : "No videos yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {videoUrls.length > 0
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

              {videoUrls.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videoUrls.map((url, i) => (
                    <div
                      key={i}
                      className="glass-elevated rounded-lg overflow-hidden border border-white/5"
                    >
                      <button
                        type="button"
                        onClick={() => openPreview(url, true)}
                        className="block w-full aspect-[9/16] bg-black relative group"
                      >
                        <video
                          src={url}
                          className="w-full h-full object-cover"
                          muted
                          loop
                          preload="metadata"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <Expand className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </button>
                      <div className="flex items-center justify-between px-2 py-1.5 bg-[rgba(0,0,0,0.4)]">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          #{i + 1}
                        </span>
                        <a
                          href={url}
                          download={`video-${post.platform || "post"}-${i + 1}.mp4`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <Download className="h-3 w-3 mr-1" /> Download
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass-elevated rounded-lg border border-dashed border-white/10 p-8 text-center space-y-2">
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
                  Schedule this post to your Sprout profile. Make sure design and copy are finalized
                  first.
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
                      generatedMediaUrls={mediaUrls}
                      clientTimezone={clientTimezone}
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
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
        <DialogContent className="max-w-4xl bg-black/95 border-white/10 p-0 overflow-hidden">
          {previewUrl && previewIsVideo && (
            <video
              src={previewUrl}
              className="w-full h-auto max-h-[85vh]"
              controls
              autoPlay
              loop
            />
          )}
          {previewUrl && !previewIsVideo && (
            <img
              src={previewUrl}
              alt="Full-size preview"
              className="w-full h-auto max-h-[85vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
