// How long a send to Sprout can still be running, shared by the function that
// sends (schedule-sprout-post/store.ts) and the screens that show a send's
// state (SchedulePostModal.tsx), so both draw the line at the same moment.

/**
 * The longest an edge function can run: Supabase stops every function at its
 * wall-clock limit, 150 s on the Free plan and 400 s on paid plans
 * (supabase.com/docs/guides/functions/limits, read 12 Nov 2026). The longer
 * one is used, so the bound holds on any plan.
 */
export const SEND_RUN_LIMIT_MS = 400_000;

/**
 * Whether the send that wrote a row can still be running. The row is written
 * by that same run, so the run started before created_at and is stopped within
 * SEND_RUN_LIMIT_MS of its start. A row with no readable created_at is taken
 * as still running, which is how the server's created_at filter treats it too.
 */
export function sendCanStillBeRunning(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return !Number.isFinite(at) || now - at < SEND_RUN_LIMIT_MS;
}
