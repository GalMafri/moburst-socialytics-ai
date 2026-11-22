/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// QA 22 Nov 2026 (P13-01, P13-02): the calendar sends "Plan the week of …"
// and "Revise the week" again quietly when no reply came
// (src/lib/calendarRequests.ts), and a reply can be lost after the server
// did the work. Sent again, each must answer as the first one did: the same
// week planned (never the week after it), the same revision under way
// (never "already being revised").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Any = any;
const g = globalThis as Any;

let world: { plans: Any[]; rpcs: Array<{ name: string; args: Any }> };

function fakeAdmin() {
  return {
    rpc: async (name: string, args: Any) => {
      world.rpcs.push({ name, args });
      if (name === "client_strategy_only") return { data: false, error: null };
      if (name === "calendar_request_week") {
        let plan = world.plans.find((p) => p.week_start === args.p_week);
        if (!plan) world.plans.push(plan = { id: `plan-${args.p_week}`, client_id: "c1", week_start: args.p_week, status: "queued", pending_revision: null });
        return { data: plan, error: null };
      }
      if (name === "calendar_request_revision") {
        const plan = world.plans.find((p) => p.id === args.p_plan);
        if (plan.pending_revision) return { data: null, error: { message: "This week is already being revised." } };
        plan.pending_revision = { note: args.p_note, scope: args.p_scope };
        return { data: plan, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let within: [string, unknown[]] | null = null;
      const rows = () => (table === "calendar_plans" ? world.plans : table === "clients" ? [{ id: "c1", name: "Harbor Lane", timezone: "UTC" }] : [])
        .filter((r: Any) => filters.every(([c, v]) => r[c] === v) && (!within || within[1].includes(r[within[0]])));
      const chain: Any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        in: (c: string, vs: unknown[]) => { within = [c, vs]; return chain; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: Any) => Promise.resolve({ data: rows(), error: null }).then(ok),
      };
      return chain;
    },
  };
}

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => fakeAdmin() }));
  vi.doMock("../../functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "person-1" }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/calendar-posts/index.ts");
  return handler;
}
const ask = (handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  handler(new Request("http://x/calendar-posts", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  world = { plans: [{ id: "plan-2026-11-16", client_id: "c1", week_start: "2026-11-16", status: "ready", pending_revision: null }], rpcs: [] };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:00:00.000Z"));
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); vi.doUnmock("../../functions/_shared/supabase.ts"); vi.doUnmock("../../functions/_shared/auth/requireMember.ts"); });

describe("calendar-posts asked again after a lost reply", () => {
  it("plans the week the button named, once, however often it is asked", async () => {
    const h = await load();
    const body = { action: "plan_next_week", client_id: "c1", week: "2026-11-23" };
    const first = await ask(h, body);
    const again = await ask(h, body);
    expect(first.status).toBe(202);
    expect(again.status).toBe(202);
    expect((await again.json()).week).toBe("2026-11-23");
    expect(world.plans.map((p) => p.week_start)).toEqual(["2026-11-16", "2026-11-23"]);
  });

  it("still picks the first week free when no week is named, or the named one is out of reach", async () => {
    const h = await load();
    expect((await (await ask(h, { action: "plan_next_week", client_id: "c1" })).json()).week).toBe("2026-11-23");
    expect((await (await ask(h, { action: "plan_next_week", client_id: "c1", week: "2026-10-05" })).json()).week).toBe("2026-11-30");
  });

  it("answers a revision sent again with the revision already under way", async () => {
    const h = await load();
    const body = { action: "revise_week", plan_id: "plan-2026-11-16", note: "Shorter posts." };
    expect((await ask(h, body)).status).toBe(202);
    const again = await ask(h, body);
    expect(again.status).toBe(202);
    expect((await again.json()).plan).toMatchObject({ id: "plan-2026-11-16", pending_revision: { note: "Shorter posts." } });
    // A different note while one is under way is still refused.
    expect((await ask(h, { ...body, note: "Longer posts." })).status).toBe(409);
  });
});
