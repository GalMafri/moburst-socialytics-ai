// One competitor feed refresh, run in-process by the worker.

import { CLIENT_NOT_TRACKED, LANDSCAPE_MISSING } from "../_shared/competitive/landscapeCheck.ts";
import { FEED_RETRY_MINUTES } from "../_shared/competitive/feedRetry.ts";
import { refreshCompetitorFeed } from "../_shared/competitive/refreshFeed.ts";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";

export { FEED_RETRY_MINUTES };

/** Why a feed job tries again, or ends, when the feed was saved without its LinkedIn posts. */
export const LINKEDIN_NOT_COLLECTED = "LinkedIn posts were not collected.";

/** Why a feed job tries again, or ends, when the feed was saved but its topic pass gave no answer. */
export const TOPICS_NOT_DETECTED = "Topics were not detected.";

/**
 * The worker's refreshFeed: refreshCompetitorFeed bound to the project's keys.
 * It forwards the retry's options, so a topic pass runs on its saved snapshot
 * and collects nothing. index.ts and the tests use this one binding.
 */
export const bindRefreshFeed = (
  // deno-lint-ignore no-explicit-any
  db: any,
  keys: { rivaliqKey: string | undefined; secret: string | null | undefined },
  refresh: typeof refreshCompetitorFeed = refreshCompetitorFeed,
): FeedDeps["refreshFeed"] => (clientId, opts) =>
  refresh(db, clientId, { ...keys, by: { actor: "schedule", executionId: opts?.jobId ?? null }, topicsSnapshotId: opts?.topicsSnapshotId });

export interface FeedDeps {
  now(): Date;
  /**
   * _shared/competitive/refreshFeed.ts, bound to the project's clients and
   * keys. linkedin_not_collected is true when the feed was saved without its
   * LinkedIn posts; topics_not_detected is true, with snapshot_id, when it was
   * saved but its topic pass gave no answer. topicsSnapshotId asks for that
   * pass only, on that saved snapshot.
   */
  refreshFeed(clientId: string, opts?: { topicsSnapshotId?: string; jobId?: string }): Promise<Record<string, unknown> & { linkedin_not_collected?: boolean; topics_not_detected?: boolean; snapshot_id?: string | null }>;
}

export async function runFeedJob(job: ScheduledJob, d: FeedDeps): Promise<JobOutcome> {
  if (job.attempts > job.max_attempts) {
    return { status: "failed", reason: `The feed refresh stopped before finishing ${job.attempts - 1} times.` };
  }
  let result: Awaited<ReturnType<FeedDeps["refreshFeed"]>>;
  // A retry of a topic pass carries the snapshot it runs on (this job's payload).
  const pending = job.payload?.topics_snapshot_id;
  try {
    result = typeof pending === "string" && pending ? await d.refreshFeed(job.client_id, { topicsSnapshotId: pending, jobId: job.id }) : await d.refreshFeed(job.client_id, { jobId: job.id });
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
  // Saved, but the model gave no answer for its topics. The retry runs the
  // topic pass again on the saved snapshot, and the last attempt ends failed.
  if (result.topics_not_detected) {
    if (job.attempts >= job.max_attempts) return { status: "failed", reason: TOPICS_NOT_DETECTED, result };
    return {
      status: "queued", reason: TOPICS_NOT_DETECTED, available_at: new Date(d.now().getTime() + FEED_RETRY_MINUTES * 60000).toISOString(), result,
      payload: result.snapshot_id ? { topics_snapshot_id: result.snapshot_id } : null,
    };
  }
  return { status: "done", result, ...(pending ? { payload: null } : {}) };
}
