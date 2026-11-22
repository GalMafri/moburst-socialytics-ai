// @vitest-environment node
// P53-06 (QA 22 Nov 2026): the 90-minute request limit closed a video request whose paid clip was still
// rendering (a clip may take up to CLIP_LOST_MS, 3 hours), throwing the clip away after its credits were spent.
import { expect, it } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { endOverdueRequests } from "../../../functions/_shared/canva/jobs";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const lease = { claim_worker_lease: () => true, release_worker_lease: () => null };

const request = () => ({
  id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Instagram", format: "video", post_copy: "Copy.",
  requested_by: "p1", status: "preparing", stage: "finishing", kind: "video", options_wanted: 1, options_ready: 0, candidates_started: 1,
  briefs: [], started_at: ago(95), created_at: ago(95), end_reason: null, ended_at: null, error: null,
});
const job = (clip_order: unknown) => ({
  id: "j1", design_request_id: "req-1", status: "running", step: "clip_wait", option_index: 0, slide_index: null, slide_count: null,
  output_path: null, state: {}, input: {}, lease_until: null, clip_order,
});

it("keeps a request open while its ordered clip is still rendering", async () => {
  const db = fakeDb({ design_requests: [request()], canva_finish_jobs: [job({ price: 128, at: ago(15), job_id: "hf-1", credits: 128 })], post_iterations: [] }, lease);
  expect(await endOverdueRequests(db, NOW)).toEqual([]);
  expect(db.tables.design_requests[0].status).toBe("preparing");
  expect(db.tables.canva_finish_jobs[0].status).toBe("running");
});

it("still closes it once the clip is past the time it is taken as lost", async () => {
  const db = fakeDb({ design_requests: [request()], canva_finish_jobs: [job({ price: 128, at: ago(200), job_id: "hf-1", credits: 128 })], post_iterations: [] }, lease);
  expect(await endOverdueRequests(db, NOW)).toEqual(["req-1"]);
});

it("still closes a request whose video never ordered its clip", async () => {
  const db = fakeDb({ design_requests: [request()], canva_finish_jobs: [job(null)], post_iterations: [] }, lease);
  expect(await endOverdueRequests(db, NOW)).toEqual(["req-1"]);
});
