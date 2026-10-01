import { describe, it, expect } from "vitest";
import { jobVisible } from "./jobs-store";
import { scopeAll, scopeOf } from "../_shared/api/keys";
import type { JobRecord } from "../_shared/api/jobs";

const job = (over: Partial<JobRecord> = {}): JobRecord => ({ id: "j", status: "running", steps: [], outputs: null, gaps: [], client_id: null, run_ids: [], next_check_at: null, started_at: null, completed_at: null, error: null, input: {}, key_id: "k-1", ...over });

describe("jobVisible", () => {
  it("shows a scoped key only jobs on its clients, plus its own jobs that have no client yet", () => {
    const scope = scopeOf(["c-bader"]);
    expect(jobVisible(job({ client_id: "c-bader" }), scope, "k-other")).toBe(true);
    expect(jobVisible(job({ client_id: "c-nano" }), scope, "k-1")).toBe(false);
    expect(jobVisible(job({ client_id: null }), scope, "k-1")).toBe(true);
    expect(jobVisible(job({ client_id: null }), scope, "k-other")).toBe(false);
  });
  it("shows an unscoped key everything", () => {
    expect(jobVisible(job({ client_id: "c-nano" }), scopeAll(), null)).toBe(true);
  });
});
