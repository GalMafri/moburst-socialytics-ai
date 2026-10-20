// @vitest-environment node
// The direct call beside a long Claude step: a streamed answer read the way a
// whole message is read, and what came of the call kept for the step.
import { describe, expect, it } from "vitest";
import { claudeStream, directFailedKey, directKey, runClaudeDirect } from "./claudeDirect";
import type { PayloadStore } from "./types";

const sse = (events: Array<Record<string, unknown>>) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
/** A streamed response cut into uneven pieces, as the network delivers it. */
function streamed(text: string, status = 200) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37)); c.close(); },
  });
  return new Response(body, { status });
}
const answer = sse([
  { type: "message_start", message: { id: "msg_1", content: [] } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Weighing the month…" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "{\"executive_summary\": " } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "\"Cadence: steady.\"}" } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Second block." } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
  { type: "message_stop" },
]);

function store() {
  const kept = new Map<string, unknown>();
  const s: PayloadStore = { async put(key, value) { kept.set(key, value); return { key, bytes: JSON.stringify(value).length }; }, async get(key) { return (kept.get(key) ?? null) as never; } };
  return { s, kept };
}

describe("claudeStream", () => {
  it("asks for a stream of the same request and joins the text blocks as a whole message is read", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const r = await claudeStream({ apiKey: "k", body: { model: "claude-opus-5-5", max_tokens: 32000, messages: [{ role: "user", content: "x" }] }, signal: new AbortController().signal,
      fetchImpl: async (_u, init) => { sent.push(JSON.parse(String(init?.body))); return streamed(answer); } });
    expect(sent[0]).toMatchObject({ model: "claude-opus-5-5", max_tokens: 32000, stream: true });
    expect(r).toEqual({ text: "{\"executive_summary\": \"Cadence: steady.\"}\nSecond block.", stopReason: "end_turn" });
  });

  it("throws on a refused request, an error in the stream, and a stream that ends early", async () => {
    const call = (res: Response) => claudeStream({ apiKey: "k", body: {}, signal: new AbortController().signal, fetchImpl: async () => res });
    await expect(call(new Response("overloaded", { status: 529 }))).rejects.toThrow("[529]");
    await expect(call(streamed(sse([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }])))).rejects.toThrow("overloaded_error");
    await expect(call(streamed(sse([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "Half" } }])))).rejects.toThrow("ended before");
  });
});

describe("runClaudeDirect", () => {
  it("keeps the answer with how long it took, for the step to read", async () => {
    const { s, kept } = store();
    let t = 1_000;
    await runClaudeDirect(s, { apiKey: "k", body: {}, saveAs: "analysis.text", start: 1, now: () => (t += 61_000), fetchImpl: async () => streamed(answer) });
    expect(kept.get(directKey("analysis.text"))).toMatchObject({ stop_reason: "end_turn", seconds: 61, start: 1 });
    expect(kept.has(directFailedKey("analysis.text"))).toBe(false);
  });

  it("keeps why there is no answer, and never throws", async () => {
    const { s, kept } = store();
    await expect(runClaudeDirect(s, { apiKey: "k", body: {}, saveAs: "a", start: 2, fetchImpl: async () => new Response("no", { status: 500 }) })).resolves.toBeUndefined();
    expect(kept.get(directFailedKey("a"))).toMatchObject({ start: 2, message: expect.stringContaining("[500]") });
    expect(kept.has(directKey("a"))).toBe(false);
  });
});
