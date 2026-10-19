// supabase/functions/_shared/lifecycle/policy.ts
//
// When a step of a client's lifecycle runs (Lital, 19 Oct 2026: a self-serve
// app, nothing waits for a person or a developer session). Every step stores
// the inputs it last ran on. It runs again when those inputs change, when its
// result is older than the step's refresh period, or when a failure's retry
// time comes. A step whose input does not exist yet waits for it and shows
// nothing. Free of Deno and network imports so it can be tested.

export type StepStatus = "running" | "done" | "waiting" | "failed";

export interface StepRow {
  client_id: string;
  step: string;
  inputs_key: string | null;
  status: StepStatus;
  attempts: number;
  attempted_at: string | null;
  done_at: string | null;
  next_attempt_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface StepPolicy {
  /** A finished result is refreshed after this many days, with the same inputs. */
  refreshDays?: number;
  /** A wait for more data (too few posts) is looked at again after this many days. */
  recheckDays?: number;
}

export interface Decision {
  due: boolean;
  /** Run even when the stored result looks current (a refresh or a recheck). */
  force: boolean;
  why: "new" | "inputs_changed" | "refresh" | "retry" | "recheck" | "stale_run" | "current" | "no_input" | "running" | "later";
}

const DAY = 86_400_000;
/** A run that has not reported for this long died; the next sweep starts it again. */
export const STALE_RUN_MS = 30 * 60_000;
/** Waits between attempts after a failure, then once a week for as long as it keeps failing. */
export const RETRY_MINUTES = [60, 6 * 60, 24 * 60];
export const LONG_RETRY_MINUTES = 7 * 24 * 60;

export function retryAfterMinutes(attempts: number): number {
  return RETRY_MINUTES[Math.max(0, attempts - 1)] ?? LONG_RETRY_MINUTES;
}

const due = (why: Decision["why"], force = false): Decision => ({ due: true, force, why });
const notDue = (why: Decision["why"]): Decision => ({ due: false, force: false, why });
const passed = (iso: string | null, now: Date) => !iso || Date.parse(iso) <= now.getTime();

export function decide(row: StepRow | null, inputsKey: string | null, policy: StepPolicy, now: Date): Decision {
  if (inputsKey === null) return notDue("no_input");
  if (!row) return due("new");
  if (row.status === "running") {
    return row.attempted_at && now.getTime() - Date.parse(row.attempted_at) > STALE_RUN_MS ? due("stale_run") : notDue("running");
  }
  if (row.inputs_key !== inputsKey) return due("inputs_changed");
  if (row.status === "failed") return passed(row.next_attempt_at, now) ? due("retry", true) : notDue("later");
  if (row.status === "waiting") return row.next_attempt_at && passed(row.next_attempt_at, now) ? due("recheck", true) : notDue("later");
  if (policy.refreshDays && row.done_at && now.getTime() - Date.parse(row.done_at) >= policy.refreshDays * DAY) return due("refresh", true);
  return notDue("current");
}

/** What a step's run came to, as the lifecycle stores it. */
export type StepOutcome =
  | { status: "done"; result: Record<string, unknown> }
  /** Waiting for data: `recheck` days, or until the inputs change when absent. */
  | { status: "waiting"; reason: string; recheckDays?: number; result?: Record<string, unknown> }
  /** A passing failure: tried again later with backoff. `soon` retries in minutes. */
  | { status: "failed"; error: string; soonMinutes?: number };

export function rowAfter(prev: StepRow | null, base: { client_id: string; step: string; inputs_key: string }, outcome: StepOutcome, now: Date): StepRow {
  const at = now.toISOString();
  const sameInputs = prev?.inputs_key === base.inputs_key;
  if (outcome.status === "done") {
    return { ...base, status: "done", attempts: 0, attempted_at: at, done_at: at, next_attempt_at: null, result: outcome.result, error: null };
  }
  if (outcome.status === "waiting") {
    return {
      ...base, status: "waiting", attempts: 0, attempted_at: at, done_at: sameInputs ? prev?.done_at ?? null : null,
      next_attempt_at: outcome.recheckDays ? new Date(now.getTime() + outcome.recheckDays * DAY).toISOString() : null,
      result: { ...(sameInputs ? prev?.result ?? {} : {}), ...(outcome.result ?? {}), waiting_for: outcome.reason }, error: null,
    };
  }
  // A run is marked "running" first; the failure count survives that mark through `error`.
  const attempts = (sameInputs && prev?.error ? prev.attempts : 0) + 1;
  const minutes = outcome.soonMinutes ?? retryAfterMinutes(attempts);
  return {
    ...base, status: "failed", attempts, attempted_at: at, done_at: sameInputs ? prev?.done_at ?? null : null,
    next_attempt_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
    result: sameInputs ? prev?.result ?? null : null, error: outcome.error.slice(0, 500),
  };
}
