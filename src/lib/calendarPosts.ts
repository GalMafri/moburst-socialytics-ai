// The content calendar's posts (table calendar_posts) and how the week board
// shows them. The calendar is its own tab; reports plan posts into it.

import type { CalendarPost } from "@/lib/calendarRevision";

/**
 * What the calendar shows: each week's plan in force, worked-on posts of
 * earlier plans, and posts people added (supabase/functions/_shared/calendar/plans.ts).
 * Screens read this view; only the code that writes posts reads the table.
 */
export const CALENDAR_VIEW = "calendar_posts_current";

export interface CalendarPostRow {
  id: string;
  client_id: string;
  report_id: string | null;
  post_date: string;
  posting_time: string | null;
  platform: string;
  format: string | null;
  pillar: string | null;
  copy: string;
  hashtags: string[] | null;
  cta: string | null;
  visual_direction: string | null;
  rationale: string | null;
  language: string | null;
  reasons: Array<{ type: string; label: string; report_id?: string }> | null;
  source: "report" | "ad_hoc" | "insight" | "trend_slot";
  post_key: string;
  raw: Record<string, unknown> | null;
  created_at: string;
}

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDay: string, days: number): string {
  return isoDate(new Date(utc(isoDay).getTime() + days * 86400000));
}

/** The Monday of the week a date falls in. */
export function mondayOf(isoDay: string): string {
  const d = utc(isoDay);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(isoDay, -back);
}

/** Today in a time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return isoDate(now);
  }
}

/** "Oct 12" */
export function shortDate(isoDay: string): string {
  return utc(isoDay).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Oct 12 – 18, 2026" or "Sep 28 – Oct 4, 2026" */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const a = utc(monday);
  const b = utc(sunday);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const end = sameMonth ? String(b.getUTCDate()) : shortDate(sunday);
  return `${shortDate(monday)} – ${end}, ${b.getUTCFullYear()}`;
}

/** A trend slot nobody has written yet: it is written shortly before its date from what is trending then. */
export function isOpenTrendSlot(post: { _source?: unknown; copy?: unknown } | null | undefined): boolean {
  return post?._source === "trend_slot" && !String(post?.copy ?? "").trim();
}

/** A calendar row as the board's post: the same shape a report's post has, plus its key, date and reasons. */
export function boardPost(row: CalendarPostRow): CalendarPost {
  return {
    ...(row.raw || {}),
    platform: row.platform,
    format: row.format ?? undefined,
    pillar: row.pillar ?? undefined,
    posting_time: row.posting_time ?? undefined,
    copy: row.copy,
    hashtags: row.hashtags ?? [],
    CTA: row.cta ?? undefined,
    visual_direction: row.visual_direction ?? undefined,
    rationale: row.rationale ?? undefined,
    language: row.language ?? undefined,
    // Scheduling reads the date from here.
    date_label: row.post_date,
    _calendarPostKey: row.post_key,
    _calendarPostId: row.id,
    _reportId: row.report_id ?? undefined,
    _reasons: row.reasons ?? [],
    _source: row.source,
  };
}

/** One week of the calendar in the board's shape: Monday to Sunday, each day with its posts. */
export function weekBoard(rows: CalendarPostRow[], monday: string): Array<{ day: string; date_label: string; posts: CalendarPost[] }> {
  return DAYS.map((day, i) => {
    const date = addDays(monday, i);
    const posts = rows
      .filter((r) => r.post_date === date)
      .sort((a, b) => (a.posting_time || "").localeCompare(b.posting_time || "") || a.created_at.localeCompare(b.created_at))
      .map(boardPost);
    return { day, date_label: shortDate(date), posts };
  });
}
