/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// run-report: the period a manual run asks for. The function is loaded with
// Deno.serve captured and the database replaced by a recording fake, so what
// is checked is the job the worker would be given.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// deno-lint-ignore no-explicit-any
type Any = any;
const g = globalThis as Any;

class FakeAuthzError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Db { inserts: Any[]; answers: Record<string, Any>; strategyOnly?: boolean }
let db: Db;

/** A query chain that answers from `answers[table]` and records an insert into scheduled_jobs. */
function fakeAdmin() {
  return {
    // Is the client strategy-only (no active account in Sprout)? db.strategyOnly says; by default it is not.
    rpc: async (name: string) => ({ data: name === "client_strategy_only" ? !!db.strategyOnly : null, error: null }),
    from(table: string) {
      const chain: Any = {
        select: () => chain, eq: () => chain, in: () => chain, is: () => chain, gt: () => chain, order: () => chain, limit: () => chain,
        // The stored report is read once (by id); the same table's "running now" lookup must find nothing.
        maybeSingle: async () => {
          const data = db.answers[table] ?? null;
          if (table === "reports") db.answers.reports = null;
          return { data, error: null };
        },
        insert: (row: Any) => { db.inserts.push({ table, row }); return { select: () => ({ single: async () => ({ data: { id: "job-1", created_at: "2026-11-12T08:00:00.000Z" }, error: null }) }) }; },
      };
      return chain;
    },
  };
}

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => fakeAdmin() }));
  vi.doMock("../../functions/_shared/auth/requireStaff.ts", () => ({
    AuthzError: FakeAuthzError,
    requireStaff: async () => ({ userId: "staff-1" }),
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => undefined }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/run-report/index.ts");
  return handler;
}

const ask = (handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  handler(new Request("http://x/run-report", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  db = { inserts: [], answers: { clients: { id: "c1", name: "Moburst", archived_at: null }, competitor_sets: { id: "set-1" } } };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T08:00:00.000Z"));
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); vi.doUnmock("../../functions/_shared/supabase.ts"); vi.doUnmock("../../functions/_shared/auth/requireStaff.ts"); });

describe("run-report period", () => {
  it("queues a social run for the period asked, whole", async () => {
    const h = await load();
    const res = await ask(h, { client_id: "c1", kind: "social", date_range_start: "2026-10-01", date_range_end: "2026-10-31" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: true, kind: "social", range: { start: "2026-10-01", end: "2026-10-31" } });
    expect(db.inserts[0].row.payload).toMatchObject({ run: "manual", kind: "social", range: { start: "2026-10-01", end: "2026-10-31" }, requested_by: "staff-1" });
  });

  it("defaults a social run to the last 30 days ending today", async () => {
    const h = await load();
    const res = await ask(h, { client_id: "c1" });
    expect((await res.json()).range).toEqual({ start: "2026-10-14", end: "2026-11-12" });
  });

  it("defaults a competitive run to the 30 complete days ending yesterday", async () => {
    const h = await load();
    const res = await ask(h, { client_id: "c1", kind: "competitive" });
    expect((await res.json()).range).toEqual({ start: "2026-10-13", end: "2026-11-11" });
  });

  it("refuses a competitive period that is half given, ends today, runs backwards or is longer than 366 days", async () => {
    const h = await load();
    const cases: Array<[Record<string, string>, string]> = [
      [{ date_range_start: "2026-10-01" }, "Choose both start and end dates."],
      [{ date_range_start: "2026-10-01", date_range_end: "2026-11-12" }, "Choose an end date before today; only complete UTC days can be analyzed."],
      [{ date_range_start: "2026-10-31", date_range_end: "2026-10-01" }, "The end date must be on or after the start date."],
      [{ date_range_start: "2025-01-01", date_range_end: "2026-11-01" }, "Choose a period of at most 366 days."],
      [{ date_range_start: "2026-02-30", date_range_end: "2026-03-10" }, "Choose valid start and end dates."],
    ];
    for (const [range, message] of cases) {
      const res = await ask(h, { client_id: "c1", kind: "competitive", ...range });
      expect(res.status, message).toBe(400);
      expect((await res.json()).error).toBe(message);
    }
    expect(db.inserts).toEqual([]);
  });

  it("asks again for a stored report's own period when given its id", async () => {
    db.answers.reports = { id: "fd501cba", client_id: "c1", date_range_start: "2026-09-01", date_range_end: "2026-09-30" };
    const h = await load();
    const res = await ask(h, { report_id: "fd501cba" });
    expect(await res.json()).toMatchObject({ queued: true, kind: "social", range: { start: "2026-09-01", end: "2026-09-30" } });
    expect(db.inserts[0].row.client_id).toBe("c1");
  });

  it("answers 400 without a client, 404 for a client that is not there and 422 for an archived one", async () => {
    let h = await load();
    expect((await ask(h, {})).status).toBe(400);
    db.answers.clients = null;
    h = await load();
    expect((await ask(h, { client_id: "nope" })).status).toBe(404);
    db.answers.clients = { id: "c1", name: "Moburst", archived_at: "2026-10-01T00:00:00Z" };
    h = await load();
    const res = await ask(h, { client_id: "c1" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Moburst is archived.");
  });

  // A strategy-only client (no active account in Sprout) gets no report.
  it.each(["social", "competitive"] as const)("answers a %s run for a strategy-only client with the one sentence, and queues nothing", async (kind) => {
    db.answers.clients = { id: "c1", name: "Harbor Lane", archived_at: null };
    db.strategyOnly = true;
    const h = await load();
    const res = await ask(h, { client_id: "c1", kind, date_range_start: "2026-10-01", date_range_end: "2026-10-31" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Harbor Lane is set up for strategy only. Its calendar, designs, analytics and reports open once its social accounts are connected.");
    expect(db.inserts).toEqual([]);
  });

  it("queues the same client's run once it has an account in Sprout", async () => {
    db.answers.clients = { id: "c1", name: "Harbor Lane", archived_at: null };
    db.strategyOnly = true;
    const h = await load();
    expect((await ask(h, { client_id: "c1", kind: "social", date_range_start: "2026-10-01", date_range_end: "2026-10-31" })).status).toBe(422);
    db.strategyOnly = false;
    const res = await ask(h, { client_id: "c1", kind: "social", date_range_start: "2026-10-01", date_range_end: "2026-10-31" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: true, kind: "social" });
    expect(db.inserts).toHaveLength(1);
  });

  it("asks a competitive run for confirmed competitors first", async () => {
    db.answers.competitor_sets = null;
    const h = await load();
    const res = await ask(h, { client_id: "c1", kind: "competitive", date_range_start: "2026-10-01", date_range_end: "2026-10-31" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Moburst has no confirmed competitors yet.");
  });
});
