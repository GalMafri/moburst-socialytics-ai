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
} as const;

/** How long the clip step keeps waiting for a readable price before it stops with REASONS.quote. */
export const QUOTE_WAIT_MS = 30 * 60_000;

/**
 * Whether to order the clip now. An order already recorded is never repeated:
 * with a job id the step waits for it, without one the order was lost.
 * A price that cannot be read yet means wait; a price above the approved one,
 * or none approved, stops; so does a balance below the floor.
 */
export function clipOrderDecision(
  state: { clip_order?: ClipOrder | null },
  approved: number | null,
  live: number | null,
  balance: number | null,
): ClipDecision {
  const order = state.clip_order;
  if (order) return order.job_id ? { action: "wait" } : { action: "stop", reason: REASONS.lostOrder };
  if (live === null) return { action: "wait" };
  if (balance !== null && balance < CLIP_CREDIT_FLOOR) return { action: "stop", reason: REASONS.balance };
  if (approved === null || live > approved) return { action: "stop", reason: REASONS.price };
  return { action: "order" };
}
