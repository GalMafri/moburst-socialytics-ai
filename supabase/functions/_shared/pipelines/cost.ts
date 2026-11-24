// Who a pipeline step's paid calls are for: the run's client, and as the
// execution the record the run produces (report_pipeline_runs.real_id: the
// reports, competitive_reports or trend_weeks row). That is the id the gOS
// usage events carry for an execution (public.gos_events uses reports.id), so
// the portal can join a report's costs to its execution. A run with no record
// yet falls back to its own id. A run started by a scheduled job is counted as
// the schedule's.

import type { CostContext } from "../cost/context.ts";
import { costCtx } from "../paid/index.ts";
import type { PipelineRun } from "./types.ts";

export function runCost(ctx: { run: Pick<PipelineRun, "id" | "client_id" | "job_id"> & Partial<Pick<PipelineRun, "real_id">> }, feature: string): CostContext {
  return costCtx({ clientId: ctx.run.client_id, feature, actor: ctx.run.job_id ? "schedule" : "user", executionId: ctx.run.real_id ?? ctx.run.id });
}
