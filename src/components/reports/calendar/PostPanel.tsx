import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
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
  if (!post) return null;

  const mediaUrls = iteration?.media_urls || [];
  const imageUrls = mediaUrls.filter((u) => !isVideoUrl(u));
  const videoUrls = mediaUrls.filter((u) => isVideoUrl(u));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
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
          <TabsContent value="design" className="mt-4 space-y-3">
            {imageUrls.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Current designs ({imageUrls.length})
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {imageUrls.map((url, i) => (
                    <div key={i} className="relative group aspect-square rounded-md overflow-hidden border">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <a
                        href={url}
                        download={`design-${post.platform || "post"}-${i + 1}.png`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 opacity-0 group-hover:opacity-100 transition"
                      >
                        <Button variant="secondary" size="sm" className="h-7 px-2 text-xs">
                          <Download className="h-3 w-3" />
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No designs yet — generate variants to get started.</p>
            )}
            <CreatePostDesignButton
              post={post}
              clientContext={clientContext}
              clientId={clientId}
            />
          </TabsContent>

          {/* Video tab */}
          <TabsContent value="video" className="mt-4 space-y-3">
            {videoUrls.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Current videos ({videoUrls.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {videoUrls.map((url, i) => (
                    <div key={i} className="relative group aspect-[9/16] rounded-md overflow-hidden border bg-black">
                      <video src={url} className="w-full h-full object-cover" muted loop preload="metadata" />
                      <a
                        href={url}
                        download={`video-${post.platform || "post"}-${i + 1}.mp4`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 opacity-0 group-hover:opacity-100 transition"
                      >
                        <Button variant="secondary" size="sm" className="h-7 px-2 text-xs">
                          <Download className="h-3 w-3" />
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No videos yet — generate variants to get started.</p>
            )}
            <CreatePostVideoButton
              post={post}
              clientContext={clientContext}
              clientId={clientId}
            />
          </TabsContent>

          {/* Schedule tab — hidden for clients */}
          {!isClient && (
            <TabsContent value="schedule" className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Schedule this post to your Sprout profile. Make sure design/copy are finalized first.
              </p>
              {clientId && reportId ? (
                <>
                  <Button onClick={() => setScheduleOpen(true)}>
                    Open scheduler
                  </Button>
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
  );
}
