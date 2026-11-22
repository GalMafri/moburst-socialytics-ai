// supabase/functions/_shared/canva/hold.ts
//
// Work that runs past the worker's pass or request (the image model can take
// minutes), one shape for the design worker and the video worker: the job is
// held under a longer lease with its step and state saved, and moves on (its
// step, its state, no error) when the work ends. An error is kept by the
// shared rule (stepError.ts): a busy image model or an unavailable picture
// service waits without using a try, anything else spends one. Free of Deno
// and network imports, so a step can be run through an outage in a test.
//
// A carousel's slide after the cover is held only while its row is for the
// cover design the run read, and its work lands only then
// (design/coverDesign.ts): when the cover was made again meanwhile, the work
// is dropped and the row runs on from where it was started again.

// QA 22 Nov 2026: the hold is this run's lease, and the run keeps it.
// Taken for a job still active only (any job: a single design, a cover and a
// video too, not only a slide), so work for a job stopped meanwhile is never
// started or paid for. Renewed while the work runs, so no other pass takes a
// job whose run is still at work and pays for the same step again. And the
// end of the work, or its error, lands only while the row still carries this
// run's lease: a run that lost its job to another pass (it died for the
// platform but its work went on) never releases the newer run's lease.

import { forSameCover } from "../design/coverDesign.ts";
import { ACTIVE_JOB, recordStepError, type StepJob, type StepLimits } from "./stepError.ts";

/** How often a held job's lease is renewed while its work runs. */
export const HOLD_RENEW_MS = 60_000;

/** Runs an update of the job's row and says whether it changed the row; for a slide after the cover, only while the row is for the cover design the run read (design/coverDesign.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function changedRow(update: any, job: StepJob): Promise<boolean> {
  const { data, error } = (await forSameCover(update, job).select("id")) ?? {};
  return !error && !!data?.length;
}

/** The held work, run to its end: what a worker's hold starts in the background. */
export async function heldWork(
  // The Supabase admin client, typed loosely as every worker passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: StepJob,
  work: () => Promise<void>,
  opts: StepLimits & { leaseMs: number; renewEveryMs?: number },
): Promise<void> {
  const rows = () => admin.from("canva_finish_jobs");
  const from = job.step;
  let lease = new Date(Date.now() + opts.leaseMs).toISOString();
  // The step is saved too: the steps run before the hold in this pass are not run again.
  const held = await changedRow(rows().update({ step: job.step, state: job.state, lease_until: lease, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB), job);
  // A job stopped meanwhile, or a slide whose row is another cover design's by now: the work is not started, so nothing is paid for it.
  if (!held) return;
  let renewing: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    renewing = renewing.then(async () => {
      const next = new Date(Date.now() + opts.leaseMs).toISOString();
      const renewed = await changedRow(rows().update({ lease_until: next, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB).eq("lease_until", lease), job).catch(() => false);
      if (renewed) lease = next;
    });
  }, opts.renewEveryMs ?? HOLD_RENEW_MS);
  let failure: { e: unknown } | null = null;
  try {
    await work();
  } catch (e) {
    failure = { e };
  } finally {
    clearInterval(timer);
    await renewing;
  }
  if (failure) {
    await recordStepError(admin, job, failure.e, opts, lease);
    return;
  }
  // A step that moved on starts its job's tries again (design/advance.ts).
  const moved = job.step !== from;
  if (moved) job.attempts = 0;
  await forSameCover(rows().update({ step: job.step, state: job.state, error: null, ...(moved ? { attempts: 0 } : {}), lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", job.id).in("status", ACTIVE_JOB).eq("lease_until", lease), job);
}
