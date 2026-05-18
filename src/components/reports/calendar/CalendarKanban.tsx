import { PostCard } from "./PostCard";
import { resolvePostStatus } from "./postStatus";
import type { PostStatus } from "./PostStatusChip";
import type { CalendarFilterState } from "./CalendarFilters";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface Iteration {
  id: string;
  platform?: string | null;
  post_copy?: string | null;
  media_urls?: string[] | null;
  is_selected?: boolean | null;
  is_approved?: boolean | null;
  variant_group_id?: string | null;
  created_at?: string | null;
}

interface ScheduledPostRef {
  platform?: string | null;
  post_content?: string | null;
}

interface Props {
  contentCalendar: Array<{
    day?: string;
    posts?: any[];
  }>;
  postIterations: Iteration[];
  scheduledPosts: ScheduledPostRef[];
  filters: CalendarFilterState;
  onCardClick: (post: any) => void;
  onToggleApproved: (iterationId: string) => void;
}

/**
 * Find the latest selected iteration matching a calendar post.
 * Matches by (platform, post_copy) — same heuristic the legacy code used.
 */
export function findLatestSelectedIteration(
  iterations: Iteration[],
  post: { platform?: string; copy?: string; caption_angle?: string },
): Iteration | null {
  const matchingPlatform = (post.platform || "").toLowerCase();
  const matchingCopy = (post.copy || post.caption_angle || "").trim().slice(0, 200);
  const candidates = iterations
    .filter((it) => (it.platform || "").toLowerCase() === matchingPlatform)
    .filter((it) => (it.post_copy || "").trim().slice(0, 200) === matchingCopy)
    .filter((it) => it.media_urls && it.media_urls.length > 0);

  // Prefer selected; among ties, latest by created_at.
  const sorted = [...candidates].sort((a, b) => {
    const aSel = a.is_selected ? 1 : 0;
    const bSel = b.is_selected ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  return sorted[0] || null;
}

/**
 * Check whether a calendar post has a matching scheduled_posts row.
 * Match by (platform, post_content first ~200 chars) — same heuristic as
 * findLatestSelectedIteration.
 */
function hasMatchingScheduledPost(
  scheduledPosts: Array<{ platform?: string | null; post_content?: string | null }>,
  post: { platform?: string; copy?: string; caption_angle?: string },
): boolean {
  const matchingPlatform = (post.platform || "").toLowerCase();
  const matchingCopy = (post.copy || post.caption_angle || "").trim().slice(0, 200);
  return scheduledPosts.some(
    (s) =>
      (s.platform || "").toLowerCase() === matchingPlatform &&
      (s.post_content || "").trim().slice(0, 200) === matchingCopy,
  );
}

function matchesFilters(
  post: any,
  status: PostStatus,
  filters: CalendarFilterState,
): boolean {
  if (filters.platform !== "all" && post.platform !== filters.platform) return false;
  if (filters.status !== "all" && status !== filters.status) return false;
  if (filters.language !== "all" && post.language !== filters.language) return false;
  return true;
}

export function CalendarKanban({
  contentCalendar,
  postIterations,
  scheduledPosts,
  filters,
  onCardClick,
  onToggleApproved,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-7 gap-2 print:grid-cols-1">
      {DAYS.map((dayName) => {
        // Skip entire column if day filter excludes it.
        if (filters.day !== "all" && filters.day !== dayName) {
          return <div key={dayName} className="hidden lg:block opacity-30" />;
        }
        const dayEntry = contentCalendar.find((d) => d.day === dayName);
        const posts = dayEntry?.posts || [];

        return (
          <div key={dayName} className="space-y-2 min-w-0">
            <div className="text-sm font-semibold sticky top-16 lg:top-20 py-2 px-2 -mx-2 bg-background/95 backdrop-blur z-[5] border-b border-white/5 text-foreground">
              {dayName}
              {posts.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  {posts.length}
                </span>
              )}
            </div>
            {posts.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic">No posts</p>
            ) : (
              posts.map((post: any, postIdx: number) => {
                const iteration = findLatestSelectedIteration(postIterations, post);
                const status = resolvePostStatus({
                  mediaUrls: iteration?.media_urls || [],
                  isSelectedAny: !!iteration?.is_selected,
                  isApproved: !!iteration?.is_approved,
                  hasScheduledPost: hasMatchingScheduledPost(scheduledPosts, post),
                });
                if (!matchesFilters(post, status, filters)) {
                  return (
                    <div key={postIdx} className="opacity-30 pointer-events-none">
                      <PostCard post={post} iteration={iteration} status={status} onOpen={() => {}} />
                    </div>
                  );
                }
                return (
                  <PostCard
                    key={postIdx}
                    post={post}
                    iteration={iteration}
                    status={status}
                    onOpen={() => onCardClick(post)}
                    onToggleApproved={iteration?.id ? () => onToggleApproved(iteration.id) : undefined}
                  />
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
