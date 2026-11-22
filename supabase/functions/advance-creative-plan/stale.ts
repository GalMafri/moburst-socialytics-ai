// When a creative-plan frame's image job is given up. Free of Deno imports so it can be tested.

/** A job still `pending` this long after it was made never finished being submitted. */
export const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * A `submitted` job whose look-up has kept failing this long after it was
 * made is given up (image renders take minutes). QA 22 Nov 2026 (P37-03): a
 * job Higgsfield could no longer look up (an account linked again, or a
 * "completed" answer with no file) was asked about on every tick, and its
 * frame showed "rendering" for ever.
 */
export const STALE_SUBMITTED_MS = 2 * 60 * 60 * 1000;

/** Whether a submitted job whose look-up just failed is given up. */
export function submittedGivenUp(createdAt: string, now: number): boolean {
  const at = Date.parse(createdAt);
  return Number.isFinite(at) && now - at > STALE_SUBMITTED_MS;
}
