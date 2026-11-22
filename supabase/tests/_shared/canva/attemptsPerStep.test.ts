// @vitest-environment node
// P29-01 (QA 22 Nov 2026): a job's tries were never reset after a step succeeds, so one died run late in a
// job's life fails it with "stopped before it finished, 4 times in a row".
import { expect, it } from "vitest";
import { claimJob } from "../../../functions/_shared/canva/jobs";
import { advanceDesignJob, DESIGN_LIMITS, MAX_DESIGN_ATTEMPTS } from "../../../functions/_shared/design/advance";
import { jobRow } from "./jobRow";

it("a single died run after three spaced-out, recovered step errors does not fail the job", async () => {
  const { row, admin, read } = jobRow({ step: "generate", design_request_id: "req-1" });
  // Three different steps each hit one ordinary error, and each time the job recovers and moves on.
  for (const [from, to] of [["generate", "locate"], ["locate", "marks"], ["marks", "finish"]]) {
    const job = read();
    let n = 0;
    await advanceDesignJob(admin, job, async () => {
      if (n++ === 0) { job.step = to; return "next"; } // the step succeeds
      throw new Error(`a one-off blip at ${to}`); // the next step hits one error
    }, () => true);
    expect(row.step).toBe(to);
    expect(row.status).toBe("running");
    void from;
  }
  // The last error's rest ends and a pass takes the job; that run is cut off by the edge runtime (lease held, nothing written).
  const t0 = new Date(Date.parse(row.lease_until!) + 1_000);
  expect(await claimJob(admin, { ...read(), status: row.status, lease_until: row.lease_until }, t0, 120_000, MAX_DESIGN_ATTEMPTS)).toBe("claimed");
  const t1 = new Date(t0.getTime() + 121_000);
  const claim = await claimJob(admin, { ...read(), status: row.status, lease_until: row.lease_until }, t1, 120_000, MAX_DESIGN_ATTEMPTS);
  // Only one run died, and every earlier error was followed by a successful step.
  expect({ claim, status: row.status, error: row.error }).toMatchObject({ claim: "claimed", status: "running" });
  void DESIGN_LIMITS;
});
