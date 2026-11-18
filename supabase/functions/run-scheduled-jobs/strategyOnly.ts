// supabase/functions/run-scheduled-jobs/strategyOnly.ts
//
// Queued work for a strategy-only client (no active account in Sprout,
// _shared/sprout/strategyOnly.ts) ends quietly. The places that queue work
// already leave such a client out (the daily enqueue, the plan and revision
// requests, the weekly trends enqueue); this is for a job that is in the
// queue anyway: one queued before the client's last account went, or one a
// sweep queued from rows the client already had. The job is skipped with a
// plain reason, as a job is when its plan was stopped or its week is over.
// Nothing it would have written is touched: the plan, the revision that was
// waiting and the trend week stay as they are, and the daily run asks for
// them again once the client is in Sprout.
//
// A report dispatch is not here: it closes its own occurrence (dispatch.ts).
// The client lifecycle, the competitor feed, the voice profile, client notes
// and the strategy's own jobs run for every client.

import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";
import { STRATEGY_ONLY_JOB_REASON } from "../_shared/sprout/strategyOnly.ts";

/** The job kinds that make a client's calendar or collect its weekly trends. */
export const CLOSED_KINDS: ReadonlySet<ScheduledJob["kind"]> = new Set(["week_plan", "week_revise", "trend_refresh"] as const);

/** Run the job, unless it would make a strategy-only client's calendar or trends: then it is skipped, unrun. */
export async function runUnlessStrategyOnly(
  job: ScheduledJob,
  strategyOnly: (clientId: string) => Promise<boolean>,
  run: () => Promise<JobOutcome>,
): Promise<JobOutcome> {
  if (CLOSED_KINDS.has(job.kind) && job.client_id && (await strategyOnly(job.client_id))) {
    return { status: "skipped", reason: STRATEGY_ONLY_JOB_REASON };
  }
  return run();
}
