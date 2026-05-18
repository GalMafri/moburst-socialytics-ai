import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/lib/platform-config";
import { Clock, MoreVertical, Plus } from "lucide-react";
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
      className="w-full text-left border rounded-lg p-3 bg-[rgba(255,255,255,0.02)] hover:border-primary/40 transition-colors space-y-2"
    >
      {/* Top row: badges + posting time */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {post.platform && <PlatformBadge platform={post.platform} size="sm" />}
        {post.format && <Badge variant="outline" className="text-[10px] py-0">{post.format}</Badge>}
        {post.language && (
          <Badge variant="secondary" className="text-[10px] py-0 uppercase">
            {post.language}
          </Badge>
        )}
        {post.pillar && (
          <Badge className="bg-accent text-accent-foreground text-[10px] py-0">{post.pillar}</Badge>
        )}
        {post.posting_time && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3" /> {post.posting_time}
          </span>
        )}
      </div>

      {/* Truncated copy */}
      <p className="text-xs leading-relaxed line-clamp-2 print:line-clamp-none">{copy}</p>

      {/* Thumbnail or placeholder */}
      {thumb ? (
        <div className="relative w-full aspect-square bg-black rounded overflow-hidden">
          {isVideo ? (
            <video src={thumb} className="w-full h-full object-cover" muted preload="metadata" />
          ) : (
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          )}
        </div>
      ) : (
        <div className="w-full aspect-square border-2 border-dashed rounded flex items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-1">
            <Plus className="h-5 w-5" />
            <span className="text-[10px]">Design</span>
          </div>
        </div>
      )}

      {/* Status + overflow */}
      <div className="flex items-center justify-between">
        <PostStatusChip status={status} onToggleApproved={onToggleApproved} />
        {/* Overflow menu placeholder — real menu wired in Phase 8C if needed */}
        <span
          className="text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
