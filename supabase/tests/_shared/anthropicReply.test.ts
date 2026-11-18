// A reply that stopped at its limit, or was declined, is no answer. The models
// the app calls think before they answer and the thinking counts toward
// max_tokens, so a limit sized for the answer alone came back with little or
// no answer text (18 Nov 2026). What a call asks for and how its reply is read
// are decided in one place.
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicMessages } from "../../functions/_shared/anthropic";
import { answerText, PERSON_WAIT_MS, replySample, replyStopped, roomFor, THINKING_ROOM, TIMED_OUT } from "../../functions/_shared/anthropicReply";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const answers = (data: unknown) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(data)));
const ask = (max = 400) => anthropicMessages({ apiKey: "k", body: { model: "claude-opus-5-5", max_tokens: max, messages: [{ role: "user", content: "Where is the logo?" }] } });

describe("room for thinking", () => {
  it("is the answer's own size on top of the room every call leaves the model", () => {
    expect(THINKING_ROOM).toBe(16_000);
    expect(roomFor(400)).toBe(16_400);
    expect(roomFor(6000)).toBe(22_000);
    // No answer is so small that its call leaves less than the room.
    expect(roomFor(0)).toBe(THINKING_ROOM);
  });
});

describe("a reply that did not finish", () => {
  it("is cut off when it stopped at its limit, whatever text it holds", () => {
    expect(replyStopped({ text: '{"logo":"sho', stopReason: "max_tokens" })).toBe("cut_off");
    expect(replyStopped({ text: "", stopReason: "model_context_window_exceeded" })).toBe("cut_off");
    expect(answerText({ text: '{"logo":"sho', stopReason: "max_tokens" })).toBe("");
    expect(replySample({ text: '{"logo":"sho', stopReason: "max_tokens" })).toBe("the reply was cut off at its limit");
  });

  it("is refused when the request was declined", () => {
    expect(replyStopped({ text: "", stopReason: "refusal" })).toBe("refused");
    expect(answerText({ text: "I can't help with", stopReason: "refusal" })).toBe("");
    expect(replySample({ text: "", stopReason: "refusal" })).toBe("the reply was declined");
  });

  it("is timed out when the caller's wait ran out before it arrived", () => {
    expect(TIMED_OUT).toBe("timed_out");
    expect(replyStopped({ text: "", stopReason: TIMED_OUT })).toBe("timed_out");
    expect(answerText({ text: "", stopReason: TIMED_OUT })).toBe("");
    expect(replySample({ text: "", stopReason: TIMED_OUT })).toBe("the reply did not arrive in time");
  });

  it("leaves a finished reply as it is", () => {
    for (const stopReason of ["end_turn", "stop_sequence", "tool_use", "pause_turn", "", undefined]) {
      expect(replyStopped({ text: "ok", stopReason })).toBeNull();
      expect(answerText({ text: "ok", stopReason })).toBe("ok");
    }
    expect(replySample({ text: "x".repeat(500), stopReason: "end_turn" })).toHaveLength(200);
    // A stand-in with no text at all reads as an empty answer.
    expect(answerText({})).toBe("");
  });
});

describe("anthropicMessages and a reply that did not finish", () => {
  it("returns a reply the thinking used up as it came, says so in the log, and reads as no answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // What the API sends when the limit ends the reply during the thinking: a thinking block with no text, and no text block.
    answers({ content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: "max_tokens", usage: { input_tokens: 9000, output_tokens: 400 } });
    const r = await ask();
    expect(r).toMatchObject({ text: "", stopReason: "max_tokens" });
    expect(replyStopped(r)).toBe("cut_off");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/cut off \(max_tokens\): model claude-opus-5-5, max_tokens 400, output tokens 400/);
  });

  it("never reads the start of an answer as the answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    answers({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"logo":"shown","logo_at":"top-le' }], stop_reason: "max_tokens" });
    const r = await ask();
    // The text is still there for a caller with its own way with it, and answerText gives none of it.
    expect(r.text).toBe('{"logo":"shown","logo_at":"top-le');
    expect(answerText(r)).toBe("");
  });

  it("reads a declined request, which comes back as a success with no content, as no answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    answers({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } });
    const r = await ask();
    expect(replyStopped(r)).toBe("refused");
    expect(answerText(r)).toBe("");
    expect(String(warn.mock.calls[0][0])).toMatch(/declined \(refusal\)/);
  });

  it("says nothing about a reply that finished after thinking", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    answers({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"logo":"none"}' }], stop_reason: "end_turn" });
    const r = await ask(roomFor(400));
    expect(answerText(r)).toBe('{"logo":"none"}');
    expect(warn).not.toHaveBeenCalled();
  });
});

// Room is not time: a long think can take minutes. A call that a person or a leased job waits on says how long it may
// take, and past that it reads as no answer, in the caller's own words, where the request would have ended in a gateway error.
describe("anthropicMessages and a wait that runs out", () => {
  /** An API that never answers: the request ends only when its signal does. */
  const never = () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      signals.push(init?.signal);
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    return signals;
  };
  const body = { model: "claude-opus-5-5", max_tokens: roomFor(400), messages: [{ role: "user", content: "Where is the logo?" }] };

  it("leaves a person a margin inside the request's own limit", () => {
    expect(PERSON_WAIT_MS).toBe(110_000);
  });

  it("ends the request when the wait runs out, throws nothing, and reads as no answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const signals = never();
    const r = await anthropicMessages({ apiKey: "k", body, waitMs: 30 });
    expect(r).toEqual({ text: "", stopReason: "timed_out", raw: null });
    expect(replyStopped(r)).toBe("timed_out");
    expect(answerText(r)).toBe("");
    expect(signals[0]?.aborted).toBe(true);
    expect(String(warn.mock.calls[0][0])).toMatch(/did not arrive in 0 s: model claude-opus-5-5, max_tokens 16400/);
  });

  it("makes no request when no time is left", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const signals = never();
    expect(await anthropicMessages({ apiKey: "k", body, waitMs: 0 })).toMatchObject({ stopReason: "timed_out" });
    expect(await anthropicMessages({ apiKey: "k", body, waitMs: -5 })).toMatchObject({ stopReason: "timed_out" });
    expect(signals).toEqual([]);
  });

  it("returns an answer that arrives inside the wait as it is", async () => {
    answers({ content: [{ type: "text", text: '{"logo":"none"}' }], stop_reason: "end_turn" });
    expect(await anthropicMessages({ apiKey: "k", body, waitMs: 5_000 })).toMatchObject({ text: '{"logo":"none"}', stopReason: "end_turn" });
  });

  it("still throws when the caller's own signal ends the call, and for a failure that is not the wait", async () => {
    never();
    const stop = new AbortController();
    const asked = anthropicMessages({ apiKey: "k", body, signal: stop.signal, waitMs: 5_000 });
    stop.abort(new Error("The step ran out of time."));
    await expect(asked).rejects.toThrow("The step ran out of time.");
    vi.stubGlobal("fetch", async () => new Response("overloaded", { status: 529 }));
    await expect(anthropicMessages({ apiKey: "k", body, waitMs: 5_000 })).rejects.toThrow("Anthropic API error 529");
  });

  it("sends no signal at all for a call with no wait and no signal of its own", async () => {
    const inits: Array<RequestInit | undefined> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => { inits.push(init); return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" })); });
    await anthropicMessages({ apiKey: "k", body });
    expect(inits[0]).not.toHaveProperty("signal");
  });
});
