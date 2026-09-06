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
 */
export async function anthropicMessages(args: {
  apiKey: string;
  body: Record<string, unknown>;
  /** Called when a parameter is dropped, so the caller can log it. */
  onDropped?: (param: string) => void;
}): Promise<AnthropicResult> {
  const body: Record<string, unknown> = { ...args.body };

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const data = await resp.json();
      // Every text block, not the first one: a response may lead with another
      // block type and still carry the answer further down.
      const text = ((data.content || []) as Array<{ type?: string; text?: string }>)
        .filter((b) => b?.type === "text")
        .map((b) => b.text || "")
        .join("\n");
      return { text, stopReason: String(data.stop_reason || ""), raw: data };
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
