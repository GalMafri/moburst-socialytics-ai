// One competitor feed refresh, run in-process by the worker.

import { CLIENT_NOT_TRACKED, LANDSCAPE_MISSING } from "../_shared/competitive/landscapeCheck.ts";
import { FEED_RETRY_MINUTES } from "../_shared/competitive/feedRetry.ts";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";

export { FEED_RETRY_MINUTES };

/** Why a feed job tries again, or ends, when the feed was saved without its LinkedIn posts. */
export const LINKEDIN_NOT_COLLECTED = "LinkedIn posts were not collected.";

export interface FeedDeps {
  now(): Date;
  /**
   * _shared/competitive/refreshFeed.ts, bound to the project's clients and
   * keys. linkedin_not_collected is true when the feed was saved without its
   * LinkedIn posts.
   */
  refreshFeed(clientId: string): Promise<Record<string, unknown> & { linkedin_not_collected?: boolean }>;
}

export async function runFeedJob(job: ScheduledJob, d: FeedDeps): Promise<JobOutcome> {
  if (job.attempts > job.max_attempts) {
    return { status: "failed", reason: `The feed refresh stopped before finishing ${job.attempts - 1} times.` };
  }
  let result: Awaited<ReturnType<FeedDeps["refreshFeed"]>>;
  try {
    result = await d.refreshFeed(job.client_id);
  } catch (e) {
    const err = e as { message?: string; status?: number; code?: string };
    const reason = err?.message ?? String(e);
    // An unconfigured client needs setup, not a failure alert. Only this exact
    // contract is downgraded; a provider error carrying the code is still a failure.
    if (err?.status === 422 && err?.code === CLIENT_NOT_TRACKED) {
      return { status: "skipped", reason, result: { code: err.code } };
    }
    // A linked landscape that disappeared or stopped matching is a break, not
    // setup still to do. It fails at once (retrying cannot bring it back), and
    // the daily status check lists failed jobs, which is what alerts staff.
    if (err?.status === 422 && err?.code === LANDSCAPE_MISSING) {
      return { status: "failed", reason, result: { code: err.code } };
    }
    if (job.attempts >= job.max_attempts) {
      return { status: "failed", reason };
    }
    return { status: "queued", reason, available_at: new Date(d.now().getTime() + FEED_RETRY_MINUTES * 60000).toISOString() };
  }
  // Saved with every other post, without LinkedIn's (its in-app collection
  // stopped or could not start). The saved feed stays as it is; the refresh
  // runs again, LinkedIn included, as a failed one does, and the last
  // attempt ends failed, which the daily status check lists.
  if (result.linkedin_not_collected) {
    if (job.attempts >= job.max_attempts) return { status: "failed", reason: LINKEDIN_NOT_COLLECTED, result };
    return { status: "queued", reason: LINKEDIN_NOT_COLLECTED, available_at: new Date(d.now().getTime() + FEED_RETRY_MINUTES * 60000).toISOString(), result };
  }
  return { status: "done", result };
}
