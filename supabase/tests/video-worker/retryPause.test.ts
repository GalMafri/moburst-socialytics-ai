/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// QA 22 Nov 2026 (P61-05): a video step whose error spent a try was due again
// on the next pass, about 15 seconds later, so a dependency down for a minute
// used every try and ended the video. Such a job now waits 1, 2, then 4
// minutes before its next step; a job that is working is never paused.
import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as any;
const F = "../../functions";
type Row = Record<string, any>;
let jobs: Row[];
const advanced: string[] = [];

function fakeAdmin() {
  return {
    rpc: async () => ({ data: true, error: null }),
    from() {
      let rows: Row[] = [...jobs];
      let update: Row | null = null;
      let head = false;
      const chain: any = {
        select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return chain; },
        update: (u: Row) => { update = u; return chain; },
        eq: (col: string, v: unknown) => { if (col === "id") rows = rows.filter((r) => r.id === v); return chain; },
        in: () => chain, or: () => chain, order: () => chain, limit: () => chain,
        then: (ok: any, bad: any) => {
          if (update) for (const r of rows) Object.assign(r, update);
          return Promise.resolve(head ? { count: 0 } : { data: rows, error: null }).then(ok, bad);
        },
      };
      return chain;
    },
  };
}

async function tick(at: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(at));
  advanced.length = 0;
  vi.resetModules();
  vi.doMock(`${F}/_shared/supabase.ts`, () => ({ createClient: () => fakeAdmin() }));
  vi.doMock(`${F}/_shared/auth/secretEquals.ts`, () => ({ secretEquals: async () => true }));
  vi.doMock(`${F}/_shared/canva/jobs.ts`, () => ({ settleRequest: async () => undefined }));
  vi.doMock(`${F}/_shared/canva/worker.ts`, () => ({ wakeVideoWorker: async () => undefined }));
  vi.doMock(`${F}/_shared/video/steps.ts`, () => ({ VIDEO_JOB_LEASE_MS: 300_000, runVideoStep: async () => "wait" }));
  vi.doMock(`${F}/_shared/video/advance.ts`, () => ({ advanceVideoJob: async (_a: any, job: Row) => { advanced.push(job.id); return false; } }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("none", { status: 599 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import(`${F}/video-worker/index.ts`);
  await handler(new Request("http://x/video-worker", { method: "POST", body: JSON.stringify({ action: "tick" }) }));
  return [...advanced];
}
afterEach(() => { delete g.Deno; vi.useRealTimers(); });

const job = (id: string, o: Row = {}): Row => ({ id, status: "running", attempts: 0, error: null, lease_until: null, updated_at: "2026-11-20T09:00:00Z", input: { kind: "video" }, ...o });

describe("the video worker after a step error that spent a try", () => {
  it("waits a minute after the first spent try, and takes the job up after it", async () => {
    jobs = [job("v1", { attempts: 1, error: "The title draw timed out.", updated_at: "2026-11-20T10:00:00Z" }), job("v2")];
    expect(await tick("2026-11-20T10:00:15Z")).toEqual(["v2"]);
    expect(await tick("2026-11-20T10:01:05Z")).toEqual(["v1", "v2"]);
  });

  it("waits longer as tries are spent", async () => {
    jobs = [job("v1", { attempts: 3, error: "The frame check did not answer.", updated_at: "2026-11-20T10:00:00Z" })];
    expect(await tick("2026-11-20T10:03:00Z")).toEqual([]);
    expect(await tick("2026-11-20T10:04:01Z")).toEqual(["v1"]);
  });

  it("never pauses a job whose last step moved on", async () => {
    jobs = [job("v1", { attempts: 2, error: null, updated_at: "2026-11-20T10:00:00Z" })];
    expect(await tick("2026-11-20T10:00:10Z")).toEqual(["v1"]);
  });
});
