/**
 * The Dashboard's one-screen status for a client (Lital, 13 Oct: "an overview
 * of the client's status on all accounts, kind of like a snapshot of their
 * performance, competitors, etc, very high-level, not another duplicated
 * analytics view, with action items if there are any relevant").
 *
 * Pure functions over rows the Dashboard already reads: the latest monthly
 * report, the latest competitive context, the coming week's calendar posts
 * and their media. Every line is a fact from those rows; nothing is invented.
 */

import { addDays, mondayOf } from "@/lib/calendarPosts";

export interface HeadlineMetric { key: string; label: string; current: number; percent: number | null }

const METRIC_ORDER: Array<[string, string]> = [
  ["impressions", "Impressions"],
  ["reactions", "Reactions"],
  ["engagements", "Engagements"],
  ["link_clicks", "Link clicks"],
  ["video_views", "Video views"],
  ["comments", "Comments"],
  ["shares", "Shares"],
];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The report's own month-over-month figures: up to three headline metrics, and how many of all metrics rose. */
export function reportHeadline(reportData: unknown): { metrics: HeadlineMetric[]; rose: number; total: number } | null {
  type Change = { current?: unknown; percent?: unknown };
  const rd = (Array.isArray(reportData) ? reportData[0] : reportData) as { sprout_performance?: { month_comparison?: { changes?: Record<string, Change> } } } | null;
  const changes = rd?.sprout_performance?.month_comparison?.changes;
  if (!changes || typeof changes !== "object") return null;
  const metrics: HeadlineMetric[] = [];
  for (const [key, label] of METRIC_ORDER) {
    const c = changes[key];
    if (!c || !finite(c.current)) continue;
    metrics.push({ key, label, current: c.current as number, percent: finite(c.percent) ? c.percent : null });
    if (metrics.length === 3) break;
  }
  const all = Object.values(changes).map((c) => c?.percent).filter(finite);
  if (!metrics.length) return null;
  return { metrics, rose: all.filter((p) => p > 0).length, total: all.length };
}

export interface Standing { shareOfVoice: number | null; competitors: string[]; ahead: string[]; behind: string[] }

/** Where the client stands against its competitors, from the competitive context (buildCompetitiveContext). */
export function competitiveStanding(ctx: { share_of_voice_pct?: number | null; competitors?: Array<{ name: string }>; benchmark_dimensions?: Array<{ dimension: string; client: number; competitor_avg: number }> } | null): Standing | null {
  if (!ctx) return null;
  const dims = (ctx.benchmark_dimensions || []).filter((d) => finite(d.client) && finite(d.competitor_avg));
  return {
    shareOfVoice: finite(ctx.share_of_voice_pct) ? ctx.share_of_voice_pct : null,
    competitors: (ctx.competitors || []).map((c) => c.name).filter(Boolean),
    ahead: dims.filter((d) => d.client > d.competitor_avg).map((d) => d.dimension.toLowerCase()),
    behind: dims.filter((d) => d.client < d.competitor_avg).map((d) => d.dimension.toLowerCase()),
  };
}

export interface WeekPost { id: string; post_key: string; post_date: string; platform: string; source: string; copy: string }
export interface PostMedia { calendar_post_key: string | null; is_selected: boolean | null; is_approved: boolean | null; media_urls: string[] | null }

export interface ContentWeek {
  planned: number;
  designed: number;
  approved: number;
  /** Posts in the next seven days with no chosen design, soonest first. */
  withoutDesign: WeekPost[];
  /** Posts in the next three days that nobody has approved. */
  unapprovedSoon: WeekPost[];
}

/** The coming seven days of the calendar (today included), matched to their media by post key in code. */
export function contentWeek(posts: WeekPost[], media: PostMedia[], today: string): ContentWeek {
  const end = addDays(today, 6);
  const soon = addDays(today, 2);
  // A post with no copy yet isn't ready to design or approve.
  const week = posts.filter((p) => p.post_date >= today && p.post_date <= end && p.copy.trim())
    .sort((a, b) => a.post_date.localeCompare(b.post_date));
  const byKey = new Map<string, PostMedia[]>();
  for (const m of media) {
    if (!m.calendar_post_key) continue;
    byKey.set(m.calendar_post_key, [...(byKey.get(m.calendar_post_key) || []), m]);
  }
  const designed = (p: WeekPost) => (byKey.get(p.post_key) || []).some((m) => m.is_selected && (m.media_urls?.length ?? 0) > 0);
  const approved = (p: WeekPost) => (byKey.get(p.post_key) || []).some((m) => m.is_approved);
  return {
    planned: week.length,
    designed: week.filter(designed).length,
    approved: week.filter(approved).length,
    withoutDesign: week.filter((p) => !designed(p)),
    unapprovedSoon: week.filter((p) => p.post_date <= soon && !approved(p)),
  };
}

export interface ActionItem { key: string; text: string; href: string; tone: "attention" | "info" }

/**
 * What needs doing, most urgent first. Staff see the setup and run items;
 * a client sees only what concerns their own content.
 */
export function actionItems(args: {
  clientId: string;
  isStaff: boolean;
  today: string;
  content: ContentWeek;
  lastRun: { status: string; created_at: string } | null;
  hasReport: boolean;
  tracking: { headline: string; ready: boolean } | null;
  hasCompetitiveReport: boolean;
  openTopics: number;
  endorsedTests: number;
}): ActionItem[] {
  const { clientId, isStaff, content } = args;
  const week = `/clients/${clientId}/calendar?week=${mondayOf(args.today)}`;
  const items: ActionItem[] = [];
  if (content.unapprovedSoon.length) {
    const n = content.unapprovedSoon.length;
    items.push({ key: "approve", tone: "attention", href: week, text: `${n} post${n === 1 ? "" : "s"} going out in the next three days ${n === 1 ? "is" : "are"} not approved yet.` });
  }
  if (content.withoutDesign.length) {
    const n = content.withoutDesign.length;
    items.push({ key: "design", tone: "attention", href: week, text: `${n} post${n === 1 ? "" : "s"} this week ${n === 1 ? "has" : "have"} no design chosen yet.` });
  }
  // A scheduled report that does not finish runs again on its own
  // (run-scheduled-jobs/dispatch.ts), so a run that stopped is never an item.
  if (isStaff && !args.hasReport && args.lastRun?.status !== "running") {
    items.push({ key: "no-report", tone: "info", href: `/clients/${clientId}/analyze`, text: "No monthly report yet. Run the first one." });
  }
  if (isStaff && args.tracking && !args.tracking.ready && args.tracking.headline) {
    items.push({ key: "tracking", tone: "attention", href: `/clients/${clientId}/competitive`, text: `Competitor tracking: ${args.tracking.headline.toLowerCase()}.` });
  }
  if (isStaff && !args.hasCompetitiveReport) {
    items.push({ key: "no-competitive", tone: "info", href: `/clients/${clientId}/competitive`, text: "No competitive analysis yet. Set up competitors and run one." });
  }
  if (isStaff && args.openTopics > 0) {
    const n = args.openTopics;
    items.push({ key: "topics", tone: "info", href: `/clients/${clientId}/competitive/feed`, text: `${n} topic${n === 1 ? "" : "s"} competitors are posting about, ready for a take.` });
  }
  if (args.endorsedTests > 0) {
    const n = args.endorsedTests;
    items.push({ key: "tests", tone: "info", href: `/clients/${clientId}/competitive/reports`, text: `${n} suggested test${n === 1 ? "" : "s"} from the competitive analysis ${n === 1 ? "is" : "are"} in the content plan.` });
  }
  return items;
}
