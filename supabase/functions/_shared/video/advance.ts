// supabase/functions/_shared/video/advance.ts
//
// One due video job in a pass of the video worker: its steps run one after
// another until one waits, is held or the pass's time is up, and then the
// job's step and state are saved together. An error is kept by the shared
// rule (canva/stepError.ts), which saves the step with the state too, so a
// step that ran before the one that failed (a title drawn and paid for
// before its check) is never run again. Free of Deno and network imports,
// so a job can be run through an outage in a test; steps.ts gives it the steps.

import { ACTIVE_JOB, recordStepError, type StepLimits } from "../canva/stepError.ts";
import type { VideoJob, VideoStepResult } from "./steps.ts";

/** Tries of one step before its job fails. */
export const MAX_VIDEO_ATTEMPTS = 4;
/** The video worker's limits for the shared step-error rule and the hold. */
export const VIDEO_LIMITS: StepLimits = { maxAttempts: MAX_VIDEO_ATTEMPTS, worker: "video-worker" };

/**
 * The job's steps for this pass. Returns whether the job moved on (a held job
 * is not counted: a busy image model must not keep passes from their idle
 * pause).
 */
export async function advanceVideoJob(
  // The Supabase admin client, typed loosely as every worker passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: VideoJob & { attempts?: number },
  runStep: (job: VideoJob) => Promise<VideoStepResult>,
  timeLeft: () => boolean,
): Promise<boolean> {
  job.state = job.state ?? {};
  const before = job.step;
  try {
    let result = await runStep(job);
    while (result === "next" && timeLeft()) result = await runStep(job);
    // A held job is left as its hold saved it (step, state and lease); the hold moves it on when its work ends.
    if (result === "held") return false;
    const updated_at = new Date().toISOString();
    if (result === "done") {
      await admin.from("canva_finish_jobs").update({ status: "done", step: job.step, state: job.state, output_path: job.state.final_path, error: null, lease_until: null, updated_at }).eq("id", job.id).in("status", ACTIVE_JOB);
      return true;
    }
    await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, lease_until: null, updated_at }).eq("id", job.id).in("status", ACTIVE_JOB);
    return job.step !== before;
  } catch (e) {
    await recordStepError(admin, job, e, VIDEO_LIMITS);
    return false;
  }
}
