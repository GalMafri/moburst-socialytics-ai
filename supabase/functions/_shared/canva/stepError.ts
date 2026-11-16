// supabase/functions/_shared/canva/stepError.ts
//
// What a step's error does to its job (canva_finish_jobs), one rule for the
// design worker and the video worker (12 Nov 2026, final review of the
// picture service). Something the job cannot do anything about right now,
// the image model at its rate limit or the picture service unavailable
// (busy, down or slow after its one retry, or the database unable to open
// or check the call), is a wait: the reason is kept on the job, its lease is
// released and no try is spent, so the next pass tries again. Any other error spends a try; the
// job fails on its last try or on a FINAL: reason.
//
// A wait has an end. A job of a request ends with its request, at the
// request's 90-minute limit (REQUEST_MAX_MINUTES, endOverdueRequests). A job
// with no request (the job that reads a client's video style and makes its
// kit) has no request to end it, so the same limit is counted from the
// job's own start: still waiting after it, the job fails with the reason.
// Nothing is stored for the client then, so the kit is made by the next
// video that needs it.
//
// Whatever the error does, the job's step is saved with its state: the two
// are one record of where the job is. (Saved without its step, a job whose
// title was drawn and paid for went back to the title step when the title's
// check could not reach the picture service, and paid for another.)

import { ModelBusy } from "../media/modelBusy.ts";
import { PictureError } from "../picture/client.ts";
import { REQUEST_MAX_MINUTES } from "../design/requestRules.ts";

/** A job is only ever moved on while it is active: a job stopped meanwhile stays stopped. */
export const ACTIVE_JOB = ["queued", "running"];

/** True when the error is a wait (busy image model, unavailable picture service), never a spent try. */
export function waitsOut(e: unknown): boolean {
  return e instanceof ModelBusy || (e instanceof PictureError && e.transient);
}

export type StepJob = { id: string; step: string; attempts?: number; state: unknown; design_request_id?: string | null; created_at?: string | null };

/** True when a job's wait has outlasted its limit: only a job with no request has one of its own, REQUEST_MAX_MINUTES from its start. */
export function waitOver(job: Pick<StepJob, "design_request_id" | "created_at">, now: number): boolean {
  if (job.design_request_id) return false;
  const made = typeof job.created_at === "string" ? Date.parse(job.created_at) : NaN;
  return Number.isFinite(made) && now - made > REQUEST_MAX_MINUTES * 60_000;
}

/** A worker's limits for its jobs: tries of one job before it fails, and the worker's name for its log lines. */
export type StepLimits = { maxAttempts: number; worker: string };

/** The step's error kept on its job: a wait, a try spent with the job still running, or the job failed. */
export async function recordStepError(
  // The Supabase admin client, typed loosely as every worker passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: StepJob,
  e: unknown,
  opts: StepLimits,
): Promise<"wait" | "retry" | "failed"> {
  const msg = e instanceof Error ? e.message : String(e);
  const now = Date.now();
  const updated_at = new Date(now).toISOString();
  const jobs = () => admin.from("canva_finish_jobs");
  const waits = waitsOut(e);
  if (waits && !waitOver(job, now)) {
    console.warn(`[${opts.worker}] job ${job.id} step ${job.step} waits:`, msg);
    await jobs().update({ step: job.step, state: job.state, error: msg, lease_until: null, updated_at }).eq("id", job.id).in("status", ACTIVE_JOB);
    return "wait";
  }
  // A wait that outlasted its limit ends the job with the reason, and is still no spent try.
  const attempts = (job.attempts ?? 0) + (waits ? 0 : 1);
  const failed = waits || attempts >= opts.maxAttempts || msg.startsWith("FINAL:");
  const error = waits ? `Still waiting after ${REQUEST_MAX_MINUTES} minutes: ${msg}` : msg.replace(/^FINAL:\s*/, "");
  console.error(`[${opts.worker}] job ${job.id} step ${job.step}:`, error);
  await jobs().update({ attempts, step: job.step, state: job.state, error, status: failed ? "failed" : "running", lease_until: null, updated_at }).eq("id", job.id).in("status", ACTIVE_JOB);
  return failed ? "failed" : "retry";
}
