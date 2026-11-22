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

/**
 * Tries of one step before its job fails. A step that moves on starts the
 * next one with all its tries (QA 22 Nov 2026, P53-01: the job's attempts only
 * ever grew, so passing errors anywhere in a video's ten steps added up and
 * four of them ended a video whose title and frame were already paid for).
 */
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
  const triesBefore = job.attempts ?? 0;
  // Each time the step moves on, the job's tries are the new step's: an error
  // later in this pass, or in the hold, counts from that step's first try.
  const run = async () => {
    const at = job.step;
    const result = await runStep(job);
    if (job.step !== at) job.attempts = 0;
    return result;
  };
  try {
    let result = await run();
    while (result === "next" && timeLeft()) result = await run();
    const moved = job.step !== before;
    // A held job is left as its hold saved it (step, state and lease); the hold moves it on when its work ends.
    // Its tries are cleared for its new step only while nothing (the hold's own error) has counted one since.
    if (result === "held") {
      if (moved && triesBefore > 0) await admin.from("canva_finish_jobs").update({ attempts: 0 }).eq("id", job.id).in("status", ACTIVE_JOB).eq("attempts", triesBefore);
      return false;
    }
    const updated_at = new Date().toISOString();
    const tries = moved ? { attempts: 0 } : {};
    if (result === "done") {
      await admin.from("canva_finish_jobs").update({ status: "done", step: job.step, state: job.state, output_path: job.state.final_path, error: null, lease_until: null, updated_at, ...tries }).eq("id", job.id).in("status", ACTIVE_JOB);
      return true;
    }
    await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, lease_until: null, updated_at, ...tries }).eq("id", job.id).in("status", ACTIVE_JOB);
    return moved;
  } catch (e) {
    await recordStepError(admin, job, e, VIDEO_LIMITS);
    return false;
  }
}
