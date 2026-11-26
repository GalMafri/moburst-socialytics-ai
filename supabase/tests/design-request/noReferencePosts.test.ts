/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// QA 22 Nov 2026 (P56-09): confirmed design settings with no reference posts
// can never be planned. Planning threw, the request stayed "planning", was
// planned again by the worker and closed only at the 90-minute limit. Now it
// ends at once; posts that are there but unreadable this time are planned
// again as before (a passing storage hiccup).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../support/lifecycleFakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";

const g = globalThis as any;
let db: FakeDb;

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => db }));
  vi.doMock("../../functions/_shared/auth/requireStaff.ts", () => ({
    AuthzError,
    requireStaff: async () => { throw new AuthzError(403, "no"); },
    requireStaffOrSystem: async () => ({ userId: null, asCaller: db, viaSecret: true, system: true }),
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/design-request/index.ts");
  return handler;
}

function setup(paths: string[]) {
  db = fakeDb({
    clients: [{ id: "c1", name: "Harbor" }],
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", reference_paths: paths }],
    design_requests: [{ id: "r1", client_id: "c1", calendar_post_key: "post:9", status: "preparing", stage: "planning", kind: "design", format: "Single image", platform: "Instagram", footage_path: null, post_copy: "Copy", options_wanted: 3 }],
  }, {
    claim_worker_lease: () => true,
    release_worker_lease: () => null,
  });
}
beforeEach(() => { g.fetch = async () => { throw new Error("offline in tests"); }; });
afterEach(() => { delete g.Deno; delete g.fetch; vi.doUnmock("../../functions/_shared/supabase.ts"); vi.doUnmock("../../functions/_shared/auth/requireStaff.ts"); });

it("a request for a client whose settings have no reference posts ends at once", async () => {
  setup([]);
  const h = await load();
  await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({ action: "replan", request_id: "r1" }) }));
  expect(db.tables.design_requests[0]).toMatchObject({ status: "closed", end_reason: "no_progress" });
});

it("reference posts that could not be read this time leave the request to be planned again", async () => {
  setup(["c1/gone.png"]);
  const h = await load();
  await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({ action: "replan", request_id: "r1" }) }));
  expect(db.tables.design_requests[0]).toMatchObject({ status: "preparing", stage: "planning" });
  expect(db.tables.design_requests[0].error).toMatch(/could be read/);
});
