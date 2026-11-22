/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// P56-01: "Plan next week" resent after its first reply was lost (quietSend)
// must plan the same week once. The request names no week, so the handler
// picks the first plannable week again: the first call made that week
// "queued", so the resend queues the FOLLOWING week too.
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
  await import("../../../supabase/functions/calendar-posts/index.ts");
  return handler;
}
const ask = (h: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  h(new Request("http://x/calendar-posts", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:00:00.000Z")); // a Wednesday
  db = fakeDb({
    clients: [{ id: "c1", timezone: "UTC" }],
    calendar_plans: [{ id: "p-this", client_id: "c1", week_start: "2026-11-16", status: "ready" }],
  }, {
    // calendar_request_week as the SQL does it for a new week: a queued plan row
    // with its trigger, who asked and when (columns default as in the table).
    calendar_request_week: (args, d) => {
      const row = { id: `p-${args.p_week}`, client_id: args.p_client, week_start: args.p_week, status: "queued", trigger: args.p_trigger, requested_by: args.p_user, updated_at: new Date().toISOString() };
      d.tables.calendar_plans.push(row);
      return row;
    },
  });
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); vi.doUnmock("../../../supabase/functions/_shared/supabase.ts"); vi.doUnmock("../../../supabase/functions/_shared/auth/requireMember.ts"); });

it("a resent Plan next week plans the same week, not a second one", async () => {
  const h = await load();
  const first = await (await ask(h, { action: "plan_next_week", client_id: "c1" })).json();
  // The reply to the first was lost; quietSend sends the same body again.
  const again = await (await ask(h, { action: "plan_next_week", client_id: "c1" })).json();
  const asked = db.rpcCalls.filter((r) => r.name === "calendar_request_week").map((r) => r.args.p_week);
  expect(first.week).toBe("2026-11-23");
  expect(asked).toEqual(["2026-11-23"]);
  expect(again.week).toBe("2026-11-23");
});

it("a resent press that names its week plans that week once", async () => {
  const h = await load();
  await ask(h, { action: "plan_next_week", client_id: "c1", week: "2026-11-23" });
  const again = await (await ask(h, { action: "plan_next_week", client_id: "c1", week: "2026-11-23" })).json();
  expect(db.rpcCalls.filter((r) => r.name === "calendar_request_week").map((r) => r.args.p_week)).toEqual(["2026-11-23"]);
  expect(again.week).toBe("2026-11-23");
  expect(again.plan.id).toBe("p-2026-11-23");
});

it("a second press for the following week, named, plans that week", async () => {
  const h = await load();
  await ask(h, { action: "plan_next_week", client_id: "c1", week: "2026-11-23" });
  const next = await (await ask(h, { action: "plan_next_week", client_id: "c1", week: "2026-11-30" })).json();
  expect(db.rpcCalls.filter((r) => r.name === "calendar_request_week").map((r) => r.args.p_week)).toEqual(["2026-11-23", "2026-11-30"]);
  expect(next.week).toBe("2026-11-30");
});

it("a press with no week a while after the last one plans the following week", async () => {
  const h = await load();
  await ask(h, { action: "plan_next_week", client_id: "c1" });
  vi.setSystemTime(new Date("2026-11-18T08:05:00.000Z"));
  const next = await (await ask(h, { action: "plan_next_week", client_id: "c1" })).json();
  expect(next.week).toBe("2026-11-30");
});
