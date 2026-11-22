// @vitest-environment node
// P33-4 (QA 22 Nov 2026): a slot search that has used its PICTURE_MAX_ASKS budgeted calls sends one call with
// no budget; when that call times out (its own work, not an outage), the job waited with no try spent and
// sent the same call on every pass until the request's 90-minute limit.
import { expect, it } from "vitest";
import { MAX_DESIGN_ATTEMPTS, advanceDesignJob } from "../../../functions/_shared/design/advance";
import { SEARCH_KEPT, slotSearch } from "../../../functions/_shared/design/logoChoice";
import { PICTURE_MAX_ASKS, type SlotRequest } from "../../../functions/_shared/picture/contract";
import { jobRow } from "../canva/jobRow";

const DESIGN = "c1/canva-finish/job-1/design-1.png";
const slotBody: SlotRequest = { job: "job-1", step: "locate", design: "https://storage.test/read/design.png?token=d", placement: { anchor: "center", width: 0.2, top: 0.04 }, scales: [0.45, 1.35], templates: [{ file: "stored", logo: "https://storage.test/read/logo.png?token=l", ground: [255, 255, 255] }] };
const soFar = { of: "0123456789abcdef0123456789abcdef", done: [], at: { size: 3, row: 40, best: { x: 4, y: 2, width: 22, height: 9, score: 0.38 } } };

it("spends the job's tries, and ends it, when the search's last call keeps timing out", async () => {
  const r = jobRow({ step: "locate", state: { design_path: DESIGN, [SEARCH_KEPT.slot]: { of: DESIGN, search: soFar, asks: PICTURE_MAX_ASKS } } });
  let n = 0;
  const admin = { ...r.admin, rpc: async () => ({ data: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, error: null }) };
  const timeout = (async () => { throw Object.assign(new Error("The signal has been aborted"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
  for (let pass = 0; pass < 12 && r.row.status === "running"; pass++) {
    const job = r.read();
    await advanceDesignJob(admin, job, async () => {
      await slotSearch(admin, job.state as Record<string, unknown>, "slot", DESIGN, slotBody, { fetchImpl: timeout, sleep: async () => {} });
      return "next";
    }, () => true);
    r.row.lease_until = null; // the rest after a spent try is over by the next pass
  }
  expect({ status: r.row.status, attempts: r.row.attempts }).toEqual({ status: "failed", attempts: MAX_DESIGN_ATTEMPTS });
});

it("still waits out a timeout while the search has budgeted calls left: the service may be slow for everyone", async () => {
  const r = jobRow({ step: "locate", state: { design_path: DESIGN, [SEARCH_KEPT.slot]: { of: DESIGN, search: soFar, asks: 3 } } });
  const admin = { ...r.admin, rpc: async () => ({ data: "00000000-0000-4000-8000-000000000001", error: null }) };
  const timeout = (async () => { throw Object.assign(new Error("The signal has been aborted"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
  const job = r.read();
  await advanceDesignJob(admin, job, async () => {
    await slotSearch(admin, job.state as Record<string, unknown>, "slot", DESIGN, slotBody, { fetchImpl: timeout, sleep: async () => {} });
    return "next";
  }, () => true);
  expect({ status: r.row.status, attempts: r.row.attempts }).toEqual({ status: "running", attempts: 0 });
});
