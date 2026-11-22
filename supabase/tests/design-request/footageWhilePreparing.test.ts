/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// P56-04: a filmed post (needs_filming) whose video was started "from the
// client's posts" (PostPanel sends route "posts" for a filmed post; create.ts
// leaves the filming request open) gets its clip uploaded while that video is
// still being prepared. footage.ts hands the clip to startRequest, which
// answers the OPEN request (no footage) instead; the filming request is then
// closed as "filmed". The clip is used by nothing.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../supabase/functions/_shared/lifecycle/fakeDb";

const g = globalThis as any;
let db: FakeDb;

async function load() {
  vi.resetModules();
  vi.doMock("../../../supabase/functions/_shared/supabase.ts", () => ({ createClient: () => db }));
  vi.doMock("../../../supabase/functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "person-1" }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../../supabase/functions/design-request/index.ts");
  return handler;
}

beforeEach(() => {
  db = fakeDb({
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", reference_paths: [] }],
    design_requests: [
      { id: "film-1", client_id: "c1", calendar_post_key: "post:9", status: "needs_filming", on_camera: "it needs the founder on camera", updated_at: "2026-11-19T10:00:00Z" },
      { id: "posts-1", client_id: "c1", calendar_post_key: "post:9", status: "preparing", stage: "designing", kind: "video", video_route: "posts", footage_path: null },
    ],
    calendar_posts: [{ client_id: "c1", post_key: "post:9", format: "Reel", platform: "Instagram" }],
  });
  // The uploaded clip is in the footage bucket.
  const from = db.storage.from.bind(db.storage);
  db.storage.from = (bucket: string) => ({ ...from(bucket), list: async () => ({ data: [{ name: "post-9-1-2.mp4" }], error: null }) });
  // Planning runs after the answer, as on the edge; nothing leaves the test.
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); } };
  g.fetch = async () => { throw new Error("offline in tests"); };
});
afterEach(() => { delete g.Deno; delete g.EdgeRuntime; delete g.fetch; vi.doUnmock("../../../supabase/functions/_shared/supabase.ts"); vi.doUnmock("../../../supabase/functions/_shared/auth/requireMember.ts"); });

it("an uploaded clip starts a video made from that clip", async () => {
  const h = await load();
  const res = await h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify({
    action: "footage", client_id: "c1", calendar_post_key: "post:9", post_copy: "Meet our founder.", format: "Reel", platform: "Instagram", path: "c1/post-9-1-2.mp4",
  }) }));
  const out = await res.json();
  expect(res.status).toBe(200);
  // The filming request was closed as filmed...
  expect(db.tables.design_requests.find((r) => r.id === "film-1")?.end_reason).toBe("filmed");
  // ...so the request answered must be the one made from the clip.
  expect(out.request?.footage_path).toBe("c1/post-9-1-2.mp4");
  // The video that was being made without the clip stopped.
  expect(db.tables.design_requests.find((r) => r.id === "posts-1")?.status).toBe("canceled");
});
