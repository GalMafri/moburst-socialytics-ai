// @vitest-environment node
// P32-3 / P57-05 (QA 22 Nov 2026): a step that holds image-model work (generate, unlogo; up to 360 s) could start
// late in an edge run, after other steps, and outlive the runtime's 400 s wall clock: the run was cut off, a try was
// spent and the image paid for again. Such a step now only starts early in a run; later, the pass ends with the step
// saved and the job free for the next pass.
import { expect, it } from "vitest";
import { advanceDesignJob } from "../../../functions/_shared/design/advance";
import { jobRow } from "../canva/jobRow";

it("ends the pass before a holding step when the run is already late, with the step saved and the job free", async () => {
  const { row, admin, read } = jobRow({ step: "locate", design_request_id: "req-1" });
  const job = read();
  const ran: string[] = [];
  await advanceDesignJob(admin, job, async () => {
    ran.push(job.step);
    if (job.step === "locate") { job.step = "unlogo"; return "next"; }
    return "held";
  }, () => true, () => true);
  expect(ran).toEqual(["locate"]);
  expect(row.step).toBe("unlogo");
  expect(row.lease_until).toBeNull();
});

it("starts a holding step that is the first of the run, however late the clock says it is", async () => {
  const { admin, read } = jobRow({ step: "unlogo", design_request_id: "req-1" });
  const job = read();
  const ran: string[] = [];
  await advanceDesignJob(admin, job, async () => { ran.push(job.step); return "held"; }, () => true, () => true);
  expect(ran).toEqual(["unlogo"]);
});

it("runs a holding step after another while the run is still early", async () => {
  const { admin, read } = jobRow({ step: "locate", design_request_id: "req-1" });
  const job = read();
  const ran: string[] = [];
  await advanceDesignJob(admin, job, async () => {
    ran.push(job.step);
    if (job.step === "locate") { job.step = "unlogo"; return "next"; }
    return "held";
  }, () => true, () => false);
  expect(ran).toEqual(["locate", "unlogo"]);
});
