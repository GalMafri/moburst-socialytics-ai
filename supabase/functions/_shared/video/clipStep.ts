// supabase/functions/_shared/video/clipStep.ts
//
// The clip step: the one paid clip of a video, ordered once. Its services are
// handed in (deps), so the order of its calls can be tested; steps.ts gives it
// Higgsfield and the database. Free of Deno and network imports.
//
// A pass through it, when no order is recorded on the job:
//   1. the live price and the balance are read (at most every pollMs);
//      clipOrderDecision says order, wait or stop;
//   2. the opening frame and the kit's stills are handed to Higgsfield (free;
//      their ids are kept on the job, so a later pass reuses them);
//   3. the job's lease is renewed, so the pass holds the job while it orders;
//   4. the order is recorded on the job's row in one conditional statement
//      (video_clip_order): only one pass ever records it. A pass that finds it
//      recorded orders nothing and leaves the row as the other pass keeps it;
//   5. only then is the clip submitted; its job id is saved at once.
// A pass that finds an order waits for it (clip_wait), or, when the order has
// no job id after ORDER_GRACE_MS, ends the video (REASONS.lostOrder). No pass
// ever returns "next": the clip step always ends its pass.

import type { JobRef } from "../higgsfield/generate.ts";
import { type ClipOrder, QUOTE_WAIT_MS, REASONS, clipOrderDecision, clipRequest, footageRules } from "./clip.ts";
import { withCredits } from "./credits.ts";
import type { VideoJob, VideoStepResult } from "./steps.ts";

export interface ClipDeps {
  /** Higgsfield's live price for the clip, or null when it could not be read. */
  quote(): Promise<number | null>;
  /** The account's credits, or null when they could not be read. */
  balance(): Promise<number | null>;
  /** Hands the frame and/or the kit's stills to Higgsfield; ids of those asked for. */
  importImages(want: { frame: boolean; kit: boolean }): Promise<{ frame?: string | null; kit?: string[] }>;
  /** Submits the clip; its job. */
  submit(req: ReturnType<typeof clipRequest>): Promise<JobRef | undefined>;
  /** Records the order on the job's row only when none is recorded and the job is active (video_clip_order). */
  saveOrder(order: ClipOrder): Promise<boolean>;
  /** Saves the job's step and state. */
  saveJob(): Promise<void>;
  /** Holds the job for another lease. */
  renewLease(): Promise<void>;
  now(): number;
  /** How often an unreadable price is read again. */
  pollMs: number;
}

export async function runClip(deps: ClipDeps, job: VideoJob): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const input = job.input;
  const approved: number | null = input.approved_credits ?? null;
  const now = deps.now();

  // An order already recorded: never priced, imported or submitted again.
  if (s.clip_order) {
    const d = clipOrderDecision(s, approved, null, null, now);
    if (d.action === "stop") throw new Error(`FINAL: ${d.reason}`);
    if (s.clip_order.job_id) job.step = "clip_wait";
    return "wait";
  }

  if (typeof s.quote_checked_at === "number" && now - s.quote_checked_at < deps.pollMs) return "wait";
  const balance = await deps.balance();
  const live = await deps.quote();
  s.quote_checked_at = now;
  const d = clipOrderDecision(s, approved, live, balance, now);
  if (d.action === "stop") throw new Error(`FINAL: ${d.reason}`);
  if (d.action === "wait") {
    // The price could not be read: asked again on later passes, for QUOTE_WAIT_MS.
    if (typeof s.quote_waiting_since !== "number") s.quote_waiting_since = now;
    if (now - s.quote_waiting_since > QUOTE_WAIT_MS) throw new Error(`FINAL: ${REASONS.quote}`);
    return "wait";
  }

  // The free part first: the frame and the kit's stills, kept for any later pass.
  const want = { frame: !s.frame_ref_id, kit: !Array.isArray(s.kit_ref_ids) };
  if (want.frame || want.kit) {
    const got = await deps.importImages(want);
    if (want.kit) s.kit_ref_ids = got.kit ?? [];
    if (want.frame) {
      if (!got.frame) throw new Error("Could not hand the opening frame to the video service.");
      s.frame_ref_id = got.frame;
    }
  }

  // The order is on the job's row before Higgsfield is asked for the clip.
  await deps.renewLease();
  const order: ClipOrder = { price: live, at: new Date(deps.now()).toISOString() };
  if (!(await deps.saveOrder(order))) {
    // Another pass ordered it (or the job was stopped). This pass's state is
    // older than the row's, so it is not saved over it: the row is left as
    // the other pass keeps it.
    return "held";
  }
  s.clip_order = order;

  const prompt = `${input.video.prompt}${footageRules(input.people, input.scene_words ?? [])}`;
  // A failure from here on leaves the order without a job id: later passes
  // wait out ORDER_GRACE_MS and then end the video, never ordering again.
  const first = await deps.submit(clipRequest(prompt, s.frame_ref_id, s.kit_ref_ids));
  if (!first?.job_id) throw new Error("Higgsfield did not start the clip.");
  s.clip_order.job_id = first.job_id;
  s.clip_job = first;
  s.credits = withCredits(s.credits, { what: "footage", job_id: first.job_id, credits: live, at: order.at });
  s.clip_started_at = deps.now();
  s.clip_checked_at = deps.now();
  job.step = "clip_wait";
  // Saved at once: a pass that died before the worker's own save would leave the order without its job id.
  await deps.saveJob();
  return "wait";
}
