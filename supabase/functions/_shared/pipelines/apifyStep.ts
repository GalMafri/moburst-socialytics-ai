// One Apify actor run inside a pipeline step, as polls: the step starts the
// run and asks to be called back; each call back looks at the run (Apify
// holds the answer up to a minute while the run is still going); once the
// run has succeeded, its whole dataset is read, kept in the payload store,
// and handed to the step.
//
// While APIFY_API_TOKEN is not set the step waits quietly and looks again
// every TOKEN_WAIT_SECONDS, and its step log says what it is waiting for.
// A run that ends without succeeding (failed, timed out, aborted) fails the
// try with StepRestart: the runner's quiet retry (after 2, 4, 8, 16 minutes)
// starts a new run, so a pipeline run starts at most as many actor runs as a
// step has tries (MAX_STEP_ATTEMPTS). A timed-out run may hold part of the
// period, so it never counts as complete coverage.

import { apifyClient, ApifyTokenMissing, APIFY_TOKEN_ENV, isFinalRunStatus, type ApifyClient, type ApifyClientOptions } from "../apify/client.ts";
import { StepRestart, type StepContext, type StepResult } from "./types.ts";

/** How long a step waits before it looks for the token again. */
export const TOKEN_WAIT_SECONDS = 600;
/** How long a step waits before it looks at a run that is still going. */
export const RUN_POLL_SECONDS = 20;
/** Time kept back in a step for reading the dataset and what follows it. */
export const DATASET_RESERVE_SECONDS = 30;

export type ApifyFactory = (o: ApifyClientOptions) => ApifyClient;

export type ActorStep =
  | { type: "wait"; result: StepResult }
  | { type: "rows"; rows: unknown[]; runId: string };

export interface ActorRequest {
  actor: { id: string; name: string; timeoutSecs: number; memoryMbytes: number };
  input: unknown;
  /** Where the raw dataset is kept in the run's payload store. */
  datasetKey: string;
  apify?: ApifyFactory;
}

const secondsLeft = (ctx: StepContext) => Math.floor((ctx.deadline.getTime() - ctx.now().getTime()) / 1000);

export async function runActorStep(ctx: StepContext, r: ActorRequest): Promise<ActorStep> {
  const waitForToken = (): ActorStep => ({
    type: "wait",
    result: {
      type: "poll", waitSeconds: TOKEN_WAIT_SECONDS, handle: { waiting_for: APIFY_TOKEN_ENV },
      detail: { waiting_for: APIFY_TOKEN_ENV, note: `${APIFY_TOKEN_ENV} is not set yet; the step looks again in ${TOKEN_WAIT_SECONDS / 60} minutes.` },
    },
  });
  const token = ctx.env(APIFY_TOKEN_ENV);
  if (!String(token ?? "").trim()) return waitForToken();
  const client = (r.apify ?? apifyClient)({ token, signal: ctx.signal });

  const start = async (): Promise<ActorStep> => {
    const run = await client.startRun(r.actor.id, r.input, { timeoutSecs: r.actor.timeoutSecs, memoryMbytes: r.actor.memoryMbytes });
    return {
      type: "wait",
      result: { type: "poll", waitSeconds: RUN_POLL_SECONDS, handle: { apify_run_id: run.id }, detail: { actor: r.actor.name, apify_run_id: run.id, started: true, try: ctx.attempt } },
    };
  };

  try {
    const runId = typeof ctx.poll?.handle?.apify_run_id === "string" ? ctx.poll.handle.apify_run_id : null;
    if (!runId) return await start();
    const run = await client.getRun(runId, { waitSecs: Math.max(0, Math.min(60, secondsLeft(ctx) - DATASET_RESERVE_SECONDS)) });
    if (!isFinalRunStatus(run.status)) {
      return { type: "wait", result: { type: "poll", waitSeconds: RUN_POLL_SECONDS, handle: { apify_run_id: runId }, detail: { apify_run_id: runId, status: run.status } } };
    }
    if (run.status !== "SUCCEEDED") throw new StepRestart(`Apify run ${runId} ended ${run.status}.`);
    const rows = await client.datasetItems(run.defaultDatasetId);
    await ctx.payloads.put(r.datasetKey, rows);
    return { type: "rows", rows, runId };
  } catch (e) {
    // The token went away between the check above and a call.
    if (e instanceof ApifyTokenMissing) return waitForToken();
    throw e;
  }
}
