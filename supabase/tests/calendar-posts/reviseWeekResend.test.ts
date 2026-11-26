/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// P56-02: "Revise this week" resent after its first reply was lost: the first
// send queued the revision; the resend of the SAME note is answered 409, so
// the screen shows a revision that is queued as not sent. The rpc below
// follows calendar_request_revision's guard as written in
// supabase/migrations/20261118140000_strategy_only_clients.sql:222-231.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../support/lifecycleFakeDb";

const g = globalThis as any;
let db: FakeDb;

async function load() {
  vi.resetModules();
  vi.doMock("../../../supabase/functions/_shared/supabase.ts", () => ({ createClient: () => db }));
  vi.doMock("../../../supabase/functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "person-1" }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../../supabase/functions/calendar-posts/index.ts");
  return handler;
}
const ask = (h: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  h(new Request("http://x/calendar-posts", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  db = fakeDb({
    clients: [{ id: "c1", timezone: "UTC" }],
    calendar_plans: [{ id: "plan-1", client_id: "c1", week_start: "2026-11-23", status: "ready", pending_revision: null }],
  }, {
    calendar_request_revision: (args, d) => {
      const plan = d.tables.calendar_plans.find((p) => p.id === args.p_plan)!;
      if (plan.status === "ready" && plan.pending_revision == null) {
        plan.pending_revision = { note: args.p_note, by: args.p_user };
        return plan;
      }
      if (plan.pending_revision != null) throw new Error("This week is already being revised.");
      throw new Error("This week is still being planned.");
    },
  });
});
afterEach(() => { delete g.Deno; vi.doUnmock("../../../supabase/functions/_shared/supabase.ts"); vi.doUnmock("../../../supabase/functions/_shared/auth/requireMember.ts"); });

it("a resent revision with the same note is answered as sent, not refused", async () => {
  const h = await load();
  const first = await ask(h, { action: "revise_week", plan_id: "plan-1", note: "Shorter posts." });
  expect(first.status).toBe(202);
  // The reply to the first was lost; quietSend sends the same body again.
  const again = await ask(h, { action: "revise_week", plan_id: "plan-1", note: "Shorter posts." });
  expect(again.status).toBe(202);
});

it("a different note while a revision is waiting is still refused", async () => {
  const h = await load();
  await ask(h, { action: "revise_week", plan_id: "plan-1", note: "Shorter posts." });
  const other = await ask(h, { action: "revise_week", plan_id: "plan-1", note: "More video." });
  expect(other.status).toBe(409);
});
