// @vitest-environment node
// P29-03 (QA 22 Nov 2026): any error other than ModelBusy/PictureError spent a try and released the lease
// with no pause, so a brief outage of another dependency (network, model API) used all tries at once.
import { expect, it } from "vitest";
import { recordStepError, retryPauseMs, unreachable } from "../../../functions/_shared/canva/stepError";
import { claimJob } from "../../../functions/_shared/canva/jobs";
import { jobRow } from "./jobRow";

const opts = { maxAttempts: 4, worker: "video-worker" };

it("a call that never reached its service is waited out with no try spent", async () => {
  const { row, admin, read } = jobRow({ step: "title", design_request_id: "req-1" });
  const blip = new TypeError("error sending request for url (https://api.anthropic.com/v1/messages): connection reset");
  expect(await recordStepError(admin, read(), blip, opts)).toBe("wait");
  expect(row.attempts).toBe(0);
});

it("four network blips in a row do not end the job", async () => {
  const { row, admin, read } = jobRow({ step: "title", design_request_id: "req-1" });
  for (let i = 0; i < 4; i++) await recordStepError(admin, read(), new TypeError("fetch failed"), opts);
  expect(row.status).not.toBe("failed");
  expect(row.attempts).toBe(0);
});

it("a spent try rests before the next one, longer each time", async () => {
  const { row, admin, read } = jobRow({ step: "title", design_request_id: "req-1" });
  const before = Date.now();
  expect(await recordStepError(admin, read(), new Error("The model API answered 500."), opts)).toBe("retry");
  // Due again only after a pause, not on the next pass.
  expect(Date.parse(row.lease_until!) - before).toBeGreaterThanOrEqual(60_000);
  expect([1, 2, 3].map(retryPauseMs)).toEqual([60_000, 120_000, 240_000]);
});

it("a rest that ends is not taken for a run that died: no second try is counted", async () => {
  const { row, admin, read } = jobRow({ step: "locate", design_request_id: "req-1" });
  await recordStepError(admin, read(), new Error("The model API answered 500."), { ...opts, worker: "design-worker" });
  expect(row.attempts).toBe(1);
  const after = new Date(Date.parse(row.lease_until!) + 1_000);
  expect(await claimJob(admin, { id: row.id, status: row.status, attempts: row.attempts, lease_until: row.lease_until }, after, 120_000, 4)).toBe("claimed");
  expect(row.attempts).toBe(1);
  expect(row.error).toBeNull();
  // That run then dies: its lease runs out with no error on the row, which is a try.
  const later = new Date(Date.parse(row.lease_until!) + 1_000);
  expect(await claimJob(admin, { id: row.id, status: row.status, attempts: row.attempts, lease_until: row.lease_until }, later, 120_000, 4)).toBe("claimed");
  expect(row.attempts).toBe(2);
});

it("knows a network failure from other errors", () => {
  expect(unreachable(new TypeError("fetch failed"))).toBe(true);
  expect(unreachable(Object.assign(new Error("connection reset by peer"), { name: "ConnectionReset" }))).toBe(true);
  expect(unreachable(new TypeError("Cannot read properties of undefined"))).toBe(false);
  expect(unreachable(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }))).toBe(false);
  expect(unreachable(new Error("fetch failed"))).toBe(false);
});
