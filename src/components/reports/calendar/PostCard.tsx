import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/lib/platform-config";
import { Clock, ImagePlus } from "lucide-react";
import { PostStatusChip, type PostStatus } from "./PostStatusChip";

interface Iteration {
  id?: string;
  media_urls?: string[] | null;
  is_selected?: boolean | null;
  is_approved?: boolean | null;
  video_edits?: any;
}

interface Props {
  post: {
    platform?: string;
    format?: string;
    language?: string;
    posting_time?: string;
    copy?: string;
    caption_angle?: string;
    pillar?: string;
  };
  iteration: Iteration | null;
  status: PostStatus;
  onOpen: () => void;
  onToggleApproved?: () => void;
}

export function PostCard({ post, iteration, status, onOpen, onToggleApproved }: Props) {
  const copy = post.copy || post.caption_angle || "";
  const thumb = iteration?.media_urls?.[0] || null;
  const isVideo = !!thumb && /\.(mp4|webm|mov)/.test(thumb);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open post: ${copy.slice(0, 60) || post.platform}`}
      className="glass-elevated hover-lift w-full text-left p-5 space-y-4 group flex flex-col !rounded-[20px]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Thumbnail / empty state — 16:10 keeps cards from going too tall. */}
      {thumb ? (
        <div className="relative w-full aspect-[16/10] bg-black rounded-[10px] overflow-hidden">
          {isVideo ? (
            <video src={thumb} className="w-full h-full object-cover" muted preload="metadata" />
          ) : (
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          )}
        </div>
      ) : (
        <div className="w-full aspect-[16/10] rounded-[10px] flex items-center justify-center bg-[rgba(255,255,255,0.04)] border border-dashed border-white/10 group-hover:border-primary/40 transition-colors">
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <ImagePlus className="h-5 w-5" />
            <span className="text-sm tracking-[-0.5px]">No design yet</span>
          </div>
        </div>
      )}

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {post.platform && <PlatformBadge platform={post.platform} size="sm" />}
        {post.format && (
          <Badge
            variant="outline"
            className="text-xs font-bold tracking-[-0.2px] py-0.5 px-2 border-white/15 rounded-full"
          >
            {post.format}
          </Badge>
        )}
        {post.language && (
          <Badge
            variant="secondary"
            className="text-xs font-bold tracking-[-0.2px] py-0.5 px-2 uppercase rounded-full"
          >
            {post.language}
          </Badge>
        )}
        {post.posting_time && (
          <span className="text-xs text-muted-foreground tracking-[-0.5px] flex items-center gap-1 ml-auto">
            <Clock className="h-3.5 w-3.5" /> {post.posting_time}
          </span>
        )}
      </div>

      {/* Pillar */}
      {post.pillar && (
        <div>
          <Badge className="bg-accent text-accent-foreground text-xs font-bold tracking-[-0.2px] py-1 px-2.5 rounded-full">
            {post.pillar}
          </Badge>
        </div>
      )}

      {/* Copy — Intercept body: 14px Regular tracking-[-0.5px] (bumped to 15px for readability) */}
      {copy && (
        <p className="text-[15px] leading-relaxed tracking-[-0.5px] line-clamp-3 print:line-clamp-none text-foreground flex-1">
          {copy}
        </p>
      )}

      {/* Status */}
      <div className="pt-3 border-t border-white/[0.06]">
        <PostStatusChip status={status} onToggleApproved={onToggleApproved} />
      </div>
    </button>
  );
}
