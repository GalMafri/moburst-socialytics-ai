// @vitest-environment node
// QA 22 Nov 2026 (regression R5 of P29-04): the video's opening-frame step runs inside a hold (canva/hold.ts,
// heldWork) and renews the job's lease itself before its picture call
// (video/frame.ts, deps.renewLease -> renewJobLease). heldWork now ends only
// on the lease it wrote (`.eq("lease_until", lease)`), so after that renewal
// the step's end never lands: the frame made is not recorded, the job stays
// at "frame" under a lease nobody releases, and when the lease runs out the
// next pass counts a died try and runs the step again, which ends the same
// way, until the job fails.
// Expected: the frame step's end is saved (step frame_check, frame_path kept, lease released).
import { expect, it } from "vitest";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { renewJobLease } from "../../../functions/_shared/canva/jobs";
import { runFrame } from "../../../functions/_shared/video/frame";
import { jobRow } from "../canva/jobRow";

it("saves the opening frame when the frame step renewed its lease inside the hold", async () => {
  const { row, admin, read } = jobRow({ step: "frame", design_request_id: "req-1", status: "running", input: {} });
  const job = read();
  let held: Promise<void> | null = null;
  const result = runFrame({
    draw: async () => new Uint8Array([1, 2, 3]),
    store: async () => {},
    transcode: async () => 10,
    save: async () => {},
    renewLease: () => renewJobLease(admin, job, new Date(Date.now() + 5), 420_000),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any, job, (work) => { held = heldWork(admin, job, work, { maxAttempts: 4, worker: "video-worker", leaseMs: 420_000 }); return "held" as const; });
  expect(result).toBe("held");
  await held;
  expect({ step: row.step, frame_path: row.state.frame_path ?? null, lease_until: row.lease_until })
    .toEqual({ step: "frame_check", frame_path: expect.stringMatching(/frame-1\.jpg$/), lease_until: null });
});
