// @vitest-environment node
// P43-02: when the batch submit fails after the direct call was asked for,
// the step throws an ordinary error and the runner retries with the same (empty)
// poll handle, so the direct-call count restarts at 0 and a second paid direct
// call starts while the first is still running. claude.ts:33 says a second
// direct call is made "only after the first failed outright".
import { describe, expect, it } from "vitest";
import { claudeBatchStep } from "../../../functions/_shared/pipelines/claude";
import type { PipelineRun, StepContext } from "../../../functions/_shared/pipelines/types";

const saved = new Map<string, unknown>();
function ctx(at: string): StepContext {
  return {
    run: { id: "run-1", kind: "competitive", input: {} } as unknown as PipelineRun, step: "analysis", attempt: 1, state: {}, poll: null,
    now: () => new Date(at), signal: new AbortController().signal, deadline: new Date(Date.parse(at) + 110_000),
    payloads: { async put(k: string, v: unknown) { saved.set(k, v); return { key: k, bytes: 1 }; }, async get(k: string) { return (saved.get(k) ?? null) as never; } },
    output: { async write() {} }, db: {}, env: () => undefined,
  } as unknown as StepContext;
}

describe("claudeBatchStep when the batch submit fails", () => {
  it("does not start a second direct call while the first is still under way", async () => {
    const asked: number[] = [];
    // The Batches API is overloaded; the direct function takes the request.
    const fetchImpl = async () => new Response("overloaded", { status: 529 });
    const step = claudeBatchStep({ build: async () => ({ apiKey: "***", body: { max_tokens: 32000, messages: [] } }), saveAs: "analysis.answer", next: "parse", fetchImpl, direct: async (a) => { asked.push(a.start); } });
    await expect(step(ctx("2026-11-20T08:00:00Z"))).rejects.toThrow();
    // The runner's retry 2 minutes later (failedTry keeps the payload, poll still null).
    await expect(step(ctx("2026-11-20T08:02:00Z"))).rejects.toThrow();
    expect(asked).toEqual([1]);
  });
});

// P43-01, with the asked calls kept: a later round asks anew and takes only its own call's answer.
describe("claudeBatchStep across rounds", () => {
  it("a later round asks a new direct call and never takes the earlier round's answer", async () => {
    saved.clear();
    const asked: number[] = [];
    const fetchImpl = async (url: string) => new Response(JSON.stringify(url.endsWith("/batches") ? { id: "msgbatch_1" } : { processing_status: "in_progress" }), { status: 200 });
    const step = claudeBatchStep({ build: async () => ({ apiKey: "***", body: { max_tokens: 32000, messages: [] } }), saveAs: "analysis.answer", next: "parse", fetchImpl, direct: async (a) => { asked.push(a.start); } });
    const polling = (at: string) => ({ ...ctx(at), poll: { handle: { claude_batch_id: "msgbatch_1", direct_starts: 1 }, polls: 1, since: "x" } }) as unknown as StepContext;
    // Round 1: asked, answered directly, taken.
    expect(await step(ctx("2026-11-20T08:00:00Z"))).toMatchObject({ type: "poll" });
    saved.set("analysis.answer.direct", { text: "round 1", stop_reason: "end_turn", seconds: 60, start: 1 });
    expect(await step(polling("2026-11-20T08:01:00Z"))).toMatchObject({ type: "next", detail: { answered_by: "direct" } });
    // Round 2 (a fresh analysis): round 1's answer is still kept, and is not taken.
    expect(await step(ctx("2026-11-20T08:10:00Z"))).toMatchObject({ type: "poll", detail: { direct: "asked", direct_start: 2 } });
    expect(await step(polling("2026-11-20T08:10:20Z"))).toMatchObject({ type: "poll" });
    expect(asked).toEqual([1, 2]);
    saved.set("analysis.answer.direct", { text: "round 2", stop_reason: "end_turn", seconds: 60, start: 2 });
    expect(await step(polling("2026-11-20T08:11:00Z"))).toMatchObject({ type: "next", detail: { answered_by: "direct" } });
    expect(saved.get("analysis.answer")).toMatchObject({ text: "round 2" });
  });
});
