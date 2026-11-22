/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// P56-07 (server half of P05-1): "Stop planning" confirmed after the plan
// finished must not remove the finished week. The handler passes the button's
// intent to calendar_stop_plan, which decides with the plan row held
// (20261122131000_calendar_stop_plan_intent.sql, tested on PGlite in
// supabase/tests/migrations/calendarStopPlanIntent.test.ts). The rpc below
// follows that function's choice.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../functions/_shared/lifecycle/fakeDb";

const g = globalThis as any;
let db: FakeDb;

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => db }));
  vi.doMock("../../functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "person-1" }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/calendar-posts/index.ts");
  return handler;
}
const ask = (h: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  h(new Request("http://x/calendar-posts", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  db = fakeDb({
    clients: [{ id: "c1", timezone: "UTC" }],
    // The plan finished while the Stop planning question was open.
    calendar_plans: [{ id: "plan-1", client_id: "c1", week_start: "2026-11-23", status: "ready" }],
  }, {
    calendar_stop_plan: (args, d) => {
      const plan = d.tables.calendar_plans.find((p) => p.id === args.p_plan)!;
      if (plan.status === "canceled") return plan;
      if (args.p_intent === "stop" && plan.status === "ready") return plan;
      plan.status = "canceled";
      return plan;
    },
  });
});
afterEach(() => { delete g.Deno; vi.doUnmock("../../functions/_shared/supabase.ts"); vi.doUnmock("../../functions/_shared/auth/requireMember.ts"); });

it("Stop planning on a plan that finished meanwhile leaves it planned and answers it", async () => {
  const h = await load();
  const res = await ask(h, { action: "stop_plan", plan_id: "plan-1", intent: "stop" });
  expect(res.status).toBe(200);
  expect((await res.json()).plan.status).toBe("ready");
  expect(db.tables.calendar_plans[0].status).toBe("ready");
});

it("Remove this week's plan removes it", async () => {
  const h = await load();
  await ask(h, { action: "stop_plan", plan_id: "plan-1", intent: "remove" });
  expect(db.rpcCalls.find((r) => r.name === "calendar_stop_plan")!.args).toMatchObject({ p_plan: "plan-1", p_user: "person-1", p_intent: "remove" });
  expect(db.tables.calendar_plans[0].status).toBe("canceled");
});

it("a request with no intent is sent as before, with two arguments", async () => {
  const h = await load();
  await ask(h, { action: "stop_plan", plan_id: "plan-1" });
  expect(db.rpcCalls.find((r) => r.name === "calendar_stop_plan")!.args).toEqual({ p_plan: "plan-1", p_user: "person-1" });
});
