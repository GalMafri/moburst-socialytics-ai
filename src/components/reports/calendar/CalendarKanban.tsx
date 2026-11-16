import { PostCard } from "./PostCard";
import { resolvePostStatus } from "./postStatus";
import type { PostStatus } from "./postStatus";
import type { CalendarFilterState } from "./CalendarFilters";
import { scheduledFor, sendStateOf, useSendClock, type ScheduledRow, type SendState } from "@/components/reports/SchedulePostModal";
import { iterationMatchesPost, type CalendarPost } from "@/lib/calendarRevision";
import { isStoryPost, normalizePlatform } from "@/lib/platform";
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

/** A scheduled_posts row as the board reads it: the key and the status decide which post it is and whether it counts. */
type ScheduledPostRef = ScheduledRow;

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

function matchesFilters(
  post: any,
  status: PostStatus,
  filters: CalendarFilterState,
): boolean {
  if (filters.platform !== "all" && normalizePlatform(post.platform) !== normalizePlatform(filters.platform)) return false;
  if (filters.status !== "all" && status !== filters.status) return false;
  if (filters.language !== "all" && post.language !== filters.language) return false;
  return true;
}

export interface BoardCard {
  post: CalendarPost;
  iteration: Iteration | null;
  status: PostStatus;
  /** Where the post's send stands, read from the same row and rule as its panel's Schedule tab. */
  sendState: SendState;
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
  /** The clock a send's state is read at (useSendClock). */
  now: number = Date.now(),
): { days: Array<{ day: string; date_label?: string; posts: BoardCard[] }>; shown: number; total: number } {
  const days = DAYS.filter((dayName) => filters.day === "all" || filters.day === dayName).map((dayName) => {
    const dayEntry = contentCalendar.find((d) => d.day === dayName);
    const cards = (dayEntry?.posts || []).map((post: CalendarPost): BoardCard => {
      const iteration = findLatestSelectedIteration(postIterations, post);
      const sent = scheduledFor(scheduledPosts, post);
      const status = resolvePostStatus({
        mediaUrls: iteration?.media_urls || [],
        isSelectedAny: !!iteration?.is_selected,
        isApproved: !!iteration?.is_approved,
        hasScheduledPost: !!sent,
        story: isStoryPost(post),
      });
      return { post, iteration, status, sendState: status === "scheduled" ? sendStateOf(sent, now) : "none" };
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
  // A card whose send is out is drawn again when that send can no longer be running, at the clock the
  // Schedule tab reads it at.
  const now = useSendClock(scheduledPosts);
  const { days } = visibleBoard(contentCalendar, postIterations, scheduledPosts, filters, now);
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
              {posts.map(({ post, iteration, status, sendState }, postIdx) => (
                <PostCard
                  key={post._calendarPostKey ?? postIdx}
                  post={post}
                  iteration={iteration}
                  status={status}
                  sendState={sendState}
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
