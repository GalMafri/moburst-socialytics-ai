// @vitest-environment node
// P29-07 (QA 22 Nov 2026): a replacement option that cannot be started because the client's logo file is
// gone from storage threw on every settle, and the request stayed "preparing" until the 90-minute cut.
import { expect, it } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";
import { settleRequest } from "../../../functions/_shared/canva/jobs";

const world = () => fakeDb({
  design_requests: [{
    id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Facebook", format: "image", post_copy: "Copy.",
    requested_by: "p1", status: "preparing", stage: "finishing", kind: "single", options_wanted: 1, options_ready: 0, candidates_started: 1,
    briefs: [1, 2, 3].map((n) => ({ headline: [`Headline ${n}`], picture: `Picture ${n}`, refs: ["c1/a.jpg"] })),
    end_reason: null, ended_at: null, error: null, created_at: new Date().toISOString(), started_at: new Date().toISOString(),
  }],
  canva_finish_jobs: [{ id: "j0", client_id: "c1", design_request_id: "req-1", option_index: 0, slide_index: null, slide_count: null, status: "failed", step: "locate", attempts: 4, lease_until: null, input: {}, state: {}, error: "x" }],
  design_brand_settings: [{ client_id: "c1", logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.17, top: 0.824 }, background: "#1A1A1A", reference_paths: ["c1/a.jpg"] }],
  clients: [{ id: "c1", name: "Brand" }],
}, { claim_worker_lease: () => true, release_worker_lease: () => null });

it("closes the request with the reason when the logo file a replacement needs is gone", async () => {
  const db = world();
  // No logo file in storage.
  await settleRequest(db, "req-1").catch(() => undefined);
  const req = db.tables.design_requests[0];
  expect({ status: req.status, end_reason: req.end_reason }).toEqual({ status: "closed", end_reason: "no_design" });
  expect(req.error).toMatch(/logo file/i);
});
