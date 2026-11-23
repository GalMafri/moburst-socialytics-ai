// supabase/functions/_shared/anthropic.ts
//
// One way of calling the Messages API that survives a model change.
//
// Two things have broken here before, both of them the same shape — code
// written against the model of the day:
//   * `temperature: 0` was fine for years and is a hard 400 on Claude 5
//     ("temperature is deprecated for this model"), which took competitor
//     identification down;
//   * reading `content[0].text` was fine until a response led with a
//     non-text block, which produced "No JSON in model response" while the
//     model had in fact answered;
//   * a trailing assistant turn ("JSON prefill") shaped replies for years and
//     is refused by Claude 5 — "This model does not support assistant message
//     prefill. The conversation must end with a user message."
// So: a rejected parameter is dropped and the call retried, a refused prefill
// is folded into the user turn as an instruction and the call retried, and
// every text block is read. None of it depends on which model is current.

import { replyStopped, TIMED_OUT } from "./anthropicReply.ts";
import { wellFormedBody } from "./text/clip.ts";
import type { CostContext } from "./cost/context.ts";
import { paid } from "./paid/index.ts";

/**
 * fetch for the Anthropic API, and the one place a function reaches it: `path`
 * under the API (or a full URL on its host, a batch's results), with any half
 * emoji in a JSON body dropped before it is sent (the Messages and Batches
 * APIs refuse such a request). The paying desk adds the key and records what
 * the call cost against `cost`; everything else about the request is the
 * caller's. Tests replace the desk's meter (setMeterForTests).
 */
export function anthropicFetch(cost: CostContext, path: string, init?: RequestInit): Promise<Response> {
  return paid.fetch(cost, "anthropic", path, init && typeof init.body === "string" ? { ...init, body: wellFormedBody(init.body) } : init);
}

/** One line of a Message Batches result, as far as its cost goes. */
export interface BatchResultRow {
  custom_id?: string;
  result?: { type?: string; message?: { id?: string; model?: string; usage?: Record<string, unknown> } };
}

/**
 * Records one Message Batches answer at the batch price. The desk reads a
 * batch's results itself when they arrive as several JSON lines; a
 * one-request batch (every batch this app sends) answers with a single line,
 * which reads as plain JSON and carries no usage where the desk looks. So
 * the reader of the results records it here, under the key the desk would
 * use, and the ledger keeps one of the two. Never throws.
 */
export async function recordBatchAnswer(cost: CostContext, batchId: string, row: BatchResultRow): Promise<void> {
  try {
    const m = row.result?.message;
    const u = m?.usage ?? {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const server = (u.server_tool_use ?? {}) as Record<string, unknown>;
    const quantities = Object.fromEntries(Object.entries({
      input_tokens: n(u.input_tokens),
      cache_write_tokens: n(u.cache_creation_input_tokens),
      cache_read_tokens: n(u.cache_read_input_tokens),
      output_tokens: n(u.output_tokens),
      web_searches: n(server.web_search_requests),
    }).filter(([, v]) => v > 0));
    if (!Object.keys(quantities).length) return;
    await paid.record(cost, "anthropic", {
      resource: m?.model ?? "unknown",
      quantities,
      providerRef: m?.id ?? null,
      idempotencyKey: `anthropic-batch:${batchId}:${String(row.custom_id ?? m?.id)}`,
      modifier: "batch",
    });
  } catch (e) {
    console.warn(`[anthropic] batch ${batchId} cost not recorded: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Parameters the request cannot lose. Anything else is negotiable. */
const ESSENTIAL = new Set(["model", "messages", "system", "max_tokens", "tools", "tool_choice"]);

/**
 * The parameter an API error is complaining about, if it names one.
 *
 * Matches the phrasings the API has used for this: "X is deprecated for this
 * model", "Unsupported parameter: X", "X: Extra inputs are not permitted".
 */
export function rejectedParam(message: string): string | null {
  const patterns = [
    /["'`]?([a-z_][a-z0-9_]*)["'`]?\s+is\s+(?:deprecated|not\s+supported|unsupported|no\s+longer\s+supported)/i,
    /unsupported\s+parameter:?\s*["'`]?([a-z_][a-z0-9_]*)/i,
    /["'`]?([a-z_][a-z0-9_]*)["'`]?\s*:\s*Extra\s+inputs\s+are\s+not\s+permitted/i,
    /unexpected\s+keyword\s+argument\s*["'`]?([a-z_][a-z0-9_]*)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m && !ESSENTIAL.has(m[1])) return m[1];
  }
  return null;
}

/**
 * Errors that mean "this model will not take an assistant turn at the end".
 * Claude 5 refuses the JSON prefill trick that shaped replies on Claude 4.
 */
const PREFILL_REJECTED =
  /(assistant\s+message\s+prefill|prefill(?:ing)?\s+is\s+not\s+supported|must\s+end\s+with\s+a\s+user\s+message|final\s+message\s+must\s+be\s+from\s+the\s+user)/i;

export type Message = { role: string; content: unknown };

/**
 * Folds a trailing assistant turn into the user turn as an instruction.
 *
 * A prefill is a way of saying "your reply starts like this". Where the model
 * will not accept one, asking for the same thing in words keeps the shape
 * without the parameter, and the caller's parser still sees what it expects.
 */
export function foldPrefill(messages: Message[]): Message[] {
  if (messages.length < 2) return messages;
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant" || typeof last.content !== "string") return messages;
  const rest = messages.slice(0, -1);
  const user = rest[rest.length - 1];
  if (!user || user.role !== "user" || typeof user.content !== "string") return rest;
  return [
    ...rest.slice(0, -1),
    { role: "user", content: `${user.content}\n\nBegin your reply with exactly: ${last.content}` },
  ];
}

export type AnthropicResult = { text: string; stopReason: string; raw: unknown };

/**
 * Calls the Messages API and returns every text block joined.
 *
 * `body` is passed through as given, minus anything the API refuses: on a 400
 * that names a parameter, that parameter is dropped and the call retried, up
 * to three times, so a model that stops accepting one of them costs a retry
 * rather than an outage.
 *
 * A reply that was cut off or declined comes back as it arrived, with what
 * stopped it in `stopReason`. Read the answer through answerText, and size
 * `max_tokens` with roomFor (both in anthropicReply.ts), unless the caller
 * has its own way with such a reply.
 *
 * `waitMs` bounds the whole call, its retries included, for a caller that a
 * person or a leased job is waiting on. When the time runs out the request
 * is ended and the result is a reply that did not arrive (stopReason
 * TIMED_OUT, no text), so the caller takes the same path as for a reply that
 * was cut off: nothing is thrown. A caller's own `signal` still throws, as
 * it always did.
 */
export async function anthropicMessages(args: {
  /** Who the call is for: the paying desk records its cost against this. */
  cost: CostContext;
  body: Record<string, unknown>;
  /** Called when a parameter is dropped, so the caller can log it. */
  onDropped?: (param: string) => void;
  /** Ends the call when it fires (a pipeline step's time running out). */
  signal?: AbortSignal;
  /** The longest the whole call may take, in milliseconds. Past it the result reads as no answer. */
  waitMs?: number;
}): Promise<AnthropicResult> {
  if (args.waitMs === undefined) return await send(args, args.signal);
  if (!(args.waitMs > 0)) return outOfTime(args.body, args.waitMs);
  // One signal for the request: ended by the wait running out, or by the caller's own signal.
  const end = new AbortController();
  let ranOut = false;
  const timer = setTimeout(() => { ranOut = true; end.abort(new Error("The wait for the model's reply ran out.")); }, args.waitMs);
  const stop = () => end.abort(args.signal?.reason);
  if (args.signal?.aborted) stop();
  else args.signal?.addEventListener("abort", stop, { once: true });
  try {
    return await send(args, end.signal);
  } catch (e) {
    // Only the wait running out reads as no answer: the caller's own signal, and every other failure, is thrown as before.
    if (ranOut) return outOfTime(args.body, args.waitMs);
    throw e;
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", stop);
  }
}

/** The result of a call whose wait ran out, said once in the log like any reply that did not finish. */
function outOfTime(body: Record<string, unknown>, waitMs: number): AnthropicResult {
  console.warn(`[anthropic] reply did not arrive in ${Math.round(waitMs / 1000)} s: model ${String(body.model ?? "?")}, max_tokens ${String(body.max_tokens ?? "?")}`);
  return { text: "", stopReason: TIMED_OUT, raw: null };
}

async function send(args: { cost: CostContext; body: Record<string, unknown>; onDropped?: (param: string) => void }, signal: AbortSignal | undefined): Promise<AnthropicResult> {
  const body: Record<string, unknown> = { ...args.body };

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await anthropicFetch(args.cost, "/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    if (resp.ok) {
      const data = await resp.json();
      // Every text block, not the first one: a response may lead with another
      // block type and still carry the answer further down.
      const text = ((data.content || []) as Array<{ type?: string; text?: string }>)
        .filter((b) => b?.type === "text")
        .map((b) => b.text || "")
        .join("\n");
      const result = { text, stopReason: String(data.stop_reason || ""), raw: data };
      const stopped = replyStopped(result);
      // Said once, here, so a reply that did not finish shows in the function's log whatever its caller does with it.
      if (stopped) console.warn(`[anthropic] reply ${stopped === "refused" ? "declined" : "cut off"} (${result.stopReason}): model ${String(body.model ?? "?")}, max_tokens ${String(body.max_tokens ?? "?")}, output tokens ${String(data.usage?.output_tokens ?? "?")}, answer ${text.length} characters`);
      return result;
    }

    const detail = await resp.text().catch(() => "");
    if (resp.status === 400) {
      const bad = rejectedParam(detail);
      if (bad && bad in body) {
        delete body[bad];
        args.onDropped?.(bad);
        continue;
      }
      if (PREFILL_REJECTED.test(detail) && Array.isArray(body.messages)) {
        const folded = foldPrefill(body.messages as Message[]);
        if (folded.length !== (body.messages as Message[]).length) {
          body.messages = folded;
          args.onDropped?.("assistant prefill");
          continue;
        }
      }
    }
    throw new Error(`Anthropic API error ${resp.status}: ${detail.slice(0, 300)}`);
  }

  throw new Error("Anthropic API rejected every attempt after dropping the parameters it named");
}
