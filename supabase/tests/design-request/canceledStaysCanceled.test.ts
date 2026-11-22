/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// P56-06: a video request stopped (cancel.ts) while it waited to be planned
// (plan() waits up to 150 s for the client's plan lease) comes back: planNow's
// filming branch writes status "needs_filming" with no check that the request
// is still preparing (index.ts:284), so a request the person stopped turns
// into "This video is filmed" again. Shown here through the replan action;
// the cancel lands while the lease is being claimed.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../supabase/functions/_shared/lifecycle/fakeDb";
import { AuthzError } from "../../../supabase/functions/_shared/auth/authz";

const g = globalThis as any;
let db: FakeDb;
let stopLands = true;

async function load() {
  vi.resetModules();
  vi.doMock("../../../supabase/functions/_shared/supabase.ts", () => ({ createClient: () => db }));
  vi.doMock("../../../supabase/functions/_shared/auth/requireStaff.ts", () => ({
    AuthzError,
    requireStaff: async () => { throw new AuthzError(403, "no"); },
    requireStaffOrSystem: async () => ({ userId: null, asCaller: db, viaSecret: true, system: true }),
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../../supabase/functions/design-request/index.ts");
  return handler;
}

beforeEach(() => {
  stopLands = true;
  db = fakeDb({
    clients: [{ id: "c1", name: "Harbor", video_references: ["v1"], video_style: { frames: ["c1/still-1.png"], profile: { generatable: false, needs: "your team filmed in the office" } } }],
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", reference_paths: [] }],
    design_requests: [{ id: "r1", client_id: "c1", calendar_post_key: "post:9", status: "preparing", stage: "planning", kind: "video", footage_path: null, video_route: null, post_copy: "Copy", options_wanted: 3 }],
  }, {
    // The person's Stop lands while this plan waits for the client's plan lease.
    claim_worker_lease: (_a, d) => { if (stopLands) d.tables.design_requests[0].status = "canceled"; return true; },
    release_worker_lease: () => null,
  });
  // Nothing leaves the test: the shot brief's model call fails at once.
  g.fetch = async () => { throw new Error("offline in tests"); };
});
afterEach(() => { delete g.Deno; delete g.fetch; vi.doUnmock("../../../supabase/functions/_shared/supabase.ts"); vi.doUnmock("../../../supabase/functions/_shared/auth/requireStaff.ts"); });

it("a stopped request stays stopped", async () => {
  const h = await load();
  const res = await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({ action: "replan", request_id: "r1" }) }));
  expect(res.status).toBe(200);
  expect(db.tables.design_requests[0].status).toBe("canceled");
});

it("a request still being prepared turns into one waiting for filming", async () => {
  stopLands = false;
  const h = await load();
  await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({ action: "replan", request_id: "r1" }) }));
  expect(db.tables.design_requests[0].status).toBe("needs_filming");
});
