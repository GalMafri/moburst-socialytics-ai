import { describe, expect, it } from "vitest";
import { runCost } from "../../../functions/_shared/pipelines/cost";

describe("a pipeline step's cost context", () => {
  it("names the record the run produces as the execution, the id the gOS usage events carry", () => {
    const ctx = runCost({ run: { id: "run-1", client_id: "c-1", job_id: null, real_id: "report-1" } }, "report.social.insights");
    expect(ctx).toMatchObject({ clientId: "c-1", executionId: "report-1", actor: "user", feature: "report.social.insights" });
  });

  it("falls back to the run's own id when the run has no record yet, and counts a scheduled run as the schedule's", () => {
    expect(runCost({ run: { id: "run-2", client_id: "c-1", job_id: "job-1", real_id: null } }, "trends.themes")).toMatchObject({ executionId: "run-2", actor: "schedule" });
    expect(runCost({ run: { id: "run-3", client_id: "c-1", job_id: null } }, "x")).toMatchObject({ executionId: "run-3" });
  });
});
