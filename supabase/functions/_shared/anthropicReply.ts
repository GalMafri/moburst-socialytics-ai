// supabase/functions/_shared/anthropicReply.ts
//
// What a Messages API reply's limit and stop reason mean for the code that
// asks: how much room a call leaves the model (roomFor), and whether the
// reply that came back is an answer at all (replyStopped, answerText). One
// place, so every call that parses a reply sizes and reads it the same way.
// No imports and no network: the request builders that tests load use it too.
// The call itself is anthropicMessages (anthropic.ts).

/**
 * Room for the model's thinking, in output tokens, on top of a call's answer.
 *
 * The models the app calls think before they answer. Claude Opus 5.5 and
 * Claude Sonnet 5.5 always do (a request that turns thinking off is refused
 * with a 400); Claude Sonnet 5, Claude Opus 5 and Claude Haiku 5.5 do unless
 * a request says otherwise, and no call here says so. The thinking is not
 * returned (a `thinking` block with empty text), and it counts toward
 * `max_tokens` all the same. So a limit sized for the answer alone can be
 * used up by the thinking: the reply stops with stop_reason "max_tokens" and
 * little or no answer text (18 Nov 2026: the read of a logo's place, at 400,
 * came back unreadable for three clients of thirteen).
 *
 * The model is not told the limit, so a larger one changes neither what it
 * writes nor what a finished reply costs: it only decides whether a long
 * think is cut off. The documentation gives no smaller figure for a short
 * answer. It says to size the limit for the thinking as well as the reply,
 * and to start a request that is not streamed at about 16,000. That figure
 * is the room, and each call adds the size of its own answer (roomFor).
 * Nothing here sets `thinking` or `effort`: on these models effort is the
 * only control of how much the model thinks, and changing it would change
 * the answers too.
 *
 * Room is not time. A long think can take minutes, so a call that a person
 * or a leased job waits on also says how long it may take (anthropicMessages,
 * `waitMs`): past that the call ends and reads as no answer, like a reply
 * that was cut off.
 */
export const THINKING_ROOM = 16_000;

/** The `max_tokens` for a call whose answer needs at most `answerTokens`: the answer, and room to think first. */
export function roomFor(answerTokens: number): number {
  return THINKING_ROOM + answerTokens;
}

/**
 * The longest a model call may take while a person waits on the request that
 * makes it. An edge request is ended at about 150 seconds with a gateway
 * error; inside this wait the function still answers in its own words.
 */
export const PERSON_WAIT_MS = 110_000;

/** A reply as these helpers read it: what anthropicMessages returns, or a test's stand-in for it. */
type Reply = { text?: string; stopReason?: string };

/**
 * The stop reason anthropicMessages gives a call that ran out of the time
 * its caller allowed (`waitMs`). It is the helper's own word, never the
 * API's: the reply did not arrive, and there is no text.
 */
export const TIMED_OUT = "timed_out";

/**
 * Why a reply did not finish, or null when it did: "cut_off" when it stopped
 * at its limit (max_tokens, or the model's context window), "refused" when
 * it was declined (HTTP 200 with stop_reason "refusal", and no text or part
 * of one), "timed_out" when the caller's wait ran out first. Such a reply is
 * no answer, whatever text it holds.
 */
export function replyStopped(reply: Reply): "cut_off" | "refused" | "timed_out" | null {
  const stop = String(reply.stopReason ?? "");
  if (stop === "max_tokens" || stop === "model_context_window_exceeded") return "cut_off";
  if (stop === TIMED_OUT) return "timed_out";
  return stop === "refusal" ? "refused" : null;
}

/**
 * The reply's text when the model finished it, and "" when it was cut off,
 * refused or did not arrive in time. A caller that parses this takes the path it already has for a
 * reply it cannot read (its retry, its failure, its "nothing"), so half an
 * answer is never read as a whole one.
 */
export function answerText(reply: Reply): string {
  return replyStopped(reply) ? "" : String(reply.text ?? "");
}

/** The start of a reply for an error message; for a reply that did not finish, what stopped it. */
export function replySample(reply: Reply, chars = 200): string {
  const stopped = replyStopped(reply);
  if (stopped === "cut_off") return "the reply was cut off at its limit";
  if (stopped === "refused") return "the reply was declined";
  if (stopped === "timed_out") return "the reply did not arrive in time";
  return String(reply.text ?? "").slice(0, chars);
}
