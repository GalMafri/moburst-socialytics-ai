// Claude inside a pipeline step, within a step's time and size limits.
//
// The in-app pipelines call Claude through _shared/anthropic.ts (owner's
// decision, 20 Oct 2026). A step has STEP_BUDGET_MS, so:
//   * a call whose answer fits that time runs inline (claudeInline), bounded
//     by max_tokens and cut off by the step's abort signal;
//   * a long analysis runs as its own step through the Message Batches API
//     (claudeBatchStep): the step submits a one-request batch and is called
//     back to look until the answer is in. No request is held open, so its
//     length never meets the edge function's limit.
// Either way the answer goes to the payload store, never into the job's
// state, so a long answer never grows the queue row.

import { anthropicMessages } from "../anthropic.ts";
import { StepRestart, type Step, type StepContext, type StepResult } from "./types.ts";

/**
 * The most output an inline call may ask for. Conservative for a 110 s step;
 * the step log's durations are what to tune it from.
 */
export const CLAUDE_INLINE_MAX_TOKENS = 8000;
/** How often a step looks at a message batch. */
export const CLAUDE_BATCH_POLL_SECONDS = 60;
/** New batches a step submits after one ended without an answer. */
export const CLAUDE_BATCH_RESUBMITS = 2;

const BATCHES = "https://api.anthropic.com/v1/messages/batches";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const headers = (apiKey: string) => ({ "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" });

export interface SavedAnswer { key: string; bytes: number; stopReason: string }

/** Every text block of a Messages API response, joined (as anthropicMessages reads them). */
export function answerText(message: { content?: Array<{ type?: string; text?: string }> } | null | undefined): string {
  return (message?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
}

/** A Claude call that fits inside one step. The answer is saved as saveAs; a cut answer says so in stopReason. */
export async function claudeInline(ctx: StepContext, a: { apiKey: string; body: Record<string, unknown>; saveAs: string }): Promise<SavedAnswer> {
  const max = Number(a.body.max_tokens);
  if (!(max > 0) || max > CLAUDE_INLINE_MAX_TOKENS) {
    throw new Error(`An inline Claude call asks for at most ${CLAUDE_INLINE_MAX_TOKENS} output tokens; a longer one runs as a message batch (claudeBatchStep).`);
  }
  const r = await anthropicMessages({ apiKey: a.apiKey, body: a.body, signal: ctx.signal });
  const saved = await ctx.payloads.put(a.saveAs, { text: r.text, stop_reason: r.stopReason });
  return { ...saved, stopReason: r.stopReason };
}

/** Submits a one-request message batch. */
export async function claudeBatchSubmit(ctx: StepContext, a: { apiKey: string; body: Record<string, unknown>; customId: string; fetchImpl?: Fetch }): Promise<string> {
  const f = a.fetchImpl ?? fetch;
  const r = await f(BATCHES, { method: "POST", headers: headers(a.apiKey), body: JSON.stringify({ requests: [{ custom_id: a.customId, params: a.body }] }), signal: ctx.signal });
  if (!r.ok) throw new Error(`Claude batch was not accepted [${r.status}]: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const batch = await r.json() as { id?: string };
  if (!batch.id) throw new Error("Claude batch answer had no id.");
  return batch.id;
}

export type BatchRead = { state: "pending" } | ({ state: "done" } & SavedAnswer) | { state: "failed"; reason: string };

/** Looks at a batch; once it ended, saves its answer as saveAs. */
export async function claudeBatchRead(ctx: StepContext, a: { apiKey: string; batchId: string; customId: string; saveAs: string; keepDays?: number; fetchImpl?: Fetch }): Promise<BatchRead> {
  const f = a.fetchImpl ?? fetch;
  const r = await f(`${BATCHES}/${encodeURIComponent(a.batchId)}`, { headers: headers(a.apiKey), signal: ctx.signal });
  if (!r.ok) throw new Error(`Claude batch could not be read [${r.status}].`);
  const batch = await r.json() as { processing_status?: string; results_url?: string | null };
  if (batch.processing_status !== "ended") return { state: "pending" };
  if (!batch.results_url) return { state: "failed", reason: "the batch ended with no results" };
  const res = await f(batch.results_url, { headers: headers(a.apiKey), signal: ctx.signal });
  if (!res.ok) throw new Error(`Claude batch results could not be read [${res.status}].`);
  // JSONL, one line per request, in any order.
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { custom_id?: string; result?: { type?: string; message?: { content?: Array<{ type?: string; text?: string }>; stop_reason?: string }; error?: unknown } };
    if (row.custom_id !== a.customId) continue;
    if (row.result?.type !== "succeeded") return { state: "failed", reason: `the request ${row.result?.type ?? "had no result"}` };
    const stopReason = String(row.result.message?.stop_reason ?? "");
    const saved = await ctx.payloads.put(a.saveAs, { text: answerText(row.result.message), stop_reason: stopReason }, a.keepDays ? { keepDays: a.keepDays } : undefined);
    return { state: "done", ...saved, stopReason };
  }
  return { state: "failed", reason: "the batch has no result for this request" };
}

/**
 * A step that makes one long Claude call as a message batch: it submits the
 * request, is called back every CLAUDE_BATCH_POLL_SECONDS until the answer is
 * saved as saveAs, then goes on to next (or finishes the run when next is
 * null). A batch that ends without an answer is submitted again, up to
 * CLAUDE_BATCH_RESUBMITS times; after that the step throws StepRestart and
 * the runner's quiet retries take over, each submitting a new batch.
 */
export function claudeBatchStep(o: {
  /** The request and the key, built from the run and the payload store. */
  build(ctx: StepContext): Promise<{ apiKey: string; body: Record<string, unknown> }>;
  saveAs: string;
  /** How long to keep the answer (the payload store's default when left out). */
  keepDays?: number;
  next: string | null;
  fetchImpl?: Fetch;
}): Step {
  const counter = `claude_batch_resubmits_${o.saveAs}`;
  return async (ctx): Promise<StepResult> => {
    // A batch request id is 1 to 64 letters, digits, - or _.
    const customId = `${ctx.run.id}_${o.saveAs}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const { apiKey, body } = await o.build(ctx);
    const submit = async (resubmits: number): Promise<StepResult> => {
      const batchId = await claudeBatchSubmit(ctx, { apiKey, body, customId, fetchImpl: o.fetchImpl });
      return { type: "poll", waitSeconds: CLAUDE_BATCH_POLL_SECONDS, handle: { claude_batch_id: batchId }, state: { ...ctx.state, [counter]: resubmits }, detail: { claude_batch_id: batchId } };
    };
    const batchId = typeof ctx.poll?.handle?.claude_batch_id === "string" ? ctx.poll.handle.claude_batch_id : null;
    if (!batchId) return submit(Number(ctx.state[counter] ?? 0));
    const read = await claudeBatchRead(ctx, { apiKey, batchId, customId, saveAs: o.saveAs, keepDays: o.keepDays, fetchImpl: o.fetchImpl });
    if (read.state === "pending") return { type: "poll", waitSeconds: CLAUDE_BATCH_POLL_SECONDS, handle: { claude_batch_id: batchId } };
    if (read.state === "failed") {
      const resubmits = Number(ctx.state[counter] ?? 0);
      // The try fails, and the next one submits a new batch rather than reading this one again.
      if (resubmits >= CLAUDE_BATCH_RESUBMITS) throw new StepRestart(`Claude batch ${batchId}: ${read.reason}`);
      return submit(resubmits + 1);
    }
    const detail = { saved: read.key, bytes: read.bytes, stop_reason: read.stopReason };
    return o.next ? { type: "next", step: o.next, detail } : { type: "done", detail };
  };
}
