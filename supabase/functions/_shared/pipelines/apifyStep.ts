// One Apify actor run inside a pipeline step, as polls: the step starts the
// run and asks to be called back; each call back looks at the run (Apify
// holds the answer up to a minute while the run is still going); once the
// run has succeeded, its whole dataset is read, kept in the payload store,
// and handed to the step.
//
// While APIFY_API_TOKEN is not set the step waits quietly and looks again
// every TOKEN_WAIT_SECONDS, and its step log says what it is waiting for.
// A token Apify refuses (401, or 402 and 403 for an account-level reason) waits
// the same way, and keeps the run it already started. Both waits are marked
// waitingFor, which the runner treats as a state of the run up to the
// pipeline's waitHorizon (a trends run's week end, else the run's own hours):
// no try, no poll limit, no run hours, and the started run's id stays. Past
// the horizon the runner stops the run with that reason. An inline run (the
// feed refresh's LinkedIn source) cannot wait, so it stops after that one look.
// A run that ends without succeeding (failed, timed out, aborted) fails the
// try with StepRestart: the runner's quiet retry (after 2, 4, 8, 16 minutes)
// starts a new run, so a pipeline run starts at most as many actor runs as a
// step has tries (MAX_STEP_ATTEMPTS). A timed-out run may hold part of the
// period, so it never counts as complete coverage.

import { apifyClient, ApifyTokenMissing, ApifyTokenRefused, APIFY_TOKEN_ENV, isFinalRunStatus, type ApifyClient, type ApifyClientOptions } from "../apify/client.ts";
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
  | { type: "rows"; rows: unknown[]; runId: string; usageUsd?: number | null };

export interface ActorRequest {
  /** A timeout or memory left out is the actor's own default (as n8n's Apify node runs the social scrapers). */
  actor: { id: string; name: string; timeoutSecs?: number; memoryMbytes?: number };
  input: unknown;
  /** Where the raw dataset is kept in the run's payload store. */
  datasetKey: string;
  /** How long to keep the dataset (the payload store's default when left out). */
  keepDays?: number;
  apify?: ApifyFactory;
}

const secondsLeft = (ctx: StepContext) => Math.floor((ctx.deadline.getTime() - ctx.now().getTime()) / 1000);

export async function runActorStep(ctx: StepContext, r: ActorRequest): Promise<ActorStep> {
  // A run already started stays in the handle through a token wait, so the
  // step looks at that run once the token works and never starts a second,
  // paid one.
  const startedRun = typeof ctx.poll?.handle?.apify_run_id === "string" ? ctx.poll.handle.apify_run_id : null;
  const waitForToken = (refused = false): ActorStep => ({
    type: "wait",
    result: {
      // waitingFor marks this as a state of the run: the runner spends no try on
      // it and no limit of the run advances while it lasts, up to its horizon.
      // An inline run stops on it at once.
      type: "poll", waitSeconds: TOKEN_WAIT_SECONDS, waitingFor: APIFY_TOKEN_ENV, handle: { waiting_for: APIFY_TOKEN_ENV, ...(startedRun ? { apify_run_id: startedRun } : {}) },
      detail: { waiting_for: APIFY_TOKEN_ENV, note: `${APIFY_TOKEN_ENV} ${refused ? "was refused by Apify" : "is not set yet"}; the step looks again in ${TOKEN_WAIT_SECONDS / 60} minutes.` },
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
    const runId = startedRun;
    if (!runId) return await start();
    const run = await client.getRun(runId, { waitSecs: Math.max(0, Math.min(60, secondsLeft(ctx) - DATASET_RESERVE_SECONDS)) });
    if (!isFinalRunStatus(run.status)) {
      return { type: "wait", result: { type: "poll", waitSeconds: RUN_POLL_SECONDS, handle: { apify_run_id: runId }, detail: { apify_run_id: runId, status: run.status } } };
    }
    if (run.status !== "SUCCEEDED") throw new StepRestart(`Apify run ${runId} ended ${run.status}.`);
    const rows = await client.datasetItems(run.defaultDatasetId);
    await ctx.payloads.put(r.datasetKey, rows, r.keepDays ? { keepDays: r.keepDays } : undefined);
    return { type: "rows", rows, runId, usageUsd: run.usageTotalUsd ?? null };
  } catch (e) {
    // The token went away between the check above, or Apify refused it: the
    // step waits for the account to answer again and spends no try.
    if (e instanceof ApifyTokenMissing) return waitForToken();
    if (e instanceof ApifyTokenRefused) return waitForToken(true);
    throw e;
  }
}
