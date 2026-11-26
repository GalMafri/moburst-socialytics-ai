/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// P56-05: closeFilming (design-request close_filming, every 10 minutes) treats
// "footage arrived" as ANY request of the post that ever had a footage_path.
// A post whose earlier filmed clip ended without a video (closed no_design)
// and was asked to be filmed again (a new needs_filming row, recordFilming)
// has that new request closed as "filmed" at the next sweep, five days
// before the post, though no new clip came.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../support/lifecycleFakeDb";
import { AuthzError } from "../../../supabase/functions/_shared/auth/authz";

const g = globalThis as any;
let db: FakeDb;

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T10:00:00.000Z"));
  db = fakeDb({
    clients: [{ id: "c1", timezone: "UTC" }],
    calendar_posts: [{ client_id: "c1", post_key: "post:9", post_date: "2026-11-25", posting_time: "10:00" }],
    design_requests: [
      // The clip uploaded last week: its video was not made.
      { id: "old-clip", client_id: "c1", calendar_post_key: "post:9", status: "closed", end_reason: "no_design", footage_path: "c1/post-9-old.mp4", created_at: "2026-11-13T10:00:00Z" },
      // Asked to be filmed again today; no new clip yet.
      { id: "film-2", client_id: "c1", calendar_post_key: "post:9", status: "needs_filming", footage_path: null, created_at: "2026-11-20T09:00:00Z" },
    ],
  });
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); vi.doUnmock("../../../supabase/functions/_shared/supabase.ts"); vi.doUnmock("../../../supabase/functions/_shared/auth/requireStaff.ts"); });

it("a post five days away that waits for a new clip keeps waiting", async () => {
  const h = await load();
  const res = await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({ action: "close_filming" }) }));
  expect(res.status).toBe(200);
  const film = db.tables.design_requests.find((r) => r.id === "film-2")!;
  expect(film.status).toBe("needs_filming");
});

it("a clip uploaded after the post was asked to be filmed again ends the wait as filmed", async () => {
  db.tables.design_requests.push({ id: "new-clip", client_id: "c1", calendar_post_key: "post:9", status: "closed", end_reason: "no_design", footage_path: "c1/post-9-new.mp4", created_at: "2026-11-20T09:30:00Z" });
  const h = await load();
  await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({ action: "close_filming" }) }));
  expect(db.tables.design_requests.find((r) => r.id === "film-2")).toMatchObject({ status: "closed", end_reason: "filmed" });
});
