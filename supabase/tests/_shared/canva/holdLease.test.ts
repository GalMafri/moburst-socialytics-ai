// @vitest-environment node
// P29-04 (QA 22 Nov 2026): held work that outlives its lease is claimed again by another pass (a try spent and
// the step paid again); when the first run then ends, its write clears the second run's lease.
import { expect, it } from "vitest";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { claimJob } from "../../../functions/_shared/canva/jobs";
import { jobRow } from "./jobRow";

it("the first run's late end leaves the lease of the run that took the job over", async () => {
  const { row, admin, read } = jobRow({ step: "generate", design_request_id: "req-1", status: "running" });
  let secondLease: string | null = null;
  await heldWork(admin, read(), async () => {
    // The work outlives the 420 s lease: the next pass finds the lease run out and takes the job.
    const later = new Date(Date.parse(row.lease_until!) + 1_000);
    const claim = await claimJob(admin, { id: row.id, status: row.status, attempts: row.attempts, lease_until: row.lease_until }, later, 120_000, 4);
    expect(claim).toBe("claimed");
    secondLease = row.lease_until;
  }, { maxAttempts: 4, worker: "design-worker", leaseMs: 420_000 });
  expect(row.attempts).toBe(1); // the second claim counted the first run as died
  // The second run still holds the job; the first run's end must not release it.
  expect(row.lease_until).toBe(secondLease);
});

it("keeps the lease renewed while the work runs, so no other pass takes a job whose run is still at work", async () => {
  const { row, admin, read } = jobRow({ step: "generate", design_request_id: "req-1", status: "running" });
  let first: string | null = null;
  await heldWork(admin, read(), async () => {
    first = row.lease_until;
    await new Promise((r) => setTimeout(r, 120));
    // Renewed meanwhile: a later lease than the hold's own.
    expect(Date.parse(row.lease_until!)).toBeGreaterThan(Date.parse(first!));
  }, { maxAttempts: 4, worker: "design-worker", leaseMs: 420_000, renewEveryMs: 30 });
  // Its end lands on the renewed lease and releases it.
  expect(row.lease_until).toBeNull();
  expect(row.attempts).toBe(0);
});

it("starts the job's tries again when the held work moved its step on", async () => {
  const { row, admin, read } = jobRow({ step: "generate", design_request_id: "req-1", status: "running", attempts: 2 });
  const job = read();
  await heldWork(admin, job, async () => { job.step = "locate"; }, { maxAttempts: 4, worker: "design-worker", leaseMs: 420_000 });
  expect({ step: row.step, attempts: row.attempts, lease_until: row.lease_until }).toEqual({ step: "locate", attempts: 0, lease_until: null });
});
