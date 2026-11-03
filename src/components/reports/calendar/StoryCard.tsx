/**
 * A Story on the calendar board (Stories you can find, Lital 3 Nov 2026;
 * spec docs/superpowers/specs/2026-11-03-post-notes-stories-design.md): a
 * compact card under its post, with a narrow 9:16 thumbnail on the left (an
 * empty 9:16 outline before it has a design), "Instagram Story" and the
 * message beside it, and a thin rail to its post. A full-width 9:16 frame
 * would be the tallest card of the day. A Story made from New post, or one
 * whose post is on another day, has no rail. Its status never reaches
 * Scheduled: a Story is posted by hand (postStatus.ts).
 */

import { Loader2 } from "lucide-react";
import { platformName } from "@/lib/display";
import { postCopyOf } from "@/lib/postCopy";
import { isPreparing } from "@/lib/designRequests";
import { useAuth } from "@/hooks/useAuth";
import { PostStatusChip, type PostStatus } from "./PostStatusChip";
import { useDesignRequestForPost } from "./DesignRequestsContext";

interface Props {
  post: { platform?: string; format?: string; copy?: string; caption_angle?: string; posting_time?: string; _calendarPostKey?: string; _storyFollows?: boolean };
  iteration: { media_urls?: string[] | null } | null;
  status: PostStatus;
  onOpen: () => void;
  onToggleApproved?: () => void;
}

export function StoryCard({ post, iteration, status, onOpen, onToggleApproved }: Props) {
  const { isMoburstStaff } = useAuth();
  const copy = postCopyOf(post);
  const thumb = iteration?.media_urls?.[0] || null;
  const designing = isPreparing(useDesignRequestForPost(post), isMoburstStaff);
  const follows = !!post._storyFollows;
  const name = `${platformName(post.platform)} Story`;
  return (
    <div className={follows ? "relative pl-5" : undefined} data-story-card>
      {/* The rail from the post above to this Story. */}
      {follows && <span aria-hidden data-story-rail className="absolute left-2 -top-3 bottom-1/2 w-3 border-l border-b border-white/15 rounded-bl-[6px]" />}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name}: ${copy.slice(0, 60)}`}
        className="glass-inner hover-lift w-full text-left p-2.5 flex items-start gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative w-12 shrink-0 aspect-[9/16] rounded-[6px] overflow-hidden">
          {thumb ? (
            <img src={thumb} alt="" className="w-full h-full object-cover bg-black" />
          ) : (
            <div className="w-full h-full border border-dashed border-white/15 group-hover:border-primary/40 transition-colors" />
          )}
          {designing && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b9e045]" aria-hidden />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="t-label font-semibold !text-white">{name}</p>
            {post.posting_time && <span className="t-label ml-auto">{post.posting_time}</span>}
          </div>
          <p className="t-secondary line-clamp-2 print:line-clamp-none">{copy || "No message yet."}</p>
          <PostStatusChip status={status} onToggleApproved={onToggleApproved} />
        </div>
      </button>
    </div>
  );
}
