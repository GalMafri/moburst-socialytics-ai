// revise-suggestion checks who is asking before it reads anything, so a caller
// who is not signed in learns nothing about whether a report exists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ staff: true, canWrite: true, reads: [] as string[] }));
vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: async (name: string) => ({ data: name === "is_moburst_staff" ? db.staff : db.canWrite, error: null }),
    from: (table: string) => {
      db.reads.push(table);
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "competitive_reports" ? { id: "r1", client_id: "c1", status: "complete", report_data: {} } : null, error: null }),
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;

beforeEach(async () => {
  db.staff = true; db.canWrite = true; db.reads = [];
  vi.stubGlobal("Deno", {
    env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://p.supabase.co" : "k") },
    serve: (h: typeof handler) => { handler = h; },
  });
  vi.resetModules();
  await import("../../functions/revise-suggestion/index.ts");
});
afterEach(() => vi.unstubAllGlobals());

const call = (headers: Record<string, string>) =>
  handler(new Request("https://f/revise-suggestion", { method: "POST", headers, body: JSON.stringify({ report_id: "r1", feedback: "Shorter." }) }));

describe("revise-suggestion", () => {
  it("answers 401 to a request with no sign-in, before reading any report", async () => {
    const res = await call({});
    expect(res.status).toBe(401);
    expect(db.reads).toEqual([]);
  });

  it("answers 403 to a signed-in person who is not staff, before reading any report", async () => {
    db.staff = false;
    const res = await call({ Authorization: "Bearer abc.def.ghi" });
    expect(res.status).toBe(403);
    expect(db.reads).toEqual([]);
  });

  it("answers 403 to staff without write access to the report's client", async () => {
    db.canWrite = false;
    const res = await call({ Authorization: "Bearer abc.def.ghi" });
    expect(res.status).toBe(403);
  });
});
