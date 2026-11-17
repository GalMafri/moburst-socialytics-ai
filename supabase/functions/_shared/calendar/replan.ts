// supabase/functions/_shared/calendar/replan.ts
//
// Which upcoming posts are written again by the app itself (copy sources, 17
// Nov 2026). A week planned before the copy rules existed may hold posts
// written from an outside post or carrying a list of video chapters, and a week planned
// before one of the client's own accounts was parked was written from two
// brands' material. The client lifecycle (step calendar_recheck) asks for
// one revision of scope "replan" for each such week, and the revision
// (runWeek.ts runWeekRevise) writes again exactly the posts this file names.
// A post a person worked on is never one of them: that is decided where the
// posts are read (calendar_post_worked), not here. Pure, so it can be tested.

import { chapterList, COPY_RULE, citesOutside } from "./copyChecks.ts";

/** The note a replan revision carries, for the plan's own record. The week shows no note for it (src/lib/weekPlanStatus.ts). */
export const REPLAN_NOTE = "Write these posts again from the client's own material.";

/** A week's plan, as the rule reads it (calendar_plans). */
export interface ReplanPlan { ready_at: string | null; evidence: { rules?: unknown } | null; revisions: unknown }
/** A planned post, as the rule reads it (calendar_posts). */
export interface ReplanPost { copy: string | null; reasons: unknown }
export type ReplanWhy = "accounts" | "outside" | "chapters";

const time = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** The rules version a plan was written or last re-planned under; 0 when it carries none. */
export function planRules(plan: ReplanPlan): number {
  const n = Number(plan.evidence?.rules);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** When the plan last followed the client's accounts: ready_at, or a later finished revision of scope "replan". */
export function followedAt(plan: ReplanPlan): number {
  const revisions = (Array.isArray(plan.revisions) ? plan.revisions : []) as Array<{ scope?: unknown; done_at?: unknown; expired?: unknown } | null>;
  const replans = revisions.filter((r) => r?.scope === "replan" && !r.expired).map((r) => time(r!.done_at));
  return Math.max(time(plan.ready_at), ...replans);
}

/**
 * Why a post is written again, or null:
 *   accounts    one of the client's own accounts was parked after the plan
 *               last followed its accounts, so the post was written from an
 *               account that is no longer read;
 *   outside     the plan predates the copy rules and the post's reason cites
 *               an outside post (a trend, a competitor's post or topic);
 *   chapters    the plan predates the copy rules and the copy carries a list
 *               of video chapters, by the definition the copy check uses
 *               (copyChecks.ts chapterList). Clock times, time ranges and
 *               opening hours are no reason to write a post again.
 */
export function replanWhy(post: ReplanPost, plan: ReplanPlan, facts: { ownDroppedAt: string | null }): ReplanWhy | null {
  const dropped = time(facts.ownDroppedAt);
  if (dropped && dropped > followedAt(plan)) return "accounts";
  if (planRules(plan) >= COPY_RULE) return null;
  if (citesOutside(post.reasons)) return "outside";
  return chapterList(String(post.copy ?? "")) ? "chapters" : null;
}
