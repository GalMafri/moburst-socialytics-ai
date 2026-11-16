// supabase/functions/_shared/design/advance.ts
//
// One design job in a request of its own (design-worker, action "advance"):
// its steps run one after another until one waits, is held or the request's
// time is up, and its step and state are saved together after each. An error
// is kept by the shared rule (canva/stepError.ts). Free of Deno and network
// imports, so a job can be run through an outage in a test; the worker gives
// it the steps.

import { ACTIVE_JOB, recordStepError, type StepJob, type StepLimits } from "../canva/stepError.ts";

/** next: run the following step now; wait: a later pass; held: work continues in the background under its lease; done. */
export type StepResult = "next" | "wait" | "held" | "done";

/** Tries of one job before it fails. */
export const MAX_DESIGN_ATTEMPTS = 4;
/** The design worker's limits for the shared step-error rule and the hold. */
export const DESIGN_LIMITS: StepLimits = { maxAttempts: MAX_DESIGN_ATTEMPTS, worker: "design-worker" };

/** A job that has nothing left to do because its option is over: it stops, which is not a failure of its own. */
export class Stopped extends Error {}

/** The job's steps until it waits, is held or is done. */
export async function advanceDesignJob(
  // The Supabase admin client, typed loosely as every worker passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: StepJob & { state: any },
  runStep: () => Promise<StepResult>,
  timeLeft: () => boolean,
): Promise<void> {
  const jobs = () => admin.from("canva_finish_jobs");
  try {
    let result: StepResult = "next";
    while (result === "next" && timeLeft()) {
      result = await runStep();
      if (result !== "held") {
        await jobs().update({ step: job.step, state: job.state, error: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB);
      }
    }
    if (result === "done") {
      await jobs().update({ status: "done", step: "finished", output_path: job.state.final_path, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB);
    } else if (result !== "held") {
      await jobs().update({ lease_until: null }).eq("id", job.id).in("status", ACTIVE_JOB);
    }
  } catch (e) {
    if (e instanceof Stopped) {
      await jobs().update({ status: "canceled", error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE_JOB);
    } else {
      await recordStepError(admin, job, e, DESIGN_LIMITS);
    }
  }
}
