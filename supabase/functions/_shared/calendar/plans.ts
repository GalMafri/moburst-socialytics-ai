// supabase/functions/_shared/calendar/plans.ts
//
// One plan per week on a client's calendar (Lital, 19 Oct 2026). A report's
// own posts and the weeks planned from its findings are one plan, named by
// the report. A newer report's plan takes over every week it places: posts of
// an older plan in that week leave the calendar unless someone has worked on
// them (a copy edit, a design, a design request, a move, or a scheduled post).
// Worked-on posts stay, and the newer plan leaves their platform and day to
// them. Days already past are never touched, and an older report imported
// again never takes a week back from a newer plan.
//
// The plan also runs until the next scheduled report has taken over, so the
// calendar never runs dry between two monthly reports.

/** A calendar post as the week's claim reads it. */
export interface WeekPost {
  id: string;
  post_key: string;
  post_date: string;
  platform: string;
  source: string;
  report_id: string | null;
}

export interface WeekClaim {
  /** A newer plan holds this week, so this plan places nothing in it. */
  yielded: boolean;
  /** Posts to take off the calendar. */
  remove: string[];
  /** Day and platform slots kept by worked-on posts of older plans ("date|platform"). */
  held: Set<string>;
}

/** Posts a plan makes; anything else on the calendar was added by a person. */
const PLAN_SOURCES = new Set(["report", "trend_slot"]);

export function slotOf(date: string, platform: string): string {
  return `${date}|${String(platform ?? "").trim().toLowerCase()}`;
}

/**
 * What placing a plan's week does to the posts already in it.
 * `reportCreated` gives each report's creation time, which orders the plans;
 * `worked` holds the ids of posts someone has worked on.
 */
export function claimWeek(input: {
  reportId: string;
  reportCreatedAt: string;
  today: string;
  posts: WeekPost[];
  reportCreated: Map<string, string>;
  worked: Set<string>;
}): WeekClaim {
  const { reportId, reportCreatedAt, today, worked } = input;
  const plans = input.posts.filter((p) => PLAN_SOURCES.has(p.source) && p.report_id);
  const created = (p: WeekPost) => input.reportCreated.get(p.report_id as string) ?? "";
  if (plans.some((p) => p.report_id !== reportId && created(p) > reportCreatedAt)) {
    return { yielded: true, remove: [], held: new Set() };
  }
  const held = new Set<string>();
  const remove: string[] = [];
  for (const p of plans) {
    if (p.report_id === reportId || p.post_date < today) continue;
    if (worked.has(p.id)) held.add(slotOf(p.post_date, p.platform));
    else remove.push(p.id);
  }
  // This plan's own posts already placed on a slot that a worked-on post keeps.
  for (const p of plans) {
    if (p.report_id !== reportId || p.post_date < today || worked.has(p.id)) continue;
    if (held.has(slotOf(p.post_date, p.platform))) remove.push(p.id);
  }
  return { yielded: false, remove, held };
}

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}

export function mondayOf(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return addDays(day.slice(0, 10), -((d.getUTCDay() + 6) % 7));
}

/**
 * How many weeks to plan after a report's own week, starting at `firstMonday`:
 * through the week after the next scheduled report lands, so the calendar is
 * covered even when that report plans from the following Monday. Three when
 * no report is scheduled; never more than six.
 */
export function weeksToPlan(firstMonday: string, nextRunAt: string | null | undefined): number {
  if (!nextRunAt) return 3;
  const last = mondayOf(addDays(nextRunAt.slice(0, 10), 7));
  const weeks = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${firstMonday}T00:00:00Z`)) / (7 * 86400000)) + 1;
  return Math.max(1, Math.min(6, weeks));
}

/**
 * Claim the weeks starting on `mondays` for a report's plan: works out each
 * week's claim from the posts there and takes the removed posts off the
 * calendar (unless `dryRun`). Returns the claims by Monday.
 */
export async function claimWeeks(
  admin: any,
  clientId: string,
  report: { id: string; created_at: string },
  mondays: string[],
  opts: { dryRun?: boolean; today?: string } = {},
): Promise<Map<string, WeekClaim>> {
  const claims = new Map<string, WeekClaim>();
  if (!mondays.length) return claims;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const sorted = [...new Set(mondays)].sort();
  const { data: rows, error } = await admin.from("calendar_posts")
    .select("id, post_key, post_date, platform, source, report_id")
    .eq("client_id", clientId).gte("post_date", sorted[0]).lte("post_date", addDays(sorted[sorted.length - 1], 6))
    .order("post_date").limit(1000);
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  const posts = (rows ?? []) as WeekPost[];

  const reportIds = [...new Set(posts.map((p) => p.report_id).filter(Boolean))] as string[];
  const reportCreated = new Map<string, string>([[report.id, report.created_at]]);
  if (reportIds.length) {
    const { data: reports } = await admin.from("reports").select("id, created_at").in("id", reportIds);
    for (const r of reports ?? []) reportCreated.set(r.id, r.created_at);
  }
  const worked = new Set<string>();
  if (posts.length) {
    const { data: ids, error: workedError } = await admin.rpc("calendar_posts_worked_on", { p_ids: posts.map((p) => p.id) });
    if (workedError) throw new Error(`Could not tell which posts were worked on: ${workedError.message}`);
    for (const row of ids ?? []) worked.add(typeof row === "string" ? row : row.calendar_posts_worked_on ?? row.id);
  }

  const remove: string[] = [];
  for (const monday of sorted) {
    const inWeek = posts.filter((p) => p.post_date >= monday && p.post_date <= addDays(monday, 6));
    const claim = claimWeek({ reportId: report.id, reportCreatedAt: report.created_at, today, posts: inWeek, reportCreated, worked });
    claims.set(monday, claim);
    remove.push(...claim.remove);
  }
  if (remove.length && !opts.dryRun) {
    const { error: deleteError } = await admin.from("calendar_posts").delete().in("id", remove);
    if (deleteError) throw new Error(`Could not take the older plan's posts off the calendar: ${deleteError.message}`);
  }
  return claims;
}
