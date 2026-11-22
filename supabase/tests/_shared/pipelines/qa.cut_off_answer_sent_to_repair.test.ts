// @vitest-environment node
// P43-04: a cut-off analysis (stop_reason "max_tokens") is handed to the
// structural repair prompt as the "Completion" to be made to match the schema,
// so half an answer can come back as a whole one. The project's own rule
// (anthropicReply.ts replyStopped): such a reply "is no answer, whatever text
// it holds", and "half an answer is never read as a whole one".
import { describe, expect, it } from "vitest";
import { competitivePipeline } from "../../../functions/_shared/pipelines/definitions/competitive";
import { socialPipeline } from "../../../functions/_shared/pipelines/definitions/social";
import type { PipelineRun, StepContext } from "../../../functions/_shared/pipelines/types";

const cut = '{"executive_summary":"Scale gap: Rival Co leads on followers at 680K.\\n\\nCadence: The client publishes 12.6 posts a week","competitor_breakdowns":[{"name":"Rival Co","is_client":false,"copy_style":"Question-led';
function ctx(saved: Map<string, unknown>): StepContext {
  return {
    run: { id: "run-1", kind: "competitive", mode: "app", input: { request: {} }, started_at: "2026-11-20T07:00:00Z" } as unknown as PipelineRun,
    step: "parse", attempt: 1, state: {}, poll: null, now: () => new Date("2026-11-20T08:00:00Z"), signal: new AbortController().signal, deadline: new Date("2026-11-20T08:01:50Z"),
    payloads: { async put(k: string, v: unknown) { saved.set(k, v); return { key: k, bytes: 1 }; }, async get(k: string) { return (saved.get(k) ?? null) as never; } },
    output: { async write() {} }, db: {}, env: () => undefined,
  } as unknown as StepContext;
}

describe("competitive parse of a cut-off analysis", () => {
  it("does not send half an answer to the structural repair", async () => {
    const saved = new Map<string, unknown>([["aggregates", { companies: [] }], ["analysis.answer", { text: cut, stop_reason: "max_tokens" }]]);
    const r = await competitivePipeline().steps.parse(ctx(saved));
    expect(r).not.toMatchObject({ type: "next", step: "repair" });
    expect(r).toMatchObject({ type: "next", step: "analysis", state: { analysis_rounds: 1 } });
  });

  it("stops with the reason once the fresh analysis is cut off too", async () => {
    const saved = new Map<string, unknown>([["aggregates", { companies: [] }], ["analysis.answer", { text: cut, stop_reason: "max_tokens" }]]);
    await expect(competitivePipeline().steps.parse({ ...ctx(saved), state: { analysis_rounds: 1 } } as StepContext)).rejects.toThrow("cut off");
  });

  it("social: a cut-off synthesis asks for a fresh one", async () => {
    const saved = new Map<string, unknown>([["normalized", {}], ["synthesis.answer", { text: cut, stop_reason: "max_tokens" }]]);
    const r = await socialPipeline().steps.parse(ctx(saved));
    expect(r).toMatchObject({ type: "next", step: "synthesis", state: { analysis_rounds: 1 } });
  });
});
