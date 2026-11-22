// @vitest-environment node
// QA 22 Nov 2026 (P61-04): a database read that failed was answered as "not
// accessible" (403) or "no Sprout profiles" (422), which the Analytics page
// treats as final. A failed read is answered 500, which the page asks again;
// a client with no profiles is still 422.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno.
type Any = any;

const g = globalThis as Any;
let fail: { clients?: boolean; profiles?: boolean };
let profileRows: Any[];
vi.mock("../../functions/_shared/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => (fail.clients ? { data: null, error: { message: "connection reset" } } : { data: { id: "c1", name: "Brand", sprout_customer_id: "42" }, error: null }),
        then: (res: Any, rej: Any) => Promise.resolve(table === "sprout_profiles" && fail.profiles ? { data: null, error: { message: "connection reset" } } : { data: table === "sprout_profiles" ? profileRows : [], error: null }).then(res, rej),
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  fail = {};
  profileRows = [];
  const env: Record<string, string> = { SOCIALYTICS_N8N_SECRET: "s", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: Any) => { handler = h; } };
  // Nothing leaves the test.
  globalThis.fetch = (async () => { throw new Error("offline in tests"); }) as typeof fetch;
  vi.resetModules();
  await import("../../functions/sprout-analytics/index.ts");
});
afterEach(() => { delete g.Deno; globalThis.fetch = realFetch; });

const ask = () => handler(new Request("http://x/sprout-analytics", {
  method: "POST", headers: { "x-socialytics-secret": "s" }, body: JSON.stringify({ client_id: "c1", start: "2026-09-01", end: "2026-09-30" }),
}));

describe("sprout-analytics when a database read fails", () => {
  it("answers 500 when the client could not be read", async () => {
    fail.clients = true;
    expect((await ask()).status).toBe(500);
  });

  it("answers 500 when the client's profiles could not be read", async () => {
    fail.profiles = true;
    expect((await ask()).status).toBe(500);
  });

  it("still answers 422 for a client with no profiles", async () => {
    expect((await ask()).status).toBe(422);
  });
});
