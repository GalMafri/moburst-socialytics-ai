// supabase/functions/_shared/video/clip.ts
//
// The one clip every video post is made with, its live price, and the rule
// that a post's clip is ordered once. The clip's settings are fixed here, so
// the price Higgsfield quotes for the week is the price of the clip that is
// later ordered. Free of Deno and network imports so it can be tested.

import { quoteVideo, VIDEO_MODEL, type ToolCaller, type VideoRequest } from "../higgsfield/generate.ts";
import { CLIP_CREDIT_FLOOR } from "./credits.ts";

/** The settings of every clip: vertical, 8 seconds, 1080p, with sound. */
export const CLIP = { aspect: "9:16", seconds: 8, resolution: "1080p", withAudio: true } as const;

/** The clip's request: the fixed settings, an optional opening frame, and the brand's references (never videos). */
export function clipRequest(prompt: string, startImageId: string | null, referenceIds: string[]): VideoRequest {
  return {
    prompt,
    aspect: CLIP.aspect,
    seconds: CLIP.seconds,
    resolution: CLIP.resolution,
    withAudio: CLIP.withAudio,
    model: VIDEO_MODEL,
    ...(startImageId ? { startImageId } : {}),
    referenceIds,
  };
}

/** The prompt a price is read with; the clip's settings are what set the price. */
export const QUOTE_PROMPT = "A short brand clip.";

/** Higgsfield's live price for one clip, or null when it could not be read. */
export function quoteClip(mcp: ToolCaller): Promise<number | null> {
  return quoteVideo(mcp, clipRequest(QUOTE_PROMPT, null, []));
}

/**
 * Whether a request's price is read at its own click: a generated video
 * (a filmed clip orders no paid clip) that was not handed a price already.
 * A price handed in as null (the press could not read it) is not read again.
 */
export function needsClipPrice(kind: string | null | undefined, footagePath: string | null | undefined, approvedCredits: number | null | undefined): boolean {
  return kind === "video" && !footagePath && approvedCredits === undefined;
}

/** The order recorded on a post's job once its clip is submitted; job_id is missing until Higgsfield answers. */
export interface ClipOrder {
  price: number | null;
  at: string;
  job_id?: string;
}

export type ClipDecision = { action: "order" } | { action: "wait" } | { action: "stop"; reason: string };

/** What the post's staff see when the clip step stops. */
export const REASONS = {
  price: "The video's price went up since it was quoted. Press again to make it at the new price.",
  lostOrder: "The clip's order was lost before it was confirmed. Press again to make it.",
  balance: "The video account is out of credits.",
  provider: "The video service could not make the clip.",
  lost: "The video service did not finish the clip.",
  silent: "The clip came back without sound.",
  writing: "The clip shows writing of its own, so it was not used.",
  frame: "The video's opening shot could not be drawn to the brand's rules.",
  quote: "The video's price could not be read, so the clip was not ordered. Press again later.",
  unquoted: "This video was not priced when it was queued. Press again to make it.",
  outdated: "This video was started before the video update. Press again to make it.",
} as const;

/** The steps of a video job from before the one-clip video (11 Nov); a job found at one ends with REASONS.outdated. */
export const OLD_STEPS = ["references", "references_wait", "footage", "footage_wait", "hook", "hook_check", "compose", "compose_wait", "clean", "clean_wait"] as const;

/** How long the clip step keeps waiting for a readable price before it stops with REASONS.quote. */
export const QUOTE_WAIT_MS = 30 * 60_000;

/**
 * Whether to order the clip now. An order already recorded is never repeated:
 * with a job id the step waits for it, without one the order was lost.
 * A video with no approved price stops at once (it was never quoted); a
 * price that cannot be read yet means wait; a price above the approved one
 * stops; so does a balance below the floor.
 */
export function clipOrderDecision(
  state: { clip_order?: ClipOrder | null },
  approved: number | null,
  live: number | null,
  balance: number | null,
): ClipDecision {
  const order = state.clip_order;
  if (order) return order.job_id ? { action: "wait" } : { action: "stop", reason: REASONS.lostOrder };
  if (approved === null) return { action: "stop", reason: REASONS.unquoted };
  if (live === null) return { action: "wait" };
  if (balance !== null && balance < CLIP_CREDIT_FLOOR) return { action: "stop", reason: REASONS.balance };
  if (live > approved) return { action: "stop", reason: REASONS.price };
  return { action: "order" };
}

/** A clip not back this long after its order is taken as lost (Seedance usually takes 3 to 10 minutes). */
export const CLIP_LOST_MS = 3 * 60 * 60_000;

const ENDED = new Set(["completed", "failed", "nsfw", "canceled", "timed_out"]);

/**
 * Where an ordered clip stands, from the video service's answer about it:
 * ready with its file; failed when it ended any other way; lost when it has
 * not ended CLIP_LOST_MS after the order; else running.
 */
export function clipOutcome(
  o: { status?: string; error?: string | null; result_url?: string | null } | undefined,
  startedAt: number,
  now: number,
): "running" | "ready" | "failed" | "lost" {
  if (o?.status === "completed" && o.result_url) return "ready";
  if (o && (o.error || (o.status && ENDED.has(o.status)))) return "failed";
  return now - startedAt > CLIP_LOST_MS ? "lost" : "running";
}

/**
 * The image edit that draws a video's opening frame: the first moment of its
 * brief as one still, in the look of the kit's stills when they are given,
 * kept to the footage's rules (no writing, no marks, people as the client's
 * videos have them). The clip starts from this frame.
 */
export function framePrompt(brief: string, rules: string): string {
  return [
    "Draw the opening frame of a vertical 9:16 social video: the very first moment of this video, as one photograph.",
    `The video: ${brief.trim()}`,
    "When reference images are given, they are stills from the brand's own videos: match their people, places, products, light, color and grade, without copying any one of them.",
    "The frame is a whole scene that fills the picture edge to edge, with no border, band, panel or empty area.",
    rules.trim(),
  ].join(" ");
}
