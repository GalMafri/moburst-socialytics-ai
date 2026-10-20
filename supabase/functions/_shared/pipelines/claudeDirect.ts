// A long Claude call made beside the step that needs it (20 Oct 2026).
//
// The long analyses (the competitive analysis, the social brief and
// synthesis) used to wait on the Message Batches API alone, which makes no
// promise about time: on 20 Oct two batches were still queued after 50
// minutes while the same request answered in minutes the morning before. n8n
// calls its models directly, so a report made in the app would have been
// slower than n8n's, by hours on a bad day.
//
// So the step (claudeBatchStep in claude.ts) still queues the batch, and also
// asks the claude-direct function to make the same request directly. That
// function answers at once and makes the call as a background task, which
// runs after its answer up to the runtime's wall clock: the call's length
// never meets the scheduled-jobs worker's time, and a function called a few
// times a report starts in a fresh worker with its whole wall clock. What
// came of the call goes to the run's payload store, where the step reads it:
// the answer, or why there is none. Whichever of the two answers first is the
// answer; the other is cancelled or ignored.
//
// pg_net was the other way to make a request outlive a function, and was
// ruled out: on this project (pg_net 0.19.5) a slow request holds back every
// other request until it ends, measured on 20 Oct (a 10 s request delayed one
// that takes under a second), and the scheduler's own calls go through pg_net.

import type { PayloadStore } from "./types.ts";

/** The edge function that makes a direct call. */
export const CLAUDE_DIRECT_FUNCTION = "claude-direct";
/** How long a direct call may run: under the runtime's 400 s wall clock (paid plans), with room to save what came of it. */
export const CLAUDE_DIRECT_DEADLINE_MS = 370_000;

/** Where the direct answer for an answer named saveAs is kept, and where its failure is. */
export const directKey = (saveAs: string) => `${saveAs}.direct`;
export const directFailedKey = (saveAs: string) => `${saveAs}.direct_failed`;

export interface DirectAnswer { text: string; stop_reason: string; seconds: number; start: number }
export interface DirectFailure { message: string; seconds: number; start: number }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const MESSAGES = "https://api.anthropic.com/v1/messages";

/**
 * One Messages API call, streamed so the connection carries data the whole
 * time it runs. Returns every text block joined, as answerText does for a
 * whole message (thinking is left out), and the stop reason. A stream that
 * ends without one, or that carries an error, throws.
 */
export async function claudeStream(a: { apiKey: string; body: Record<string, unknown>; signal: AbortSignal; fetchImpl?: Fetch }): Promise<{ text: string; stopReason: string }> {
  const f = a.fetchImpl ?? fetch;
  const r = await f(MESSAGES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": a.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ ...a.body, stream: true }),
    signal: a.signal,
  });
  if (!r.ok || !r.body) throw new Error(`Claude did not take the request [${r.status}]: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const texts = new Map<number, string>();
  let stopReason = "";
  let rest = "";
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    // Thinking arrives as most of the stream; only the events that matter are parsed.
    if (!/"(?:text_delta|content_block_start|message_delta|error)"/.test(line)) return;
    const e = JSON.parse(line.slice(5)) as {
      type?: string; index?: number;
      content_block?: { type?: string; text?: string };
      delta?: { type?: string; text?: string; stop_reason?: string | null };
      error?: { type?: string; message?: string };
    };
    if (e.type === "error") throw new Error(`Claude stopped the answer: ${e.error?.type ?? "error"} ${e.error?.message ?? ""}`.trim());
    if (e.type === "content_block_start" && e.content_block?.type === "text") texts.set(Number(e.index), e.content_block.text ?? "");
    else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") texts.set(Number(e.index), (texts.get(Number(e.index)) ?? "") + (e.delta.text ?? ""));
    else if (e.type === "message_delta" && e.delta?.stop_reason) stopReason = e.delta.stop_reason;
  };
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (rest + value).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) take(line.trim());
  }
  take(rest.trim());
  if (!stopReason) throw new Error("Claude's answer ended before it was complete.");
  return { text: [...texts.entries()].sort(([x], [y]) => x - y).map(([, t]) => t).join("\n"), stopReason };
}

/**
 * Makes the call and keeps what came of it: the answer as directKey(saveAs),
 * or, when there is none, why, as directFailedKey(saveAs). Never throws, so
 * it can run as a background task with nobody waiting for it.
 */
export async function runClaudeDirect(store: PayloadStore, a: {
  apiKey: string; body: Record<string, unknown>; saveAs: string; start: number; keepDays?: number;
  fetchImpl?: Fetch; now?: () => number; deadlineMs?: number;
}): Promise<void> {
  const now = a.now ?? Date.now;
  const t0 = now();
  const seconds = () => Math.round((now() - t0) / 1000);
  const keep = a.keepDays ? { keepDays: a.keepDays } : undefined;
  try {
    const r = await claudeStream({ apiKey: a.apiKey, body: a.body, signal: AbortSignal.timeout(a.deadlineMs ?? CLAUDE_DIRECT_DEADLINE_MS), fetchImpl: a.fetchImpl });
    const answer: DirectAnswer = { text: r.text, stop_reason: r.stopReason, seconds: seconds(), start: a.start };
    await store.put(directKey(a.saveAs), answer, keep);
  } catch (e) {
    const failure: DirectFailure = { message: (e instanceof Error ? e.message : String(e)).slice(0, 300), seconds: seconds(), start: a.start };
    await store.put(directFailedKey(a.saveAs), failure).catch(() => undefined);
  }
}
