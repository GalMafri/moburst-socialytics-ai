// supabase/functions/_shared/calendar/plans.ts
//
// The calendar's plans (Lital, 19 Oct 2026). A plan is a report's strategy:
// the report's own week and every week planned from its findings carry its
// report_id. calendar_weeks names the plan in force for each week (one per
// week), calendar_assign_week() lets a newer report's plan take a week, and
// calendar_posts_current is what every screen and job reads. Nothing is
// deleted when a plan takes a week; see the migration of 19 Oct 2026.
//
// The calendar keeps itself planned: every morning, and whenever a report
// lands, each active client's next four weeks are planned from its latest
// report. A week no plan has taken is planned; a week an older plan holds is
// planned again from the newer report, from next week on (the current week is
// only ever filled, never re-planned under the team's feet).

/** The view every reader of the calendar uses. */
export const CALENDAR_VIEW = "calendar_posts_current";

/** Weeks kept planned ahead, the current one included. */
export const PLAN_WINDOW_WEEKS = 4;

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day.slice(0, 10)}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}

export function mondayOf(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** The plan in force for a week, with when its report was made. */
export interface WeekOwner {
  report_id: string;
  created_at: string;
}

/**
 * The weeks to plan from the client's latest report: in the window from this
 * week, every week no plan holds, and every week from next week on that an
 * older report's plan holds.
 */
export function weeksToPlan(input: { today: string; latest: { id: string; created_at: string }; owners: Map<string, WeekOwner> }): string[] {
  const thisWeek = mondayOf(input.today);
  const weeks: string[] = [];
  for (let i = 0; i < PLAN_WINDOW_WEEKS; i++) {
    const week = addDays(thisWeek, i * 7);
    const owner = input.owners.get(week);
    if (!owner) weeks.push(week);
    else if (week > thisWeek && owner.report_id !== input.latest.id && owner.created_at < input.latest.created_at) weeks.push(week);
  }
  return weeks;
}

/** Let a report's plan take a week. True when the report's plan is in force there afterwards. */
export async function assignWeek(admin: any, clientId: string, week: string, reportId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("calendar_assign_week", { p_client: clientId, p_week: week, p_report: reportId });
  if (error) throw new Error(`Could not give the week of ${week} to the report's plan: ${error.message}`);
  return data === true;
}

/** The plans in force for a client's weeks from `from` on, by Monday. */
export async function weekOwners(admin: any, clientId: string, from: string): Promise<Map<string, WeekOwner>> {
  const { data, error } = await admin.from("calendar_weeks").select("week_start, report_id, reports(created_at)")
    .eq("client_id", clientId).gte("week_start", from).order("week_start").limit(200);
  if (error) throw new Error(`Could not read the calendar's weeks: ${error.message}`);
  return new Map((data ?? []).map((w: any) => [w.week_start, { report_id: w.report_id, created_at: w.reports?.created_at ?? "" }]));
}

/** A client's newest finished report, which plans its calendar. */
export async function latestReport(admin: any, clientId: string): Promise<{ id: string; created_at: string } | null> {
  const { data } = await admin.from("reports").select("id, created_at").eq("client_id", clientId).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}
