// @vitest-environment node
// P43-01: the "fresh analysis" round after a failed repair is not fresh. The
// analysis step (claudeBatchStep) first looks for a direct answer under
// "<saveAs>.direct"; the first round's direct answer is still kept there, so
// round 2 takes it at once: no new request is made and the same bad answer
// is parsed again.
import { describe, expect, it } from "vitest";
import { competitivePipeline } from "../../../functions/_shared/pipelines/definitions/competitive";
import { socialPipeline } from "../../../functions/_shared/pipelines/definitions/social";
import type { PipelineRun, StepContext } from "../../../functions/_shared/pipelines/types";

function ctx(saved: Map<string, unknown>, state: Record<string, unknown>, kind: string): StepContext {
  const run = { id: "run-1", kind, mode: "shadow", input: { request: {} }, started_at: "2026-11-20T07:00:00Z" } as unknown as PipelineRun;
  return {
    run, step: "analysis", attempt: 1, state, poll: null, now: () => new Date("2026-11-20T08:00:00Z"),
    signal: new AbortController().signal, deadline: new Date("2026-11-20T08:01:50Z"),
    payloads: { async put(key: string, value: unknown) { saved.set(key, value); return { key, bytes: 1 }; }, async get(key: string) { return (saved.get(key) ?? null) as never; } },
    output: { async write() {} }, db: {},
    // As deployed: the claude-direct function is reachable, so the step asks for direct calls.
    env: (n: string) => ({ SUPABASE_URL: "https://x.supabase.co", SOCIALYTICS_N8N_SECRET: "***", ANTHROPIC_API_KEY: "***" } as Record<string, string>)[n],
  } as unknown as StepContext;
}

function fakeFetch(calls: string[]) {
  return async (url: string) => {
    calls.push(url);
    if (url.endsWith("/v1/messages/batches")) return new Response(JSON.stringify({ id: "msgbatch_new" }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
}

describe("fresh analysis round after a failed repair", () => {
  it("competitive: round 2 of analysis makes a new request instead of reusing round 1's direct answer", async () => {
    const calls: string[] = [];
    const saved = new Map<string, unknown>([
      ["aggregates", { companies: [] }],
      // Round 1's direct answer, which did not match the format.
      ["analysis.answer.direct", { text: "not the JSON", stop_reason: "end_turn", seconds: 90, start: 1 }],
    ]);
    const def = competitivePipeline({ claudeFetch: fakeFetch(calls) });
    // parse_repair sends the run back to analysis with analysis_rounds 1 (definitions/competitive.ts:346).
    const r = await def.steps.analysis(ctx(saved, { analysis_rounds: 1, repair_error: null }, "competitive"));
    expect(r.type).toBe("poll"); // a fresh request is under way
    expect(calls.length).toBeGreaterThan(0);
  });

  it("control (passes): with no kept direct answer the same step does make a new request", async () => {
    const calls: string[] = [];
    const saved = new Map<string, unknown>([["aggregates", { companies: [] }]]);
    const r = await competitivePipeline({ claudeFetch: fakeFetch(calls) }).steps.analysis(ctx(saved, { analysis_rounds: 1 }, "competitive"));
    expect(r.type).toBe("poll");
  });

  it("social: round 2 of synthesis makes a new request instead of reusing round 1's direct answer", async () => {
    const calls: string[] = [];
    const saved = new Map<string, unknown>([
      ["normalized", {}],
      ["synthesis.answer.direct", { text: "not the JSON", stop_reason: "end_turn", seconds: 90, start: 1 }],
    ]);
    const def = socialPipeline({ claudeFetch: fakeFetch(calls) });
    const r = await def.steps.synthesis(ctx(saved, { analysis_rounds: 1, repair_error: null }, "social"));
    expect(r.type).toBe("poll");
    expect(calls.length).toBeGreaterThan(0);
  });
});
