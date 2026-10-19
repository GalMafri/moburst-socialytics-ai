// A person's own request that does not get through is sent again quietly,
// with growing waits, before anything changes on screen (self-serve design,
// rule 7, 19 Oct 2026: nothing fails visibly). What a screen shows after that
// is the true state of the thing: saved or not saved yet, scheduled or not
// scheduled yet, uploaded or not uploaded yet. Never a failure message.

import { safeToResend } from "@/lib/invokeError";

/** Waits between tries: 1, 3, then 9 seconds. */
export const QUIET_WAITS_MS = [1_000, 3_000, 9_000];

type Reply = { error: unknown };

const statusOf = (error: unknown) => (error as { context?: { status?: unknown } } | null)?.context?.status;

/**
 * An edge function call worth sending again. Always when it never reached
 * the work (no connection, a busy gateway, a rate limit). For work the server
 * answers once however often it is asked (queueing a run, saving copy), also
 * when the server itself failed.
 */
export function invokeResendable(error: unknown, opts: { idempotent?: boolean } = {}): boolean {
  if (!error) return false;
  if (safeToResend(error)) return true;
  if (!opts.idempotent) return false;
  const status = statusOf(error);
  return typeof status !== "number" || status >= 500;
}

/**
 * A database write worth sending again: no answer at all, a dropped
 * connection, a deadlock or a busy server. A refusal (a rule, a constraint)
 * would only be refused again.
 */
export function writeResendable(error: unknown): boolean {
  const e = error as { code?: unknown } | null;
  if (!e) return false;
  const code = typeof e.code === "string" ? e.code : "";
  if (/^PGRST/.test(code)) return ["PGRST000", "PGRST001", "PGRST002"].includes(code);
  if (/^[0-9A-Z]{5}$/.test(code)) return code.startsWith("08") || ["40001", "40P01", "57P01", "57P03", "53300"].includes(code);
  return true;
}

/**
 * Send, and send again quietly while `again` says the reply is worth
 * another try. Resolves with the last reply; a thrown call becomes a reply
 * with that error.
 */
export async function sendQuietly<T extends Reply>(
  send: () => PromiseLike<T>,
  opts: { again?: (error: unknown) => boolean; waits?: number[]; wait?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const waits = opts.waits ?? QUIET_WAITS_MS;
  const again = opts.again ?? ((e: unknown) => invokeResendable(e));
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    let reply: T;
    try {
      reply = await send();
    } catch (e) {
      reply = { error: e } as T;
    }
    if (!reply.error || attempt >= waits.length || !again(reply.error)) return reply;
    await wait(waits[attempt]);
  }
}

/** A storage upload, sent again quietly: an upload of the same file to the same path can always be repeated. */
export function uploadQuietly<T extends Reply>(send: () => PromiseLike<T>, opts: { waits?: number[]; wait?: (ms: number) => Promise<void> } = {}): Promise<T> {
  return sendQuietly(send, { ...opts, again: (e) => {
    const status = Number((e as { statusCode?: unknown; status?: unknown } | null)?.statusCode ?? (e as { status?: unknown } | null)?.status);
    // A file the bucket refuses (too large, wrong type) is refused again; everything else is tried again.
    return !(status === 400 || status === 413 || status === 415 || status === 403);
  } });
}
