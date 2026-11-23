// supabase/functions/_shared/higgsfield/renderVideo.ts
//
// Starting a clip, and asking later whether it is done.
//
// Unlike a still, a clip cannot be waited out. Measured on the live account:
// a five-second seedance_2_5 render took about fourteen minutes. Supabase
// kills an edge request at 150 seconds, so anything that blocks on the
// result is guaranteed to die holding a generation nobody can collect, and
// the credits are spent either way. So submission and collection are two
// separate calls with a media_jobs row between them.

import type { CostContext } from "../cost/context.ts";
import { paid } from "../paid/index.ts";
import { higgsfieldMcp } from "./oauth.ts";
import {
  HiggsfieldError,
  VIDEO_MODEL,
  awaitJobs,
  creditBalance,
  submitVideo,
  importReferences,
  videoAspect,
} from "./generate.ts";

/** A clip is 32.5 credits, so the floor sits above one. */
export const VIDEO_CREDIT_FLOOR = 60;

/**
 * What to add to a motion brief when the clip animates a designed still.
 *
 * Measured: given a free hand, the model pushes the camera in hard, and by
 * the last frame the headline has drifted out of shot entirely. The opening
 * frame was perfect and the post was useless. The brief is written for a
 * model that invents a scene; this says the scene already exists and the
 * job is to bring it to life without moving it.
 */
export const HOLD_THE_FRAME =
  "\n\nCRITICAL FRAMING. This is a finished, designed post being brought to life, not a scene to re-shoot. " +
  "Hold the framing exactly as it is: no push in, no pull out, no pan, no tilt, no reframing, no crop. " +
  "Every element stays where it starts, at the same size, for the whole clip. " +
  "Any text in the frame stays completely visible, in its original position, and perfectly legible from the " +
  "first frame to the last: it must never be covered, cropped, blurred, distorted or moved off screen. " +
  "Motion is limited to light, glow, sparkle, and small drifts of secondary decorative objects.";

export interface StartVideoArgs {
  supabase: any;
  /** Who the clip is for: the MCP calls go through the paying desk. */
  cost: CostContext;
  prompt: string;
  aspectRatio: string;
  /** A Higgsfield job id or media id for the still the clip animates. */
  startImageId?: string | null;
  seconds?: number;
  referenceUrls?: string[];
  independentScenes?: boolean;
  resolution?: "480p" | "720p" | "1080p";
}

export interface StartedVideo {
  jobId: string;
  model: string;
  aspect: string;
  creditsBefore: number | null;
}

/** Submit a clip and return at once. Nothing here waits for pixels. */
export async function startVideoWithHiggsfield(args: StartVideoArgs): Promise<StartedVideo> {
  // The token is renewed once if it runs out mid-render (oauth.ts, higgsfieldMcp; QA 22 Nov 2026).
  const mcp = await higgsfieldMcp(args.supabase, args.cost);

  const balance = await creditBalance(mcp);
  if (balance && balance.credits < VIDEO_CREDIT_FLOOR) {
    throw new HiggsfieldError(
      `The Higgsfield account is down to ${Math.floor(balance.credits)} credits and a clip costs about 33, ` +
        `so this video was not started. Top the account up, or switch this client back to the standard video model in Client Setup.`,
    );
  }

  const aspect = videoAspect(args.aspectRatio);
  const referenceIds = args.referenceUrls?.length ? await importReferences(mcp,args.referenceUrls,"image") : [];
  if(args.referenceUrls?.length && referenceIds.length !== args.referenceUrls.length) throw new HiggsfieldError("The client reference images could not be loaded. No video was started.");
  const jobs = await submitVideo(mcp, {
    // The still is the design; the clip must not wander away from it.
    prompt: args.startImageId && !args.independentScenes ? `${args.prompt}${HOLD_THE_FRAME}` : args.prompt,
    aspect,
    referenceIds,
    seconds: args.seconds || 5,
    resolution: args.resolution || "720p",
    startImageId: args.startImageId || undefined,
    model: VIDEO_MODEL,
  });

  return { jobId: jobs[0].job_id, model: VIDEO_MODEL, aspect, creditsBefore: balance?.credits ?? null };
}

export interface JobSnapshot {
  status: "pending" | "running" | "completed" | "failed";
  url: string | null;
  error: string | null;
}

export function videoJobSnapshot(waited:Awaited<ReturnType<typeof awaitJobs>>):JobSnapshot {
  const out=waited.outcomes[0];
  if(!out) throw new HiggsfieldError('Higgsfield returned no status for this saved job.');
  if(out.status==='completed'&&out.result_url) return {status:'completed',url:out.result_url,error:null};
  if(['failed','nsfw','canceled','ip_detected'].includes(out.status)) return {status:'failed',url:null,error:out.error||`Higgsfield reported the clip as ${out.status}.`};
  // A lookup or authentication failure is not evidence that a paid render
  // failed. Preserve the job and surface the collection error for recovery.
  if(out.status==='lookup_failed'||waited.allTerminal) throw new HiggsfieldError(out.error||'Higgsfield could not retrieve this saved job.');
  if(!['pending','waiting','queued','dna','script','visuals','vision','flow','in_progress','ip_detect','running'].includes(out.status)) throw new HiggsfieldError(`Higgsfield returned an unrecognised job status: ${out.status}.`);
  return {status:out.status==='pending'?'pending':'running',url:null,error:null};
}

/**
 * Where one job has got to, right now.
 *
 * timeout_seconds 0 asks for an immediate snapshot rather than a long poll,
 * because the caller here is a browser asking every few seconds, not an
 * agent willing to hold a socket open.
 */
export async function checkVideoJob(supabase: any, jobId: string, cost: CostContext, spent: { model?: string | null; quantities: Record<string, number> }): Promise<JobSnapshot> {
  const mcp = await higgsfieldMcp(supabase, cost);
  const waited = await awaitJobs(mcp, [{ index: 0, job_id: jobId }], { budgetMs: 0, pollSeconds: 0 });
  const snapshot = videoJobSnapshot(waited);
  // The generation is done, so it is paid for: recorded once (a later look at the same job is the same key),
  // in what the caller knows it spent (`spent`), since Higgsfield's answers carry no price.
  if (snapshot.status === "completed") {
    await paid.record(cost, "higgsfield", { resource: waited.outcomes[0]?.model ?? spent.model ?? "unknown", quantities: spent.quantities, providerRef: jobId, idempotencyKey: `higgsfield:${jobId}` });
  }
  return snapshot;
}
