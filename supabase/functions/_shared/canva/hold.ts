// supabase/functions/_shared/canva/hold.ts
//
// Work that runs past the worker's pass or request (the image model can take
// minutes), one shape for the design worker and the video worker: the job is
// held under a longer lease with its step and state saved, and moves on (its
// step, its state, no error) when the work ends. An error is kept by the
// shared rule (stepError.ts): a busy image model or an unavailable picture
// service waits without using a try, anything else spends one. Free of Deno
// and network imports, so a step can be run through an outage in a test.

import { ACTIVE_JOB, recordStepError, type StepJob, type StepLimits } from "./stepError.ts";

/** The held work, run to its end: what a worker's hold starts in the background. */
export async function heldWork(
  // The Supabase admin client, typed loosely as every worker passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: StepJob,
  work: () => Promise<void>,
  opts: StepLimits & { leaseMs: number },
): Promise<void> {
  // The step is saved too: the steps run before the hold in this pass are not run again.
  await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, lease_until: new Date(Date.now() + opts.leaseMs).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB);
  try {
    await work();
    await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB);
  } catch (e) {
    await recordStepError(admin, job, e, opts);
  }
}
