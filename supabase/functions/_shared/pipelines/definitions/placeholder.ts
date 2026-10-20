// Placeholder pipelines, one per report kind, until the real ones are built.
// Each records that it ran, in that kind's shadow table, and nothing else: no
// provider is called and nothing is paid for. They run only in shadow mode,
// so the app engine can never be switched on with one of them.
//
// Every pipeline definition in this folder writes only through ctx.output and
// ctx.payloads; a test reads the folder and refuses any direct write.

import type { PipelineDefinition, ReportKind } from "../types.ts";

function placeholder(kind: ReportKind): PipelineDefinition {
  return {
    name: `placeholder_${kind}`,
    kind,
    modes: ["shadow"],
    appCapable: false,
    secrets: [],
    first: "record",
    steps: {
      async record(ctx) {
        const request = (ctx.run.input?.request ?? null) as Record<string, unknown> | null;
        await ctx.output.write("report", {
          placeholder: true,
          pipeline: ctx.run.pipeline,
          ran_at: ctx.now().toISOString(),
          real_table: ctx.run.real_table,
          real_id: ctx.run.real_id,
          // What the in-app pipeline was given, by name only: the same request n8n got.
          request_keys: request ? Object.keys(request).sort() : [],
        });
        return { type: "done", detail: { placeholder: true } };
      },
    },
  };
}

export const PLACEHOLDER_PIPELINES: readonly PipelineDefinition[] = [
  placeholder("social"),
  placeholder("competitive"),
  placeholder("linkedin_source"),
];
