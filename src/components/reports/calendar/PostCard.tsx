import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/lib/platform-config";
import { Clock, ImagePlus, MoreVertical } from "lucide-react";
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
      className="glass-elevated w-full text-left rounded-lg p-3 hover:border-primary/50 transition-colors space-y-2.5 group"
    >
      {/* Thumbnail or compact placeholder — show first so it dominates visually */}
      {thumb ? (
        <div className="relative w-full aspect-square bg-black rounded overflow-hidden">
          {isVideo ? (
            <video src={thumb} className="w-full h-full object-cover" muted preload="metadata" />
          ) : (
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          )}
        </div>
      ) : (
        <div className="w-full aspect-square rounded flex items-center justify-center bg-[rgba(255,255,255,0.04)] border border-dashed border-white/10 group-hover:border-primary/40 transition-colors">
          <div className="flex flex-col items-center gap-1 text-muted-foreground/70">
            <ImagePlus className="h-5 w-5" />
            <span className="text-[10px] uppercase tracking-wide">No design yet</span>
          </div>
        </div>
      )}

      {/* Badges row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {post.platform && <PlatformBadge platform={post.platform} size="sm" />}
        {post.format && <Badge variant="outline" className="text-[10px] py-0 border-white/15">{post.format}</Badge>}
        {post.language && (
          <Badge variant="secondary" className="text-[10px] py-0 uppercase">
            {post.language}
          </Badge>
        )}
        {post.posting_time && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3" /> {post.posting_time}
          </span>
        )}
      </div>

      {/* Pillar (separate row so it doesn't crowd) */}
      {post.pillar && (
        <div>
          <Badge className="bg-accent text-accent-foreground text-[10px] py-0">{post.pillar}</Badge>
        </div>
      )}

      {/* Copy — bumped to text-sm with better contrast */}
      {copy && (
        <p className="text-sm leading-snug line-clamp-3 print:line-clamp-none text-foreground/90">
          {copy}
        </p>
      )}

      {/* Status + overflow */}
      <div className="flex items-center justify-between pt-1">
        <PostStatusChip status={status} onToggleApproved={onToggleApproved} />
        <span
          className="text-muted-foreground/60 hover:text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
