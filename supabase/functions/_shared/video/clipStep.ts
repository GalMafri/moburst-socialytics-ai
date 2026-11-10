// supabase/functions/_shared/video/clipStep.ts
//
// The clip step: the one paid clip of a video, ordered once. Its services are
// handed in (deps), so the order of its calls can be tested; steps.ts gives it
// Higgsfield and the database. Free of Deno and network imports.
//
// The order is not in the job's state: it lives in its own column
// (canva_finish_jobs.clip_order), read fresh at the start of every pass and
// written only by fenced statements (20261111130300_video_clip_order.sql), so
// no whole-state save by any pass can erase it. A pass with no order:
//   1. reads the live price and the balance (at most every pollMs);
//      clipOrderDecision says order, wait or stop. A stop fails the job only
//      while it holds no order (video_clip_stop); refused, another pass
//      ordered meanwhile, and this pass leaves the row alone ("held");
//   2. renews the job's lease, then hands the opening frame and the kit's
//      stills to Higgsfield (free; their ids are kept in state for later passes);
//   3. places the order (video_clip_order): only one pass ever does; a pass
//      that cannot leaves the row alone ("held");
//   4. only then submits the clip, and records its job id and credits on the
//      order (video_clip_ordered).
// A pass that finds an order waits for it (clip_wait), or, when the order has
// no job id after ORDER_GRACE_MS, ends the video (REASONS.lostOrder, fenced
// the same way). No pass ever returns "next": the clip step ends its pass.

import type { JobRef } from "../higgsfield/generate.ts";
import { type ClipOrder, QUOTE_WAIT_MS, REASONS, clipOrderDecision, clipRequest, footageRules } from "./clip.ts";
import type { VideoJob, VideoStepResult } from "./steps.ts";

export interface ClipDeps {
  /** The job's order column, read fresh from the database (null when it holds none). */
  readOrder(jobId: string): Promise<ClipOrder | null>;
  /** Higgsfield's live price for the clip, or null when it could not be read. */
  quote(): Promise<number | null>;
  /** The account's credits, or null when they could not be read. */
  balance(): Promise<number | null>;
  /** Hands the frame and/or the kit's stills to Higgsfield; ids of those asked for. */
  importImages(want: { frame: boolean; kit: boolean }): Promise<{ frame?: string | null; kit?: string[] }>;
  /** Submits the clip; its job. */
  submit(req: ReturnType<typeof clipRequest>): Promise<JobRef | undefined>;
  /** Places the order only while the job is active and holds none (video_clip_order). */
  saveOrder(order: ClipOrder): Promise<boolean>;
  /** Adds the job id and credits to an order that has none (video_clip_ordered). */
  saveOrdered(jobId: string, credits: number | null): Promise<boolean>;
  /** Fails the job with the reason only while it holds no live order (video_clip_stop). */
  stopJob(reason: string): Promise<boolean>;
  /** Saves the job's step and state. */
  saveJob(): Promise<void>;
  /** Holds the job for another lease. */
  renewLease(): Promise<void>;
  now(): number;
  /** How often an unreadable price is read again. */
  pollMs: number;
  /** Waits between tries of recording a paid clip's job id (a timer when not given). */
  pause?(ms: number): Promise<void>;
}

/** Tries of recording a paid clip's job id, and the pause between them. */
export const ORDERED_TRIES = 3;
export const ORDERED_PAUSE_MS = 1_000;

/** The paid clip's job id recorded on its order, tried again on an error; the last error names the id, so the job's error keeps it. */
async function recordOrdered(deps: ClipDeps, job: VideoJob, jobId: string, credits: number | null): Promise<void> {
  const pause = deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 1; i <= ORDERED_TRIES; i++) {
    try {
      // false: the id is already on the order, which is what this wants.
      if (!(await deps.saveOrdered(jobId, credits))) console.warn(`[video-worker] job ${job.id}: the clip's job id was already recorded.`);
      return;
    } catch (e) {
      last = e;
      if (i < ORDERED_TRIES) await pause(ORDERED_PAUSE_MS);
    }
  }
  const why = last instanceof Error ? last.message : String(last);
  throw new Error(`The clip was ordered as video job ${jobId}, but its id could not be recorded: ${why}`);
}

/** The job ended with the reason, unless an order stands in the way: then the row is left to the pass that placed it. */
async function stop(deps: ClipDeps, reason: string): Promise<VideoStepResult> {
  if (!(await deps.stopJob(reason))) return "held";
  // Already failed in the database; the worker's own failure write finds it inactive and changes nothing.
  throw new Error(`FINAL: ${reason}`);
}

export async function runClip(deps: ClipDeps, job: VideoJob): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const input = job.input;
  const approved: number | null = input.approved_credits ?? null;
  const now = deps.now();

  // Never this pass's copy: another pass may have ordered since this job was read.
  const placed = await deps.readOrder(job.id);
  job.clip_order = placed;
  if (placed) {
    const d = clipOrderDecision(placed, approved, null, null, now);
    if (d.action === "stop") return stop(deps, d.reason);
    if (placed.job_id) job.step = "clip_wait";
    return "wait";
  }

  if (typeof s.quote_checked_at === "number" && now - s.quote_checked_at < deps.pollMs) return "wait";
  const balance = await deps.balance();
  const live = await deps.quote();
  s.quote_checked_at = now;
  const d = clipOrderDecision(null, approved, live, balance, now);
  if (d.action === "stop") return stop(deps, d.reason);
  if (d.action === "wait") {
    // The price could not be read: asked again on later passes, for QUOTE_WAIT_MS.
    if (typeof s.quote_waiting_since !== "number") s.quote_waiting_since = now;
    if (now - s.quote_waiting_since > QUOTE_WAIT_MS) return stop(deps, REASONS.quote);
    return "wait";
  }

  // Held for the order, then the free part: the frame and the kit's stills, kept for any later pass.
  await deps.renewLease();
  const want = { frame: !s.frame_ref_id, kit: !Array.isArray(s.kit_ref_ids) };
  if (want.frame || want.kit) {
    const got = await deps.importImages(want);
    if (want.kit) s.kit_ref_ids = got.kit ?? [];
    if (want.frame) {
      if (!got.frame) throw new Error("Could not hand the opening frame to the video service.");
      s.frame_ref_id = got.frame;
    }
  }

  const order: ClipOrder = { price: live, at: new Date(deps.now()).toISOString() };
  // Another pass placed it (or the job was stopped): nothing is submitted, and this pass's older state is not saved.
  if (!(await deps.saveOrder(order))) return "held";
  job.clip_order = order;

  const prompt = `${input.video.prompt}${footageRules(input.people, input.scene_words ?? [])}`;
  // A failure from here on leaves the order without a job id: later passes
  // wait out ORDER_GRACE_MS and then end the video, never ordering again.
  const first = await deps.submit(clipRequest(prompt, s.frame_ref_id, s.kit_ref_ids));
  if (!first?.job_id) throw new Error("The video service did not start the clip.");
  await recordOrdered(deps, job, first.job_id, live);
  job.clip_order = { ...order, job_id: first.job_id, credits: live };
  s.clip_started_at = deps.now();
  s.clip_checked_at = deps.now();
  job.step = "clip_wait";
  await deps.saveJob();
  return "wait";
}
