import { useEffect, useRef, useState } from "react";
import { formatLabel, isStoryPost, isTextOnlyFormat } from "@/lib/platform";
import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/lib/platform-config";
import { Clock, ImagePlus, Loader2 } from "lucide-react";
import { PostStatusChip } from "./PostStatusChip";
import type { PostStatus } from "./postStatus";
import type { SendState } from "@/components/reports/SchedulePostModal";
import { postCopyOf } from "@/lib/postCopy";
import { useAuth } from "@/hooks/useAuth";
import { useDesignRequestForPost, useWeekStateForPost } from "./DesignRequestsContext";
import { isPreparing, stageLine } from "@/lib/designRequests";
import { StoryCard } from "./StoryCard";

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
    /** The key of the Story made from this post, when it has one (calendarPosts.ts weekBoard). */
    _storyKey?: string;
    /** A Story placed right after its post. */
    _storyFollows?: boolean;
  };
  iteration: Iteration | null;
  status: PostStatus;
  /** For a sent post: where its send stands (sendStateOf on the row that holds it). */
  sendState?: SendState;
  onOpen: () => void;
  onToggleApproved?: () => void;
}

/** Why a calendar post is in the plan: a short tag, and the reason itself under it. */
const REASON_LABELS: Record<string, string> = {
  report: "From report",
  performance: "Performance",
  trend: "Trend",
  competitor: "Competitor",
  seasonal: "Seasonal",
  test: "Test",
  idea: "Idea",
};

/** A calendar card: a Story's compact card (StoryCard), or a feed post's. */
export function PostCard(props: Props) {
  return isStoryPost(props.post) ? <StoryCard {...props} /> : <FeedPostCard {...props} />;
}

function FeedPostCard({ post, iteration, status, sendState, onOpen, onToggleApproved }: Props) {
  const copy = postCopyOf(post);
  const reasons = Array.isArray((post as { _reasons?: unknown })._reasons) ? ((post as { _reasons: Array<{ type: string; label: string }> })._reasons) : [];
  const thumb = iteration?.media_urls?.[0] || null;
  const isVideo = !!thumb && /\.(mp4|webm|mov)/.test(thumb);

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
  const designing = isPreparing(designRequest, isMoburstStaff);
  // Waiting its turn in a week being designed (the week's design button).
  const weekState = useWeekStateForPost(post as { _calendarPostKey?: string });

  // The card is a container with one button that covers it and opens the post.
  // The status chip is a button of its own beside it, lifted above the cover, so
  // no button sits inside another.
  return (
    <div className="glass-inner hover-lift w-full text-left p-inner group relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open post: ${copy.slice(0, 60) || post.platform}`}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      {/* What the card shows lies over the button and lets clicks through; only a chip that is a button takes them
          (PostStatusChip). The reason pills keep their title for screen readers; their hover tooltip goes, since a
          pill that took the hover would also take the click that opens the post. */}
      <div className="relative pointer-events-none flex flex-col space-y-3">
      {/* Thumbnail / empty state / generating overlay — 16:10. */}
      <div className={`relative w-full rounded-[8px] overflow-hidden ${thumb ? "aspect-[16/10]" : "h-16"}`}>
        {thumb ? (
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
              ) : weekState && !designing ? (
                <>
                  <Clock className="h-4 w-4" />
                  <span className="t-label">{weekState === "copy" ? "Designed once its copy is written" : "Queued for design"}</span>
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4" />
                  <span className="t-label">No design yet</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* A design being prepared on the server. When the post already has
            one (a regeneration), it stays visible with a corner pill. */}
        {designing && designRequest && !thumb && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center gap-2 text-white">
            <Loader2 className="h-4 w-4 animate-spin text-[#b9e045]" />
            <span className="t-h4">{designRequest.kind === "carousel" ? "Preparing carousel" : "Preparing design"}</span>
          </div>
        )}
        {designing && designRequest && thumb && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 text-white t-badge">
            <Loader2 className="h-3 w-3 animate-spin text-[#b9e045]" aria-hidden />
            New version
          </span>
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
            {formatLabel(post.format, post.platform)}
          </Badge>
        )}
        {/* The post has a Story; the card opens the post, whose header opens the Story. */}
        {post._storyKey && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-white/15 t-badge text-white">Story</span>
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

      {/* The reason in words; a "From report" tag already says all its generic label does. */}
      {reasons[0]?.label && reasons[0].type !== "idea" && reasons[0].type !== "report" && (
        <p className="t-secondary line-clamp-2 print:line-clamp-none">{reasons[0].label}</p>
      )}

      {!copy && <p className="t-secondary flex-1">No copy yet.</p>}

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
        <div className="inline-flex">
        {designing && designRequest ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(185,224,69,0.10)] text-[#b9e045] t-badge tracking-[-0.2px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {stageLine(designRequest, isMoburstStaff)}
          </span>
        ) : (
          <PostStatusChip status={status} sendState={sendState} onToggleApproved={onToggleApproved} />
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
