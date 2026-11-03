// supabase/functions/_shared/calendar/planState.ts
//
// What a week's plan (calendar_plans.status) lets people do, one rule for
// the calendar-posts function and the calendar screen (Lital, 3 Nov 2026).
// The database decides what happens (calendar_request_week,
// calendar_stop_plan); this only says what to offer.
//
//   queued, planning  the plan is on its way; "Stop planning" stops it
//   ready             planned; "Revise this week" and "Remove this week's plan"
//   canceled          a person stopped it or removed it: the week has no plan
//   expired           the week ended before it was planned
//   failed            only on plans from before 20 Oct 2026

/** A week "Plan next week" may plan: no plan yet, a plan that failed, or one a person stopped or removed. */
export function plannable(status: string | null | undefined): boolean {
  return !status || status === "failed" || status === "canceled";
}

/** A plan on its way: queued for its job, or being written by it. */
export function planInFlight(status: string | null | undefined): boolean {
  return status === "queued" || status === "planning";
}
