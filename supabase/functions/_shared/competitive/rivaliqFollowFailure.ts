/**
 * What RivalIQ's follow-by-URL operation says when it cannot track a company,
 * as one sentence a person can act on. The provider answers each URL with a
 * status and an `error` that is either a message (the website could not be
 * fetched) or a credits snapshot (the plan's company allowance is used up:
 * `plan` companies allowed, `distinct` in use). Found live on 2026-10-01 when
 * the account reached 40 of 40 and every new landscape stayed empty.
 */
export interface FollowUrlResult { status?: number; error?: unknown }
export interface Credits { plan?: number; distinct?: number; remaining?: number; swaps?: number }

const asCredits = (error: unknown): Credits | null => {
  const data = (error as { data?: { credits?: Credits } } | null)?.data;
  return data && data.credits && typeof data.credits === "object" ? data.credits : null;
};
/** The provider's words for one URL: a plain string, or `code: message` when it answers with a structured error. */
const asMessage = (error: unknown): string | null => {
  if (typeof error === "string") return error;
  const e = error as { message?: unknown; code?: unknown } | null;
  const m = typeof e?.message === "string" ? e.message : null;
  const c = typeof e?.code === "string" ? e.code : null;
  return c && m ? `${c}: ${m}` : c ?? m;
};
const list = (names: string[]) => (names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** names: the company name for each failed URL, in order. */
export function describeFollowFailure(failures: Array<{ name: string; result: FollowUrlResult }>): string {
  const capped = failures.filter((f) => asCredits(f.result.error));
  const blocked = failures.filter((f) => /403|forbidden/i.test(asMessage(f.result.error) ?? ""));
  const other = failures.filter((f) => !capped.includes(f) && !blocked.includes(f));
  const parts: string[] = [];
  if (capped.length) {
    const c = asCredits(capped[0].result.error)!;
    const plan = typeof c.plan === "number" ? c.plan : null;
    const used = typeof c.distinct === "number" ? c.distinct : null;
    parts.push(plan != null && used != null
      ? `RivalIQ's plan tracks ${plan} distinct companies and ${used} are in use, so ${list(capped.map((f) => f.name))} could not be added. Unfollow a company from an old landscape in RivalIQ, or raise the plan.`
      : `RivalIQ's company allowance is used up, so ${list(capped.map((f) => f.name))} could not be added. Unfollow a company from an old landscape in RivalIQ, or raise the plan.`);
  }
  if (blocked.length) parts.push(`${list(blocked.map((f) => f.name))}: the website refused RivalIQ's visit.`);
  for (const f of other) parts.push(`${f.name}: ${(asMessage(f.result.error) ?? JSON.stringify(f.result.error ?? "tracking failed")).slice(0, 200)}`);
  return parts.join(" ") || "RivalIQ could not start tracking the reviewed websites.";
}
