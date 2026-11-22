// @vitest-environment node
// P29-05 (QA 22 Nov 2026): hold.ts said a stopped job's held work "is not started, so nothing is paid for it",
// but for a single design / cover / video (slide_index null or 0) the work runs anyway.
import { expect, it } from "vitest";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { jobRow } from "./jobRow";

it("does not start paid work for a job canceled before the hold", async () => {
  const { admin, read } = jobRow({ step: "generate", status: "canceled", slide_index: null });
  let paid = 0;
  await heldWork(admin, read(), async () => { paid += 1; }, { maxAttempts: 4, worker: "design-worker", leaseMs: 420_000 });
  expect(paid).toBe(0);
});
