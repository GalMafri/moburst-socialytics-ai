// What a calendar week says about its plan (Lital, 3 Nov 2026: a status that
// stays). Read only from the plan as the server has it (calendar_plans): its
// status, the revision waiting, whether a run has it (claimed_at), and the
// revisions done. Nothing here counts time; the page looks again every ten
// seconds while a plan is on its way (src/pages/ClientCalendar.tsx).

import { addDays, shortDate, type CalendarPlanRow } from "@/lib/calendarPosts";
import { planInFlight } from "../../supabase/functions/_shared/calendar/planState";

export interface PlanStep {
  label: string;
  state: "done" | "current" | "next";
}

export type WeekPlanView =
  | { kind: "planning"; line: string; steps: PlanStep[] }
  | { kind: "revising"; line: string; note: string; steps: PlanStep[] }
  | { kind: "planned" | "revised" | "stopped" | "removed"; line: string };

/** Two steps: waiting for a run to take it, then the run writing. */
function steps(started: boolean, writing: string): PlanStep[] {
  return [
    { label: "Waiting to start", state: started ? "done" : "current" },
    { label: writing, state: started ? "current" : "next" },
  ];
}

/** The newest revision a person or the client notes asked for, finished since the plan was ready. */
function lastRevision(plan: CalendarPlanRow) {
  const last = [...(plan.revisions ?? [])].reverse().find((r) => r.scope !== "empty");
  if (!last?.done_at || last.expired || last.failed) return null;
  if (plan.ready_at && Date.parse(last.done_at) < Date.parse(plan.ready_at)) return null;
  return last;
}

/**
 * The line a week shows for its plan, or null when it shows none: no plan,
 * a week that ended before it was planned, or a planned week that is over.
 */
export function weekPlanView(plan: CalendarPlanRow | null | undefined, today: string): WeekPlanView | null {
  if (!plan) return null;
  const week = shortDate(plan.week_start);
  if (planInFlight(plan.status)) {
    return { kind: "planning", line: `Planning the week of ${week}…`, steps: steps(plan.status === "planning", "Writing the posts") };
  }
  if (plan.status === "ready" && plan.pending_revision) {
    return { kind: "revising", line: `Revising the week of ${week}…`, note: plan.pending_revision.note, steps: steps(!!plan.claimed_at, "Rewriting the posts") };
  }
  if (plan.status === "ready") {
    if (addDays(plan.week_start, 6) < today) return null;
    const revised = lastRevision(plan);
    if (!revised) return { kind: "planned", line: "Planned" };
    const n = revised.rewritten ?? 0;
    return { kind: "revised", line: n ? `Revised: ${n} post${n === 1 ? "" : "s"} rewritten` : "Revised: nothing was left to rewrite" };
  }
  if (plan.status === "canceled") {
    // A plan removed once it was done had been ready; one stopped on its way never was.
    return plan.ready_at ? { kind: "removed", line: "This week's plan was removed." } : { kind: "stopped", line: "Planning was stopped for this week." };
  }
  return null;
}
