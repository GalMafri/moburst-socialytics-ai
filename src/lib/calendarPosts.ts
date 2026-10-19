// The content calendar's posts (table calendar_posts) and how the week board
// shows them. The calendar is its own tab; each week is planned once
// (calendar_plans), every Monday for the following week or when someone
// presses "Plan next week" (weekly calendar, Lital 19 Oct 2026).

import type { CalendarPost } from "@/lib/calendarRevision";

/** The evidence a planned post acts on, with its real numbers (supabase/functions/_shared/calendar/weekPlan.ts). */
export interface PostEvidence {
  id: string;
  kind: "own" | "competitor" | "topic" | "trend" | "report";
  text: string;
  platform?: string;
  company?: string;
  format?: string;
  date?: string;
  link?: string | null;
  metric?: string;
  value?: number;
  median?: number;
  multiple?: number;
  sample?: number;
  thin?: boolean;
  companies?: number;
}

export interface PostReason {
  type: string;
  label: string;
  fit?: string;
  evidence?: PostEvidence[];
  thin?: boolean;
  report_id?: string;
}

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
  reasons: PostReason[] | null;
  source: "plan" | "ad_hoc" | "insight";
  plan_id: string | null;
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

/** One week's plan (calendar_plans). */
export interface CalendarPlanRow {
  id: string;
  client_id: string;
  week_start: string;
  status: "queued" | "planning" | "ready" | "failed";
  trigger: "monday" | "button" | "cutover";
  error: string | null;
  pending_revision: { note: string; at: string } | null;
  revisions: Array<{ note: string; at: string; done_at?: string; rewritten?: number; kept?: string[]; failed?: boolean }> | null;
  ready_at: string | null;
  created_at: string;
}

/** How far ahead "Plan next week" goes: a month (the same limit calendar-posts applies). */
export const WEEKS_AHEAD = 4;

/**
 * The week "Plan next week" would plan: the earliest week from this week up
 * to four weeks ahead that still has days to come and no plan (or a plan that
 * failed). Null when the month ahead is planned.
 */
export function nextPlannableWeek(plans: Array<Pick<CalendarPlanRow, "week_start" | "status">>, today: string): string | null {
  const tomorrow = addDays(today, 1);
  const held = new Map(plans.map((p) => [p.week_start, p.status]));
  for (let i = 0; i <= WEEKS_AHEAD; i++) {
    const week = addDays(mondayOf(today), i * 7);
    if (addDays(week, 6) < tomorrow) continue;
    if (!held.has(week) || held.get(week) === "failed") return week;
  }
  return null;
}

/** A week someone can still revise: planned, and with days to come. */
export function canRevise(plan: Pick<CalendarPlanRow, "status" | "week_start" | "pending_revision"> | null | undefined, today: string): boolean {
  return !!plan && plan.status === "ready" && !plan.pending_revision && addDays(plan.week_start, 6) >= today;
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
