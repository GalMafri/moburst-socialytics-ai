import { useEffect, useRef, useState } from "react";
import { isTextOnlyFormat } from "@/lib/platform";
import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/lib/platform-config";
import { Clock, ImagePlus, Loader2, Sparkles, Video as VideoIcon } from "lucide-react";
import { PostStatusChip, type PostStatus } from "./PostStatusChip";
import { useGenerationForPost } from "./GenerationContext";
import { postCopyOf } from "@/lib/postCopy";
import { useAuth } from "@/hooks/useAuth";
import { useDesignRequestForPost } from "./DesignRequestsContext";
import { isPreparing, stageLine } from "@/lib/designRequests";
import { isOpenTrendSlot } from "@/lib/calendarPosts";

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

/** Why a calendar post is in the plan, as short tags; the full reason is the tag's tooltip. */
const REASON_LABELS: Record<string, string> = {
  report: "From report",
  performance: "Performance",
  trend: "Trend",
  competitor: "Competitor",
  seasonal: "Seasonal",
  idea: "Idea",
};

export function PostCard({ post, iteration, status, onOpen, onToggleApproved }: Props) {
  const copy = postCopyOf(post);
  const reasons = Array.isArray((post as { _reasons?: unknown })._reasons) ? ((post as { _reasons: Array<{ type: string; label: string }> })._reasons) : [];
  const thumb = iteration?.media_urls?.[0] || null;
  const isVideo = !!thumb && /\.(mp4|webm|mov)/.test(thumb);

  // Active generation for this post — drives the in-card loading overlay and
  // the generating badge. Survives modal close because it lives in context.
  const activeGen = useGenerationForPost(post);

  // The grid keeps captions to three lines. Folded AI copy has to say so, or a
  // reader takes the card at face value and never opens the full post; the cue
  // only appears when the text is actually cut, and print shows it all anyway.
  const copyRef = useRef<HTMLParagraphElement>(null);
  const [copyClamped, setCopyClamped] = useState(false);
  useEffect(() => {
    const el = copyRef.current;
    if (!el) return;
    const check = () => setCopyClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [copy]);

  const { isMoburstStaff } = useAuth();
  const designRequest = useDesignRequestForPost(post as { _calendarPostKey?: string });
  const designing = isPreparing(designRequest, isMoburstStaff) && !activeGen;
  const isGenerating = activeGen?.status === "running";
  const genJustCompleted =
    activeGen?.status === "completed" &&
    activeGen?.completedAt &&
    Date.now() - activeGen.completedAt < 30_000;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open post: ${copy.slice(0, 60) || post.platform}`}
      className="glass-inner hover-lift w-full text-left p-5 space-y-4 group flex flex-col !rounded-[20px] relative
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Thumbnail / empty state / generating overlay — 16:10. */}
      <div className={`relative w-full rounded-[10px] overflow-hidden ${thumb && !isGenerating ? "aspect-[16/10]" : "h-16"}`}>
        {thumb && !isGenerating ? (
          <div className="w-full h-full bg-black">
            {/* The whole design, fitted inside the card (smaller when its shape differs), never cropped. */}
            {isVideo ? (
              <video src={thumb} className="w-full h-full object-contain" muted preload="metadata" />
            ) : (
              <img src={thumb} alt="" className="w-full h-full object-contain" />
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[rgba(255,255,255,0.04)] border border-dashed border-white/10 group-hover:border-primary/40 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground">
              {isTextOnlyFormat(post.format) ? (
                <span className="t-label">Text post</span>
              ) : designRequest?.status === "needs_filming" ? (
                <span className="t-label">Filmed video</span>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4" />
                  <span className="t-label">No design yet</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Active generation overlay — appears regardless of thumbnail state */}
        {isGenerating && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="h-6 w-6 animate-spin text-[#b9e045]" />
            <span className="text-sm font-semibold tracking-[-0.2px]">
              {activeGen.type === "design" ? "Generating designs" : "Generating videos"}
            </span>
            <span className="t-label tracking-[-0.2px]">
              {activeGen.completed}/{activeGen.total} complete
            </span>
          </div>
        )}

        {/* A design being prepared on the server. When the post already has
            one (a regeneration), it stays visible with a corner pill. */}
        {designing && designRequest && !thumb && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center gap-2 text-white">
            <Loader2 className="h-4 w-4 animate-spin text-[#b9e045]" />
            <span className="text-sm font-semibold tracking-[-0.2px]">{designRequest.kind === "carousel" ? "Preparing carousel" : "Preparing design"}</span>
          </div>
        )}
        {designing && designRequest && thumb && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 text-white t-badge">
            <Loader2 className="h-3 w-3 animate-spin text-[#b9e045]" aria-hidden />
            New version
          </span>
        )}

        {/* Just-completed pulse — quick visual cue */}
        {genJustCompleted && (
          <div className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#10b981] text-white t-badge tracking-[-0.2px] animate-pulse">
            {activeGen.type === "design" ? (
              <Sparkles className="h-3 w-3" />
            ) : (
              <VideoIcon className="h-3 w-3" />
            )}
            Ready
          </div>
        )}
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {post.platform && <PlatformBadge platform={post.platform} size="sm" />}
        {post.format && (
          <Badge
            variant="outline"
            className="t-badge tracking-[-0.2px] py-0.5 px-2 border-white/15 rounded-full"
          >
            {post.format}
          </Badge>
        )}
        {post.language && (
          <Badge
            variant="secondary"
            className="t-badge tracking-[-0.2px] py-0.5 px-2 uppercase rounded-full"
          >
            {post.language}
          </Badge>
        )}
        {post.posting_time && (
          <span className="t-secondary tracking-[-0.5px] flex items-center gap-1 ml-auto">
            <Clock className="h-3.5 w-3.5" /> {post.posting_time}
          </span>
        )}
      </div>

      {/* Pillar, and why the post is in the plan */}
      {(post.pillar || reasons.length > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {post.pillar && (
            <Badge className="bg-accent text-accent-foreground t-badge tracking-[-0.2px] py-1 px-2.5 rounded-full">
              {post.pillar}
            </Badge>
          )}
          {reasons.map((r, i) => (
            <span key={`${r.type}:${i}`} title={r.label} className="inline-flex items-center px-2 py-0.5 rounded-full border border-white/10 t-badge text-[#b1b7c1]">
              {REASON_LABELS[r.type] ?? "Idea"}
            </span>
          ))}
        </div>
      )}

      {isOpenTrendSlot(post as never) && (
        <p className="t-secondary flex-1">Trend post. Written shortly before its date from what's trending then.</p>
      )}

      {/* Copy */}
      {copy && (
        <div className="space-y-1 flex-1">
          <p ref={copyRef} className="t-body leading-relaxed tracking-[-0.5px] line-clamp-3 print:line-clamp-none text-foreground">
            {copy}
          </p>
          {copyClamped && (
            <span className="t-label !text-[#b9e045] print:hidden">Open to read the full copy</span>
          )}
        </div>
      )}

      {/* Status (or in-flight pill) */}
      <div className="pt-3 border-t border-white/[0.06]">
        {isGenerating ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(185,224,69,0.10)] text-[#b9e045] t-badge tracking-[-0.2px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating {activeGen.completed}/{activeGen.total}
          </span>
        ) : designing && designRequest ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(185,224,69,0.10)] text-[#b9e045] t-badge tracking-[-0.2px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {stageLine(designRequest, isMoburstStaff)}
          </span>
        ) : (
          <PostStatusChip status={status} onToggleApproved={onToggleApproved} />
        )}
      </div>
    </button>
  );
}
