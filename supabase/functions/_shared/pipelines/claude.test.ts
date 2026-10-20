// @vitest-environment node
// Claude inside a step: an inline call bounded by the step's time and saved to
// the payload store; a long call as a message batch the step polls. No
// request leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_BATCH_POLL_SECONDS, CLAUDE_BATCH_RESUBMITS, CLAUDE_INLINE_MAX_TOKENS, claudeBatchStep, claudeInline } from "./claude";
import type { PipelineRun, StepContext } from "./types";

const run = { id: "6f1c0d6e-0000-4000-8000-000000000001", kind: "social", input: {} } as unknown as PipelineRun;
function ctx(over: Partial<StepContext> = {}): StepContext & { saved: Map<string, unknown> } {
  const saved = new Map<string, unknown>();
  return {
    run, step: "analysis", attempt: 1, state: {}, poll: null, now: () => new Date("2026-11-07T07:20:00Z"),
    signal: new AbortController().signal, deadline: new Date("2026-11-07T07:21:50Z"),
    payloads: { async put(key, value) { saved.set(key, value); return { key, bytes: JSON.stringify(value).length }; }, async get(key) { return (saved.get(key) ?? null) as never; } },
    output: { async write() {} }, db: {}, env: () => undefined, saved, ...over,
  } as StepContext & { saved: Map<string, unknown> };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("claudeInline", () => {
  it("passes the step's abort signal, joins every text block, and saves the answer", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return json({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Part one." }, { type: "text", text: "Part two." }], stop_reason: "end_turn" });
    });
    const c = ctx();
    const r = await claudeInline(c, { apiKey: "k", body: { model: "claude-sonnet-4-6", max_tokens: 4000, messages: [{ role: "user", content: "Summarize." }] }, saveAs: "brief.analysis" });
    expect(r).toMatchObject({ key: "brief.analysis", stopReason: "end_turn" });
    expect(c.saved.get("brief.analysis")).toEqual({ text: "Part one.\nPart two.", stop_reason: "end_turn" });
    expect(seen[0].signal).toBe(c.signal);
  });

  it("leaves every other caller's request exactly as it was: no signal unless one is given", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { seen.push(init); return json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }); });
    const { anthropicMessages } = await import("../anthropic");
    await anthropicMessages({ apiKey: "k", body: { model: "m", max_tokens: 10, messages: [] } });
    expect(Object.keys(seen[0]).sort()).toEqual(["body", "headers", "method"]);
  });

  it("sends a call that may not fit a step's time to a batch instead", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("must not be called"); });
    await expect(claudeInline(ctx(), { apiKey: "k", body: { max_tokens: CLAUDE_INLINE_MAX_TOKENS + 1, messages: [] }, saveAs: "x" })).rejects.toThrow("message batch");
  });

  it("returns a cut answer's stop reason to the step rather than paying for the same call again", async () => {
    vi.stubGlobal("fetch", async () => json({ content: [{ type: "text", text: "Half" }], stop_reason: "max_tokens" }));
    const r = await claudeInline(ctx(), { apiKey: "k", body: { max_tokens: 100, messages: [] }, saveAs: "x" });
    expect(r.stopReason).toBe("max_tokens");
  });
});

describe("claudeBatchStep", () => {
  const body = { model: "claude-sonnet-4-6", max_tokens: 32000, messages: [{ role: "user", content: "Analyze the month." }] };

  function api(results: Array<"in_progress" | "succeeded" | "errored">, saveAs = "analysis.text") {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    let batches = 0;
    const statuses = [...results];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/v1/messages/batches") && init?.method === "POST") return json({ id: `msgbatch_${++batches}`, processing_status: "in_progress" });
      if (url.includes("/results")) {
        const outcome = statuses.shift();
        // The step's request id: the run and the answer's name.
        const customId = `${run.id}_${saveAs}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        const line = outcome === "succeeded"
          ? { custom_id: customId, result: { type: "succeeded", message: { content: [{ type: "text", text: "The long analysis." }], stop_reason: "end_turn" } } }
          : { custom_id: customId, result: { type: "errored", error: { type: "overloaded_error" } } };
        return new Response(`${JSON.stringify({ custom_id: "other", result: { type: "succeeded", message: { content: [] } } })}\n${JSON.stringify(line)}\n`);
      }
      const id = url.split("/").pop();
      const next = statuses[0];
      if (next === "in_progress") { statuses.shift(); return json({ id, processing_status: "in_progress" }); }
      return json({ id, processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/${id}/results` });
    };
    return { calls, fetchImpl };
  }

  it("submits, polls while the batch runs, saves the answer and moves on", async () => {
    const { calls, fetchImpl } = api(["in_progress", "succeeded"]);
    const step = claudeBatchStep({ build: async () => ({ apiKey: "k", body }), saveAs: "analysis.text", next: "deck", fetchImpl });

    const c1 = ctx();
    const r1 = await step(c1);
    expect(r1).toMatchObject({ type: "poll", waitSeconds: CLAUDE_BATCH_POLL_SECONDS, handle: { claude_batch_id: "msgbatch_1" } });
    const request = (calls[0].body as { requests: Array<{ custom_id: string; params: unknown }> }).requests[0];
    expect(request.custom_id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(request.params).toEqual(body);

    const polling = { handle: { claude_batch_id: "msgbatch_1" }, polls: 1, since: "2026-11-07T07:20:00Z" };
    expect(await step(ctx({ poll: polling }))).toMatchObject({ type: "poll", handle: { claude_batch_id: "msgbatch_1" } });

    const c3 = ctx({ poll: { ...polling, polls: 2 } });
    expect(await step(c3)).toMatchObject({ type: "next", step: "deck", detail: { saved: "analysis.text", stop_reason: "end_turn" } });
    expect(c3.saved.get("analysis.text")).toEqual({ text: "The long analysis.", stop_reason: "end_turn" });
  });

  it("submits a new batch when one ends without an answer, then gives up to the runner's retries", async () => {
    const { calls, fetchImpl } = api(["errored", "errored", "errored"]);
    const step = claudeBatchStep({ build: async () => ({ apiKey: "k", body }), saveAs: "analysis.text", next: null, fetchImpl });
    let state: Record<string, unknown> = {};
    let poll = { handle: { claude_batch_id: "msgbatch_0" }, polls: 1, since: "2026-11-07T07:20:00Z" };
    for (let i = 1; i <= CLAUDE_BATCH_RESUBMITS; i++) {
      const r = await step(ctx({ state, poll }));
      expect(r).toMatchObject({ type: "poll", handle: { claude_batch_id: `msgbatch_${i}` } });
      state = (r as { state: Record<string, unknown> }).state;
      poll = { ...poll, handle: { claude_batch_id: `msgbatch_${i}` } };
    }
    await expect(step(ctx({ state, poll }))).rejects.toThrow("request errored");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(CLAUDE_BATCH_RESUBMITS);
  });

  it("finishes the run when it is the last step", async () => {
    const { fetchImpl } = api(["succeeded"], "a");
    const step = claudeBatchStep({ build: async () => ({ apiKey: "k", body }), saveAs: "a", next: null, fetchImpl });
    expect(await step(ctx({ poll: { handle: { claude_batch_id: "msgbatch_9" }, polls: 1, since: "x" } }))).toMatchObject({ type: "done" });
  });
});
