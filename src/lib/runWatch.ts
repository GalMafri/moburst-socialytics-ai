import { STUCK_AFTER_MINUTES } from "@/lib/reportRun";

/**
 * How long a screen keeps checking a run on its own.
 *
 * A competitive run takes up to 90 minutes, and the abandoned-run sweep
 * closes one that has gone quiet for longer than that. A page that is still
 * polling a quarter of an hour after the sweep should have acted is polling
 * for nothing, so it stops and says so instead of spinning for ever.
 */
export const WATCH_LIMIT_MINUTES = STUCK_AFTER_MINUTES + 15;

/** True once a run that started at `startedAt` is past the watch limit. Unknown start times never expire. */
export function watchExpired(startedAt: string | number | null | undefined, now = Date.now(), limitMinutes = WATCH_LIMIT_MINUTES): boolean {
  const started = typeof startedAt === "number" ? startedAt : Date.parse(startedAt || "");
  return Number.isFinite(started) && now - started >= limitMinutes * 60000;
}

/** A react-query refetchInterval: poll while the run is active and inside the watch limit. */
export function watchInterval(active: boolean, startedAt: string | number | null | undefined, intervalMs: number, now = Date.now(), limitMinutes = WATCH_LIMIT_MINUTES): number | false {
  return active && !watchExpired(startedAt, now, limitMinutes) ? intervalMs : false;
}
