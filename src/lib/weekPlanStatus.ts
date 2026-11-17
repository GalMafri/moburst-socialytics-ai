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

/**
 * A revision the app asked for itself, not a person: the daily run writing
 * posts that had no copy ("empty"), and posts written again under the copy
 * rules ("replan"). The week says it is being updated while one runs, with no
 * note, and afterwards says what it said before: nobody asked for a revision,
 * so none is reported. What such a run kept or rewrote stays on the plan's
 * own record (calendar_plans.revisions).
 */
const byTheApp = (scope: string | undefined): boolean => scope === "empty" || scope === "replan";

/** The newest revision a person or the client notes asked for, finished since the plan was ready. */
function lastRevision(plan: CalendarPlanRow) {
  const last = [...(plan.revisions ?? [])].reverse().find((r) => !byTheApp(r.scope));
  if (!last?.done_at || last.expired || last.failed) return null;
  if (plan.ready_at && Date.parse(last.done_at) < Date.parse(plan.ready_at)) return null;
  return last;
}

/** Why a post's new copy was not saved, in the words a person reads, by what was wrong with it. */
export const KEPT_WHY: Record<string, string> = {
  borrowed: "the new copy repeated another company's post",
  chapters: "the new copy listed video chapter times, and the video is not made yet",
  link: "the new copy linked to a site that is not the brand's own",
  handle: "the new copy tagged an account that is not the brand's own",
  pointer: "the new copy pointed to something the brand's own material does not show",
};
/** Said when the posts were kept for different reasons, or for one this page does not know. */
export const KEPT_WHY_MIXED = "the new copy used wording, links or names that are not the brand's own";

/**
 * One short sentence for the posts a revision left as they were because
 * their new copy was not saved, so nobody is left looking at unchanged copy
 * with no word: how many, and why. "" when there are none.
 */
export function keptLine(refused: Array<{ id?: string; kind?: string }> | null | undefined): string {
  const kept = Array.isArray(refused) ? refused : [];
  if (!kept.length) return "";
  const kinds = [...new Set(kept.map((r) => String(r?.kind ?? "")))];
  const why = kinds.length === 1 && KEPT_WHY[kinds[0]] ? KEPT_WHY[kinds[0]] : KEPT_WHY_MIXED;
  return `${kept.length} post${kept.length === 1 ? "" : "s"} kept as ${kept.length === 1 ? "it was" : "they were"}: ${why}.`;
}

/**
 * The line a week shows for its plan, or null when it shows none: no plan,
 * a week that ended before it was planned, or a planned week that is over.
 */
export function weekPlanView(plan: CalendarPlanRow | null | undefined, today: string): WeekPlanView | null {
  if (!plan) return null;
  const week = shortDate(plan.week_start);
  if (planInFlight(plan.status)) {
    // A plan that already failed a try goes on trying: say so, never the error itself.
    const line = plan.error ? `Planning the week of ${week} is taking longer than usual. It keeps trying.` : `Planning the week of ${week}…`;
    return { kind: "planning", line, steps: steps(plan.status === "planning", "Writing the posts") };
  }
  if (plan.status === "ready" && plan.pending_revision && byTheApp(plan.pending_revision.scope)) {
    return { kind: "revising", line: `Updating the week of ${week}…`, note: "", steps: steps(!!plan.claimed_at, "Rewriting the posts") };
  }
  if (plan.status === "ready" && plan.pending_revision) {
    return { kind: "revising", line: `Revising the week of ${week}…`, note: plan.pending_revision.note, steps: steps(!!plan.claimed_at, "Rewriting the posts") };
  }
  if (plan.status === "ready") {
    if (addDays(plan.week_start, 6) < today) return null;
    const revised = lastRevision(plan);
    if (!revised) return { kind: "planned", line: "Planned" };
    const n = revised.rewritten ?? 0;
    const keptAsWas = keptLine(revised.refused);
    if (keptAsWas) return { kind: "revised", line: `Revised: ${n ? `${n} post${n === 1 ? "" : "s"}` : "no post"} rewritten. ${keptAsWas}` };
    return { kind: "revised", line: n ? `Revised: ${n} post${n === 1 ? "" : "s"} rewritten` : "Revised: nothing was left to rewrite" };
  }
  if (plan.status === "canceled") {
    // A plan removed once it was done had been ready; one stopped on its way never was.
    return plan.ready_at ? { kind: "removed", line: "This week's plan was removed." } : { kind: "stopped", line: "Planning was stopped for this week." };
  }
  return null;
}
