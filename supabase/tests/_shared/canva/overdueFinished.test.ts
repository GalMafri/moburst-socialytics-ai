// @vitest-environment node
// P29-06 (QA 22 Nov 2026): endOverdueRequests closed a request "no_progress" even when its design was
// already done and only waiting to be handed to the post; the finished design never reached the post.
import { expect, it } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";
import { endOverdueRequests } from "../../../functions/_shared/canva/jobs";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const lease = { claim_worker_lease: () => true, release_worker_lease: () => null };

const request = (over: Record<string, unknown> = {}) => ({
  id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Instagram", format: "image", post_copy: "Copy.",
  requested_by: "p1", status: "preparing", stage: "finishing", kind: "single", options_wanted: 2, options_ready: 0, candidates_started: 2,
  briefs: [], started_at: ago(91), created_at: ago(91), end_reason: null, ended_at: null, error: null, ...over,
});

it("hands a finished design to the post and ends the request ready, instead of closing it with no design", async () => {
  const db = fakeDb({
    design_requests: [request()],
    canva_finish_jobs: [
      { id: "j1", design_request_id: "req-1", status: "done", step: "finished", option_index: 0, slide_index: null, slide_count: null, output_path: "c1/final.png", state: {}, input: {}, lease_until: null },
      { id: "j2", design_request_id: "req-1", status: "running", step: "locate", option_index: 1, slide_index: null, slide_count: null, output_path: null, state: {}, input: {}, lease_until: null },
    ],
    post_iterations: [],
  }, lease);
  expect(await endOverdueRequests(db, NOW)).toEqual(["req-1"]);
  const req = db.tables.design_requests[0];
  expect({ status: req.status, options_ready: req.options_ready }).toEqual({ status: "ready", options_ready: 1 });
  expect(db.tables.post_iterations).toHaveLength(1);
  expect(db.tables.post_iterations[0].media_urls).toEqual([expect.stringContaining("c1/final.png")]);
  // Nothing more is made for it: the option still at work stops.
  expect(db.tables.canva_finish_jobs.map((j) => j.status)).toEqual(["done", "canceled"]);
});

it("leaves a request with a finished design for a later pass while another worker is settling it", async () => {
  const db = fakeDb({
    design_requests: [request()],
    canva_finish_jobs: [{ id: "j1", design_request_id: "req-1", status: "done", step: "finished", option_index: 0, slide_index: null, slide_count: null, output_path: "c1/final.png", state: {}, input: {}, lease_until: null }],
    post_iterations: [],
  }, { claim_worker_lease: () => false, release_worker_lease: () => null });
  expect(await endOverdueRequests(db, NOW)).toEqual([]);
  const req = db.tables.design_requests[0];
  expect({ status: req.status, end_reason: req.end_reason }).not.toEqual({ status: "closed", end_reason: "no_progress" });
});
