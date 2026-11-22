/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// The design worker's pass (QA 22 Nov 2026). A fake of canva_finish_jobs that
// applies the pass's own filters, order and limit:
//   P57-01  jobs that only wait (carousel slides waiting for their cover) are
//           due every minute; the pass takes turns, so a newer request's job
//           is handed out within a pass or two however many slides wait.
//   P57-02  video jobs are left out in the query, so 40 waiting videos do not
//           hide every design job.
//   P57-06  a hand-out that timed out may still be running: its lease is left
//           to run out. A definite refusal releases it.
import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as any;
const F = "../../functions";
type Row = Record<string, any>;
let jobs: Row[];
let released: string[];
const claimed: string[] = [];

const valueOf = (r: Row, field: string) => (field === "input->>kind" ? r.input?.kind ?? null : r[field] ?? null);
/** One PostgREST condition of an or=(...) list: field.is.null, field.lt.v, field.neq.v. */
function holds(r: Row, cond: string): boolean {
  const m = /^(.+?)\.(is|lt|neq|eq)\.(.+)$/.exec(cond);
  if (!m) throw new Error(`fake cannot read ${cond}`);
  const v = valueOf(r, m[1]);
  if (m[2] === "is") return v === null;
  if (m[2] === "lt") return v !== null && String(v) < m[3];
  if (m[2] === "neq") return v !== null && String(v) !== m[3];
  return String(v) === m[3];
}

function fakeAdmin() {
  return {
    from(table: string) {
      let rows: Row[] = table === "canva_finish_jobs" ? [...jobs] : [];
      const orders: string[] = [];
      let limit = Infinity;
      let change: Row | null = null;
      const chain: any = {
        select: () => chain,
        update: (c: Row) => { change = c; return chain; },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return chain; },
        or: (list: string) => { const conds = list.split(","); rows = rows.filter((r) => conds.some((c) => holds(r, c))); return chain; },
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return chain; },
        neq: () => chain, lt: () => chain, is: () => chain,
        order: (col: string) => { orders.push(col); return chain; },
        limit: (n: number) => { limit = n; return chain; },
        then: (ok: any, bad: any) => {
          if (change) {
            for (const r of rows) { Object.assign(r, change); if (change.lease_until === null) released.push(r.id); }
            return Promise.resolve({ data: rows, error: null }).then(ok, bad);
          }
          const sorted = [...rows].sort((a, b) => { for (const o of orders) { const c = String(a[o]).localeCompare(String(b[o])); if (c) return c; } return 0; });
          return Promise.resolve({ data: sorted.slice(0, limit).map((r) => ({ ...r, kind: r.input?.kind ?? null })), error: null }).then(ok, bad);
        },
      };
      return chain;
    },
  };
}

async function load() {
  vi.resetModules();
  vi.doMock(`${F}/_shared/supabase.ts`, () => ({ createClient: () => fakeAdmin() }));
  vi.doMock(`${F}/_shared/auth/secretEquals.ts`, () => ({ secretEquals: async () => true }));
  vi.doMock("https://deno.land/std@0.168.0/encoding/base64.ts", () => ({ encode: () => "", decode: () => new Uint8Array() }));
  vi.doMock(`${F}/_shared/media/imageEdit.ts`, () => ({ imageEdit: async () => new Uint8Array() }));
  vi.doMock(`${F}/_shared/canva/jobs.ts`, async () => ({
    BUCKET: "generated-media",
    // As claimJob does: the job is leased and its updated_at moves to now.
    claimJob: async (_a: any, row: Row, now: Date) => {
      const job = jobs.find((j) => j.id === row.id)!;
      job.updated_at = now.toISOString();
      claimed.push(row.id);
      return "claimed";
    },
    endOverdueRequests: async () => [], endRequest: async () => undefined, renewJobLease: async () => undefined,
    saveJobProgress: async () => undefined, settleRequest: async () => undefined,
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("none", { status: 599 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import(`${F}/design-worker/index.ts`);
  return handler;
}
afterEach(() => { delete g.Deno; delete g.EdgeRuntime; vi.unstubAllGlobals(); vi.useRealTimers(); });

async function tick(at: string, answer: () => Promise<Response> = async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(at));
  claimed.length = 0;
  released = [];
  const pending: Promise<unknown>[] = [];
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
  vi.stubGlobal("fetch", answer);
  const h = await load();
  await h(new Request("http://x/design-worker", { method: "POST", body: JSON.stringify({ action: "tick" }) }));
  await Promise.all(pending);
  // The slides only wait: each run leaves them due again, with their lease released.
  for (const j of jobs) j.lease_until = null;
  return [...claimed];
}

const job = (id: string, o: Row = {}): Row => ({ id, step: "generate", status: "running", attempts: 0, lease_until: null, input: {}, created_at: "2026-11-20T09:00:00Z", updated_at: "2026-11-20T09:59:30Z", ...o });

describe("the design worker's pass", () => {
  it("hands out a newer request's job within two passes behind 12 slides that only wait", async () => {
    jobs = [
      ...Array.from({ length: 12 }, (_, i) => job(`slide-${i}`, { created_at: `2026-11-20T09:00:${String(i).padStart(2, "0")}Z` })),
      job("single-1", { status: "queued", created_at: "2026-11-20T09:59:45Z", updated_at: "2026-11-20T09:59:45Z" }),
    ];
    const passes = [await tick("2026-11-20T10:00:00Z"), await tick("2026-11-20T10:01:00Z")];
    expect(passes.some((c) => c.includes("single-1"))).toBe(true);
  });

  it("hands out a due design job behind 40 waiting video jobs", async () => {
    jobs = [
      ...Array.from({ length: 40 }, (_, i) => job(`video-${i}`, { step: "clip", input: { kind: "video" }, updated_at: "2026-11-20T09:00:00Z" })),
      job("design-1", { status: "queued" }),
    ];
    expect(await tick("2026-11-20T10:00:00Z")).toEqual(["design-1"]);
  });

  it("leaves the lease of a hand-out that timed out, and releases one that was refused", async () => {
    jobs = [job("design-1", { status: "queued" })];
    await tick("2026-11-20T10:00:00Z", async () => { throw new DOMException("The operation timed out.", "TimeoutError"); });
    expect(released).toEqual([]);
    await tick("2026-11-20T10:01:00Z", async () => new Response("busy", { status: 503 }));
    expect(released).toEqual(["design-1"]);
  });
});
