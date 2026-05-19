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
    date_label?: string;
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
    <div className="space-y-6">
      {DAYS.map((dayName) => {
        // If day filter excludes this day, skip rendering entirely.
        if (filters.day !== "all" && filters.day !== dayName) return null;
        const dayEntry = contentCalendar.find((d) => d.day === dayName);
        const posts = dayEntry?.posts || [];

        return (
          <section key={dayName} className="space-y-4 animate-slide-up">
            {/* Day header row — Intercept Page title spec: 20px Bold tracking-[-0.5px] */}
            <div className="flex items-baseline gap-3 flex-wrap sticky top-16 lg:top-20 bg-background/95 backdrop-blur py-3 z-[5] border-b border-white/[0.06]">
              <h3 className="text-[20px] font-bold leading-6 tracking-[-0.5px] text-foreground">
                {dayName}
              </h3>
              {dayEntry?.date_label && (
                <span className="text-sm text-muted-foreground tracking-[-0.5px]">
                  {dayEntry.date_label}
                </span>
              )}
              <span
                className="text-xs font-medium tracking-[0.1px] uppercase text-muted-foreground ml-auto"
                aria-live="polite"
              >
                {posts.length === 0 ? "No posts" : `${posts.length} post${posts.length === 1 ? "" : "s"}`}
              </span>
            </div>

            {posts.length > 0 && (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
                {posts.map((post: any, postIdx: number) => {
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
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
