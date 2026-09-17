import { cleanPostCopy, postCopyOf } from "./postCopy";

export interface CalendarPost {
  copy?: string; caption_angle?: string; concept?: string; platform?: string;
  hashtags?: string[]; CTA?: string; cta?: string;
  _calendarPostKey?: string; _originalCopy?: string; _copyVersion?: number;
  _copyHistory?: string[];
  [key: string]: unknown;
}
export interface CopyRevision {
  id?: string; report_id?: string | null; calendar_post_key?: string | null;
  post_copy?: string | null; platform?: string | null; hashtags?: string[] | null;
  cta?: string | null; version?: number; created_at?: string | null;
}

export function applyCopyRevisions(post: CalendarPost, revisions: CopyRevision[]): CalendarPost {
  if (!post._calendarPostKey) return post;
  const matching = revisions.filter((r) => r.calendar_post_key === post._calendarPostKey)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "") || (b.version || 0) - (a.version || 0));
  const latest = matching[0];
  if (latest && (latest.version || 0) < (post._copyVersion || 0)) return post;
  const original = post._originalCopy ?? postCopyOf(post);
  if (!latest) return { ...post, _originalCopy: original };
  return {
    ...post, copy: latest.post_copy ?? original,
    hashtags: latest.hashtags ?? post.hashtags,
    CTA: latest.cta ?? post.CTA, cta: latest.cta ?? post.cta,
    _originalCopy: original, _copyVersion: latest.version || 1,
    _copyHistory: [original, ...matching.map((r) => r.post_copy || "")],
  };
}

export function calendarWithRevisions(
  calendar: Array<{ day?: string; date_label?: string; posts?: CalendarPost[]; [key: string]: unknown }>,
  reportId: string | undefined,
  revisions: CopyRevision[],
) {
  return calendar.map((day, dayIndex) => ({
    ...day,
    posts: (day.posts || []).map((post, postIndex) => applyCopyRevisions({
      ...post,
      // Full original content avoids collisions and prevents edits leaking into a re-run.
      // The key is not indexed; report/client indexes bound the revision query.
      _calendarPostKey: reportId ? JSON.stringify([reportId, dayIndex, postIndex, day.day, day.date_label, post.platform, postCopyOf(post)]) : undefined,
    }, revisions)),
  }));
}

/** Keep legacy creative linked when the user changes the copy. */
export function iterationMatchesPost(iteration: CopyRevision, post: CalendarPost): boolean {
  if (iteration.calendar_post_key && post._calendarPostKey) return iteration.calendar_post_key === post._calendarPostKey;
  if ((iteration.platform || "").toLowerCase() !== (post.platform || "").toLowerCase()) return false;
  const copies = [postCopyOf(post), post._originalCopy, ...(post._copyHistory || [])].filter(Boolean);
  return copies.some((copy) => cleanPostCopy(copy).trim().slice(0, 200) === cleanPostCopy(iteration.post_copy).trim().slice(0, 200));
}
