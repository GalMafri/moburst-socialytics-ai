import { PostCard } from "./PostCard";
import { resolvePostStatus } from "./postStatus";
import type { PostStatus } from "./PostStatusChip";
import type { CalendarFilterState } from "./CalendarFilters";
import { postCopyOf } from "@/lib/postCopy";
import { iterationMatchesPost, type CalendarPost } from "@/lib/calendarRevision";
import { isStoryPost } from "@/lib/platform";
import { dayCountLabel } from "@/lib/calendarPosts";

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
  post: CalendarPost,
): Iteration | null {
  const candidates = iterations
    .filter((it) => iterationMatchesPost(it, post))
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
  const matchingCopy = postCopyOf(post).trim().slice(0, 200);
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

export interface BoardCard {
  post: CalendarPost;
  iteration: Iteration | null;
  status: PostStatus;
}

/**
 * What the board shows under the filters (Lital, 3 Nov 2026: a filter hides
 * what it leaves out). Each day the day filter keeps, with only the posts
 * the other filters keep; a day left with none is an empty day. `shown`
 * counts those posts and `total` every post of the week, for the count
 * beside the filter.
 */
export function visibleBoard(
  contentCalendar: Props["contentCalendar"],
  postIterations: Iteration[],
  scheduledPosts: ScheduledPostRef[],
  filters: CalendarFilterState,
): { days: Array<{ day: string; date_label?: string; posts: BoardCard[] }>; shown: number; total: number } {
  const days = DAYS.filter((dayName) => filters.day === "all" || filters.day === dayName).map((dayName) => {
    const dayEntry = contentCalendar.find((d) => d.day === dayName);
    const cards = (dayEntry?.posts || []).map((post: CalendarPost): BoardCard => {
      const iteration = findLatestSelectedIteration(postIterations, post);
      const status = resolvePostStatus({
        mediaUrls: iteration?.media_urls || [],
        isSelectedAny: !!iteration?.is_selected,
        isApproved: !!iteration?.is_approved,
        hasScheduledPost: hasMatchingScheduledPost(scheduledPosts, post),
        story: isStoryPost(post),
      });
      return { post, iteration, status };
    });
    return { day: dayName, date_label: dayEntry?.date_label, posts: cards.filter((c) => matchesFilters(c.post, c.status, filters)) };
  });
  const total = contentCalendar.filter((d) => DAYS.includes(d.day ?? "")).reduce((n, d) => n + (d.posts || []).length, 0);
  return { days, shown: days.reduce((n, d) => n + d.posts.length, 0), total };
}

export function CalendarKanban({
  contentCalendar,
  postIterations,
  scheduledPosts,
  filters,
  onCardClick,
  onToggleApproved,
}: Props) {
  // The week as a board: one column per day, as many columns as the width
  // allows, each as tall as its own posts. Each day used to be a full-width
  // band over a three-column grid, so a day with one post showed one card at
  // a third of the width and two thirds of empty page beside it, seven times.
  // A post the filters leave out is not drawn at all.
  const { days } = visibleBoard(contentCalendar, postIterations, scheduledPosts, filters);
  return (
    <div className="grid gap-inner items-start [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
      {days.map(({ day: dayName, date_label, posts }) => (
        <section key={dayName} className="glass p-inner space-y-3 min-w-0 animate-slide-up" aria-label={dayName}>
          <div className="flex items-baseline gap-2 flex-wrap px-1">
            <h2 className="t-h3">{dayName}</h2>
            {date_label && <span className="t-label">{date_label}</span>}
            <span className="t-subhead ml-auto" aria-live="polite">
              {dayCountLabel(posts.map((c) => c.post))}
            </span>
          </div>

          {posts.length > 0 && (
            <div className="space-y-3">
              {posts.map(({ post, iteration, status }, postIdx) => (
                <PostCard
                  key={post._calendarPostKey ?? postIdx}
                  post={post}
                  iteration={iteration}
                  status={status}
                  onOpen={() => onCardClick(post)}
                  onToggleApproved={iteration?.id ? () => onToggleApproved(iteration.id) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
