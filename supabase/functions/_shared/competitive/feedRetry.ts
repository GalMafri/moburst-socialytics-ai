// When a competitor feed refresh is tried again. The feed job retries itself
// (run-scheduled-jobs/feed.ts); a refresh a person started that saved the
// feed without its LinkedIn posts queues that same job, so the same retry and
// end rules apply to it.

/** The wait before a feed refresh is tried again. */
export const FEED_RETRY_MINUTES = 10;

// deno-lint-ignore no-explicit-any
type Db = any;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Queues a feed refresh for the client FEED_RETRY_MINUTES from now: the job
 * the daily enqueue makes (feed_refresh, priority 10, the table's default
 * attempts). Nothing is queued while the client has a feed refresh queued or
 * running, and two calls in the same minute share one key. Never throws: a
 * refresh that could not be queued is logged, and the caller's answer stands.
 */
export async function queueFeedRetry(db: Db, clientId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { data, error } = await db.from("scheduled_jobs").select("id")
      .eq("kind", "feed_refresh").eq("client_id", clientId).in("status", ["queued", "running"]).limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length) return false;
    const at = new Date(now.getTime() + FEED_RETRY_MINUTES * 60_000).toISOString();
    const { error: queueError } = await db.from("scheduled_jobs").upsert(
      { kind: "feed_refresh", client_id: clientId, dedupe_key: `feed:${clientId}:retry:${at.slice(0, 16)}`, priority: 10, available_at: at },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (queueError) throw new Error(queueError.message);
    return true;
  } catch (e) {
    console.warn(`[refresh-competitor-feed] ${clientId}: the feed refresh that collects LinkedIn again was not queued (${message(e)}).`);
    return false;
  }
}
