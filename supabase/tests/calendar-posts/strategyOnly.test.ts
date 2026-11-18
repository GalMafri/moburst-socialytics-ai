/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// calendar-posts for a strategy-only client (no active account in Sprout):
// "Plan next week" and "Revise this week" answer 409 with the one sentence
// and ask the database for nothing; for a client in Sprout both go on as
// before. The function is loaded with Deno.serve captured and the database
// replaced by a recording fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Any = any;
const g = globalThis as Any;
const SENTENCE = "Harbor Lane is set up for strategy only. Its calendar, designs, analytics and reports open once its social accounts are connected.";

let world: { strategyOnly: boolean; rpcs: Array<{ name: string; args: Any }>; member: (clientId: string) => Promise<string> };

function fakeAdmin() {
  return {
    rpc: async (name: string, args: Any) => {
      world.rpcs.push({ name, args });
      if (name === "client_strategy_only") return { data: world.strategyOnly, error: null };
      if (name === "calendar_request_week") return { data: { id: "plan-new", week_start: args.p_week, status: "queued" }, error: null };
      if (name === "calendar_request_revision") return { data: { id: args.p_plan, pending_revision: { note: args.p_note } }, error: null };
      return { data: null, error: null };
    },
    from(table: string) {
      const chain: Any = {
        select: () => chain, eq: () => chain, in: () => chain,
        maybeSingle: async () => ({ data: table === "clients" ? { name: "Harbor Lane", timezone: "UTC" } : table === "calendar_plans" ? { id: "plan-1", client_id: "c1" } : null, error: null }),
        then: (ok: Any) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return chain;
    },
  };
}

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => fakeAdmin() }));
  vi.doMock("../../functions/_shared/auth/requireMember.ts", () => ({ requireMember: (_req: Request, clientId: string) => world.member(clientId) }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/calendar-posts/index.ts");
  return handler;
}
const ask = (handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  handler(new Request("http://x/calendar-posts", { method: "POST", body: JSON.stringify(body) }));
const asked = (name: string) => world.rpcs.filter((r) => r.name === name);

beforeEach(() => {
  world = { strategyOnly: true, rpcs: [], member: async () => "person-1" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:00:00.000Z"));
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); vi.doUnmock("../../functions/_shared/supabase.ts"); vi.doUnmock("../../functions/_shared/auth/requireMember.ts"); });

describe("calendar-posts for a strategy-only client", () => {
  it("answers Plan next week with the one sentence, and asks for no plan", async () => {
    const h = await load();
    const res = await ask(h, { action: "plan_next_week", client_id: "c1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SENTENCE });
    // A client's own user can press this: the answer never names the tool the team connects accounts in.
    expect(SENTENCE).not.toMatch(/Sprout/);
    expect(asked("calendar_request_week")).toEqual([]);
  });

  it("answers Revise this week with the one sentence, and asks for no revision", async () => {
    const h = await load();
    const res = await ask(h, { action: "revise_week", plan_id: "plan-1", note: "Shorter posts." });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SENTENCE });
    expect(asked("calendar_request_revision")).toEqual([]);
  });

  it("says nothing about the client to someone who cannot work on it", async () => {
    const h = await load();
    // The same class the function itself imports, read after the function is loaded.
    const { AuthzError } = await import("../../functions/_shared/auth/requireStaff.ts");
    world.member = async () => { throw new AuthzError(403, "You do not have access to this client."); };
    for (const body of [{ action: "plan_next_week", client_id: "c1" }, { action: "revise_week", plan_id: "plan-1", note: "Shorter posts." }]) {
      const res = await ask(h, body);
      expect(res.status).toBe(403);
      expect((await res.json()).error).not.toMatch(/strategy only/);
    }
    expect(asked("client_strategy_only")).toEqual([]);
  });

  it("plans and revises as before for a client in Sprout, and for the same client once it has an account", async () => {
    const h = await load();
    expect((await ask(h, { action: "plan_next_week", client_id: "c1" })).status).toBe(409);
    world.strategyOnly = false;
    const planned = await ask(h, { action: "plan_next_week", client_id: "c1" });
    expect(planned.status).toBe(202);
    expect(asked("calendar_request_week")).toEqual([{ name: "calendar_request_week", args: { p_client: "c1", p_week: "2026-11-16", p_trigger: "button", p_user: "person-1" } }]);
    const revised = await ask(h, { action: "revise_week", plan_id: "plan-1", note: "Shorter posts." });
    expect(revised.status).toBe(202);
    expect(asked("calendar_request_revision")).toEqual([{ name: "calendar_request_revision", args: { p_plan: "plan-1", p_note: "Shorter posts.", p_user: "person-1", p_scope: "untouched" } }]);
  });
});
