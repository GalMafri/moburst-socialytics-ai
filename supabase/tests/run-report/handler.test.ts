/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles model heterogeneous response shapes. */
// run-report checks a monthly period in the client's own zone before it queues anything.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ timezone: "UTC" as string | null, inserted: [] as Array<Record<string, any>> }));
vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    // The staff checks answer yes; the client has an account in Sprout, so it is not strategy-only.
    rpc: async (name: string) => ({ data: name !== "client_strategy_only", error: null }),
    from: (table: string) => {
      let inserting: Record<string, any> | null = null;
      const q: Record<string, any> = {
        select: () => q, eq: () => q, is: () => q, in: () => q, gt: () => q, order: () => q, limit: () => q,
        insert: (row: Record<string, any>) => { inserting = row; db.inserted.push(row); return q; },
        single: async () => ({ data: { id: "job1", created_at: "2026-11-12T00:00:00Z" }, error: null }),
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Acme", archived_at: null, timezone: db.timezone } : null, error: null }),
      };
      void inserting;
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;

beforeEach(async () => {
  db.timezone = "UTC"; db.inserted = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T01:00:00Z"));
  vi.stubGlobal("Deno", {
    env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://p.supabase.co" : k === "SOCIALYTICS_N8N_SECRET" ? undefined : "k") },
    serve: (h: typeof handler) => { handler = h; },
  });
  vi.resetModules();
  await import("../../functions/run-report/index.ts");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const call = (body: Record<string, unknown>) =>
  handler(new Request("https://f/run-report", { method: "POST", headers: { Authorization: "Bearer abc.def.ghi" }, body: JSON.stringify({ client_id: "c1", kind: "social", ...body }) }));

describe("run-report, monthly period", () => {
  it("answers 400 to a start after the end, and queues nothing", async () => {
    const res = await call({ date_range_start: "2026-10-31", date_range_end: "2026-10-01" });
    expect(res.status).toBe(400);
    expect(db.inserted).toEqual([]);
  });

  it("answers 400 to an end that is still in the future in the client's zone", async () => {
    db.timezone = "Pacific/Pago_Pago"; // still Nov 11 at 01:00 UTC on Nov 12
    const res = await call({ date_range_start: "2026-11-01", date_range_end: "2026-11-12" });
    expect(res.status).toBe(400);
    expect(db.inserted).toEqual([]);
  });

  it("accepts the same end for a client whose day has already reached it", async () => {
    db.timezone = "UTC";
    const res = await call({ date_range_start: "2026-11-01", date_range_end: "2026-11-12" });
    expect(await res.clone().json()).not.toHaveProperty("error");
    expect(res.status).toBe(200);
    expect(db.inserted).toHaveLength(1);
  });

  it("defaults a range with no dates to end on the client's own today", async () => {
    db.timezone = "Pacific/Pago_Pago";
    const res = await call({});
    expect(await res.clone().json()).not.toHaveProperty("error");
    expect(res.status).toBe(200);
    expect(db.inserted[0].payload.range.end).toBe("2026-11-11");
    db.inserted = [];
    db.timezone = "Pacific/Kiritimati";
    await call({});
    expect(db.inserted[0].payload.range.end).toBe("2026-11-12");
  });
});
