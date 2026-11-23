// Who a pipeline step's paid calls are for: the run's client, the run as the
// execution (report_pipeline_runs.id, the id its usage events carry), and a
// run started by a scheduled job counted as the schedule's.

import type { CostContext } from "../cost/context.ts";
import { costCtx } from "../paid/index.ts";
import type { PipelineRun } from "./types.ts";

export function runCost(ctx: { run: Pick<PipelineRun, "id" | "client_id" | "job_id"> }, feature: string): CostContext {
  return costCtx({ clientId: ctx.run.client_id, feature, actor: ctx.run.job_id ? "schedule" : "user", executionId: ctx.run.id });
}
