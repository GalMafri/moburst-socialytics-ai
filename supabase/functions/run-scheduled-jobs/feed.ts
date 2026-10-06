// One competitor feed refresh, run in-process by the worker.

import type { JobOutcome, ScheduledJob } from "./types.ts";

export const FEED_RETRY_MINUTES = 10;

export interface FeedDeps {
  now(): Date;
  /** _shared/competitive/refreshFeed.ts, bound to the project's clients and keys. */
  refreshFeed(clientId: string): Promise<Record<string, unknown>>;
}

export async function runFeedJob(job: ScheduledJob, d: FeedDeps): Promise<JobOutcome> {
  if (job.attempts > job.max_attempts) {
    return { status: "failed", reason: `The feed refresh stopped before finishing ${job.attempts - 1} times.` };
  }
  try {
    return { status: "done", result: await d.refreshFeed(job.client_id) };
  } catch (e) {
    const err = e as { message?: string; status?: number; code?: string };
    const reason = err?.message ?? String(e);
    // An unconfigured client needs setup, not a failure alert. Only this exact
    // contract is downgraded; a provider error carrying the code is still a failure.
    if (err?.status === 422 && err?.code === "RIVALIQ_CLIENT_NOT_TRACKED") {
      return { status: "skipped", reason, result: { code: err.code } };
    }
    if (job.attempts >= job.max_attempts) {
      return { status: "failed", reason };
    }
    return { status: "queued", reason, available_at: new Date(d.now().getTime() + FEED_RETRY_MINUTES * 60000).toISOString() };
  }
}
