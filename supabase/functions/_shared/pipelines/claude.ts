// Claude inside a pipeline step, within a step's time and size limits.
//
// The in-app pipelines call Claude through _shared/anthropic.ts (owner's
// decision, 20 Oct 2026). A step has STEP_BUDGET_MS, so:
//   * a call whose answer fits that time runs inline (claudeInline), bounded
//     by max_tokens and cut off by the step's abort signal;
//   * a long analysis runs as its own step (claudeBatchStep): the step
//     queues a one-request message batch and, beside it, has the
//     claude-direct function make the same request directly
//     (claudeDirect.ts), then is called back to look until either answers.
//     The step holds no request open, so the call's length never meets the
//     edge function's limit; the batch has no promise about time, the direct
//     call answers in minutes, and whichever answers first is the answer.
// Either way the answer goes to the payload store, never into the job's
// state, so a long answer never grows the queue row.

import { anthropicMessages } from "../anthropic.ts";
import { CLAUDE_DIRECT_DEADLINE_MS, CLAUDE_DIRECT_FUNCTION, directFailedKey, directKey, type DirectAnswer, type DirectFailure } from "./claudeDirect.ts";
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
/** How often a step looks while a direct call may still answer. */
export const CLAUDE_DIRECT_POLL_SECONDS = 20;
/** Direct calls a step starts for one answer: a second only after the first failed outright. */
export const CLAUDE_DIRECT_STARTS = 2;

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

/** Cancels a batch whose answer is no longer needed, so a request it has not reached is not paid for. */
export async function claudeBatchCancel(a: { apiKey: string; batchId: string; fetchImpl?: Fetch }): Promise<void> {
  const f = a.fetchImpl ?? fetch;
  await f(`${BATCHES}/${encodeURIComponent(a.batchId)}/cancel`, { method: "POST", headers: headers(a.apiKey), signal: AbortSignal.timeout(10_000) });
}

/** Asks for a direct call of the request; resolves once it is under way (claudeDirect.ts). */
export type DirectStarter = (a: { runId: string; saveAs: string; body: Record<string, unknown>; start: number; keepDays?: number }) => Promise<void>;

/**
 * The claude-direct function, when this step runs where it can reach it: the
 * project's address and the operational secret. Elsewhere (tests) there is
 * no direct call, and the step is the batch alone.
 */
export function directThroughFunction(ctx: StepContext, fetchImpl?: Fetch): DirectStarter | null {
  const base = ctx.env("SUPABASE_URL");
  const secret = ctx.env("SOCIALYTICS_N8N_SECRET");
  if (!base || !secret) return null;
  const f = fetchImpl ?? fetch;
  return async ({ runId, saveAs, body, start, keepDays }) => {
    const r = await f(`${base.replace(/\/$/, "")}/functions/v1/${CLAUDE_DIRECT_FUNCTION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret },
      body: JSON.stringify({ run_id: runId, save_as: saveAs, body, start, ...(keepDays ? { keep_days: keepDays } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`${CLAUDE_DIRECT_FUNCTION} did not take the request [${r.status}]`);
  };
}

/**
 * A step that makes one long Claude call. The first time, it queues the
 * request as a one-request message batch and asks for the same request
 * directly (directThroughFunction); then it is called back to look, every
 * CLAUDE_DIRECT_POLL_SECONDS while the direct call may still answer and every
 * CLAUDE_BATCH_POLL_SECONDS after. Whichever answers first is saved as saveAs,
 * once, and the step goes on to next (or finishes the run when next is null);
 * a batch no longer needed is cancelled. A direct call that failed outright is
 * asked for once more; a batch that ends without an answer is queued again, up
 * to CLAUDE_BATCH_RESUBMITS times, after which the step throws StepRestart and
 * the runner's quiet retries take over. A run whose batch was queued before
 * the direct call existed asks for one the next time it looks.
 */
export function claudeBatchStep(o: {
  /** The request and the key, built from the run and the payload store. */
  build(ctx: StepContext): Promise<{ apiKey: string; body: Record<string, unknown> }>;
  saveAs: string;
  /** How long to keep the answer (the payload store's default when left out). */
  keepDays?: number;
  next: string | null;
  fetchImpl?: Fetch;
  /** Tests give their own; null is the batch alone. Left out: the claude-direct function when it can be reached. */
  direct?: DirectStarter | null;
}): Step {
  const counter = `claude_batch_resubmits_${o.saveAs}`;
  return async (ctx): Promise<StepResult> => {
    // A batch request id is 1 to 64 letters, digits, - or _.
    const customId = `${ctx.run.id}_${o.saveAs}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const { apiKey, body } = await o.build(ctx);
    const keep = o.keepDays ? { keepDays: o.keepDays } : undefined;
    const direct = o.direct === undefined ? directThroughFunction(ctx, o.fetchImpl) : o.direct;
    const handle = (ctx.poll?.handle ?? {}) as { claude_batch_id?: unknown; direct_starts?: unknown; direct_started_at?: unknown };
    const batchId = typeof handle.claude_batch_id === "string" ? handle.claude_batch_id : null;
    let starts = Number(handle.direct_starts ?? 0) || 0;
    let startedAt = typeof handle.direct_started_at === "string" ? handle.direct_started_at : null;
    const finish = (detail: Record<string, unknown>): StepResult => (o.next ? { type: "next", step: o.next, detail } : { type: "done", detail });

    // The direct call answered first: it is the answer.
    if (direct) {
      const answer = await ctx.payloads.get<DirectAnswer>(directKey(o.saveAs));
      if (answer && typeof answer.text === "string") {
        const saved = await ctx.payloads.put(o.saveAs, { text: answer.text, stop_reason: answer.stop_reason }, keep);
        if (batchId) await claudeBatchCancel({ apiKey, batchId, fetchImpl: o.fetchImpl }).catch(() => undefined);
        return finish({ saved: saved.key, bytes: saved.bytes, stop_reason: answer.stop_reason, answered_by: "direct", direct_seconds: answer.seconds });
      }
    }

    // Ask for a direct call: the first time, or once more after one failed outright.
    let note: Record<string, unknown> = {};
    if (direct && starts < CLAUDE_DIRECT_STARTS) {
      const failed = starts > 0 ? await ctx.payloads.get<DirectFailure>(directFailedKey(o.saveAs)) : null;
      if (starts === 0 || Number(failed?.start) === starts) {
        starts += 1;
        startedAt = ctx.now().toISOString();
        try {
          await direct({ runId: ctx.run.id, saveAs: o.saveAs, body, start: starts, keepDays: o.keepDays });
          note = { direct: "asked", direct_start: starts, ...(failed ? { direct_failed: failed.message } : {}) };
        } catch (e) {
          // Kept as a failure, so the next look asks once more.
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          await ctx.payloads.put(directFailedKey(o.saveAs), { message, seconds: 0, start: starts } satisfies DirectFailure);
          note = { direct: "not asked", reason: message };
        }
      }
    }
    const directLive = !!startedAt && ctx.now().getTime() - Date.parse(startedAt) < CLAUDE_DIRECT_DEADLINE_MS + 60_000;
    const waitSeconds = directLive ? CLAUDE_DIRECT_POLL_SECONDS : CLAUDE_BATCH_POLL_SECONDS;
    const handleFor = (id: string) => ({ claude_batch_id: id, direct_starts: starts, ...(startedAt ? { direct_started_at: startedAt } : {}) });

    const submit = async (resubmits: number): Promise<StepResult> => {
      const id = await claudeBatchSubmit(ctx, { apiKey, body, customId, fetchImpl: o.fetchImpl });
      return { type: "poll", waitSeconds, handle: handleFor(id), state: { ...ctx.state, [counter]: resubmits }, detail: { claude_batch_id: id, ...note } };
    };
    if (!batchId) return submit(Number(ctx.state[counter] ?? 0));
    const read = await claudeBatchRead(ctx, { apiKey, batchId, customId, saveAs: o.saveAs, keepDays: o.keepDays, fetchImpl: o.fetchImpl });
    if (read.state === "pending") return { type: "poll", waitSeconds, handle: handleFor(batchId), ...(Object.keys(note).length ? { detail: note } : {}) };
    if (read.state === "failed") {
      const resubmits = Number(ctx.state[counter] ?? 0);
      if (resubmits >= CLAUDE_BATCH_RESUBMITS) {
        // A direct call still under way may yet answer; the step waits for it.
        if (directLive) return { type: "poll", waitSeconds, handle: handleFor(batchId), detail: { batch: read.reason, ...note } };
        // The try fails, and the next one queues a new batch rather than reading this one again.
        throw new StepRestart(`Claude batch ${batchId}: ${read.reason}`);
      }
      return submit(resubmits + 1);
    }
    return finish({ saved: read.key, bytes: read.bytes, stop_reason: read.stopReason, answered_by: "batch" });
  };
}
