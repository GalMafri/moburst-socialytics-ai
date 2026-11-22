/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// QA 22 Nov 2026 (P56-08): a shot brief that was not written left no trace
// and nothing asked for it again, so the post panel (which polls
// design_shot_briefs) said "being written" for good. Now the try is noted on
// the request and the filming sweep (close_filming) writes it again, a few
// times at most.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";

const g = globalThis as any;
let db: FakeDb;
let modelAnswers = false;
const brief = { who: "The founder", where: "The office", framing: "Waist up", seconds: 20, shots: [{ seconds: 20, what: "Talks to camera" }], say: "Meet the team.", notes: "" };

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => db }));
  vi.doMock("../../functions/_shared/auth/requireStaff.ts", () => ({
    AuthzError,
    requireStaff: async () => { throw new AuthzError(403, "no"); },
    requireStaffOrSystem: async () => ({ userId: null, asCaller: db, viaSecret: true, system: true }),
  }));
  vi.doMock("../../functions/_shared/anthropic.ts", () => ({
    anthropicMessages: vi.fn(async () => {
      if (!modelAnswers) throw new Error("The model is busy.");
      return { text: JSON.stringify(brief), stop_reason: "end_turn" };
    }),
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/design-request/index.ts");
  return handler;
}
const ask = (h: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  h(new Request("http://x/design-request", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  modelAnswers = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T10:00:00.000Z"));
  db = fakeDb({
    clients: [{ id: "c1", name: "Harbor", timezone: "UTC", video_references: ["v1"], video_style: { frames: ["c1/still-1.png"], profile: { generatable: false, needs: "your team filmed in the office" } } }],
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", reference_paths: [] }],
    calendar_posts: [{ client_id: "c1", post_key: "post:9", post_date: "2026-11-25", posting_time: "10:00" }],
    design_requests: [{ id: "r1", client_id: "c1", calendar_post_key: "post:9", status: "preparing", stage: "planning", kind: "video", footage_path: null, video_route: null, post_copy: "Copy", options_wanted: 3, created_at: "2026-11-20T09:00:00Z" }],
    design_shot_briefs: [],
  }, {
    claim_worker_lease: () => true,
    release_worker_lease: () => null,
  });
});
afterEach(() => {
  delete g.Deno;
  vi.useRealTimers();
  for (const m of ["supabase.ts", "auth/requireStaff.ts", "anthropic.ts"]) vi.doUnmock(`../../functions/_shared/${m}`);
});

it("a brief that was not written is noted on the request with its try", async () => {
  const h = await load();
  await ask(h, { action: "replan", request_id: "r1" });
  const r = db.tables.design_requests[0];
  expect(r.status).toBe("needs_filming");
  expect(r.error).toMatch(/^Shot brief not written \(try 1\)/);
  expect(db.tables.design_shot_briefs).toEqual([]);
});

it("the filming sweep writes a brief that was not written", async () => {
  const h = await load();
  await ask(h, { action: "replan", request_id: "r1" });
  modelAnswers = true;
  await ask(h, { action: "close_filming" });
  expect(db.tables.design_shot_briefs).toHaveLength(1);
  expect(db.tables.design_shot_briefs[0]).toMatchObject({ request_id: "r1", brief: { who: "The founder" } });
  expect(db.tables.design_requests[0].status).toBe("needs_filming");
});

it("the sweep stops asking after the last try", async () => {
  Object.assign(db.tables.design_requests[0], { status: "needs_filming", stage: "ready", error: "Shot brief not written (try 4): The model is busy." });
  const h = await load();
  modelAnswers = true;
  await ask(h, { action: "close_filming" });
  expect(db.tables.design_shot_briefs).toEqual([]);
});

it("the sweep leaves a brief that is there alone", async () => {
  Object.assign(db.tables.design_requests[0], { status: "needs_filming", stage: "ready" });
  db.tables.design_shot_briefs.push({ request_id: "r1", client_id: "c1", calendar_post_key: "post:9", brief });
  const h = await load();
  modelAnswers = true;
  await ask(h, { action: "close_filming" });
  expect(db.tables.design_shot_briefs).toHaveLength(1);
});
