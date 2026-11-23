import { afterEach, describe, it, expect, vi } from "vitest";
import { CALLBACK_TIMEOUT_MS, deliverCallback, deliverOnce, signBody } from "../../../functions/_shared/api/callback";

function fakeFetch(statuses: Array<number | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s instanceof Error) throw s;
    return new Response("", { status: s });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };
const opts = (f: ReturnType<typeof fakeFetch>) => ({ fetchImpl: f.fetchImpl, sleep, now: () => new Date("2026-09-30T12:00:00Z") });

describe("signBody", () => {
  it("is an HMAC-SHA256 over the body keyed by the key hash", async () => {
    expect(await signBody("{}", "abc")).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await signBody("{}", "abc")).toBe(await signBody("{}", "abc"));
    expect((await signBody("{}", "abc")).length).toBe(7 + 64);
    expect(await signBody("{}", "abc")).not.toBe(await signBody("{}", "abd"));
  });
});

describe("deliverCallback", () => {
  it("delivers on the first 2xx with the signature header", async () => {
    sleeps.length = 0;
    const f = fakeFetch([200]);
    const s = await deliverCallback("https://moburst.ai/hook", { job_id: "j1" }, "hash", opts(f));
    expect(s).toMatchObject({ delivered: true, attempts: 1, last_status: 200, last_error: null });
    expect(s.delivered_at).toBe("2026-09-30T12:00:00.000Z");
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-Demo-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(f.calls[0].init.body).toBe('{"job_id":"j1"}');
    expect(sleeps).toEqual([]);
  });
  it("retries with the documented delays", async () => {
    sleeps.length = 0;
    const f = fakeFetch([500, 500, 200]);
    const s = await deliverCallback("https://moburst.ai/hook", {}, "hash", opts(f));
    expect(s.delivered).toBe(true);
    expect(s.attempts).toBe(3);
    expect(sleeps).toEqual([60_000, 300_000]);
  });
  it("gives up after three attempts", async () => {
    const f = fakeFetch([500]);
    const s = await deliverCallback("https://moburst.ai/hook", {}, "hash", opts(f));
    expect(s).toMatchObject({ delivered: false, attempts: 3, last_status: 500 });
  });
  it("records a network failure", async () => {
    const f = fakeFetch([new Error("ECONNRESET")]);
    const s = await deliverCallback("https://moburst.ai/hook", {}, null, opts(f));
    expect(s.delivered).toBe(false);
    expect(s.last_error).toBe("ECONNRESET");
    expect((f.calls[0].init.headers as Record<string, string>)["X-Demo-Signature"]).toBeUndefined();
  });
  it("refuses a plain http URL without calling it", async () => {
    const f = fakeFetch([200]);
    const s = await deliverCallback("http://moburst.ai/hook", {}, "hash", opts(f));
    expect(s).toMatchObject({ delivered: false, attempts: 0, last_error: "callback_url must be https" });
    expect(f.calls).toEqual([]);
  });
});

describe("deliverOnce", () => {
  it("makes exactly one signed attempt and reports the status", async () => {
    const f = fakeFetch([503]);
    const r = await deliverOnce("https://moburst.ai/hook", { job_id: "j1" }, "hash", f.fetchImpl);
    expect(r).toEqual({ status: 503, error: "HTTP 503" });
    expect(f.calls).toHaveLength(1);
    expect((f.calls[0].init.headers as Record<string, string>)["X-Demo-Signature"]).toMatch(/^sha256=/);
    expect(await deliverOnce("https://moburst.ai/hook", {}, null, fakeFetch([200]).fetchImpl)).toEqual({ status: 200, error: null });
    expect(await deliverOnce("https://moburst.ai/hook", {}, null, fakeFetch([new Error("ECONNRESET")]).fetchImpl)).toEqual({ status: null, error: "ECONNRESET" });
    expect(await deliverOnce("http://plain", {}, null, fakeFetch([200]).fetchImpl)).toEqual({ status: null, error: "callback_url must be https" });
  });
});

// QA 22 Nov 2026 (P24-02): a receiver that takes the connection and never
// answers held the attempt open past the worker's wall clock, so the attempt
// was never counted and the demo job never finished.
describe("a receiver that never answers", () => {
  afterEach(() => vi.useRealTimers());
  const silent = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
  const deaf = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

  it("deliverOnce gives up after CALLBACK_TIMEOUT_MS, as an attempt nothing answered", async () => {
    vi.useFakeTimers();
    for (const f of [silent, deaf]) {
      let settled: { status: number | null; error: string | null } | "pending" = "pending";
      void deliverOnce("https://receiver.example/hook", { job_id: "j1" }, null, f).then((r) => { settled = r; });
      await vi.advanceTimersByTimeAsync(CALLBACK_TIMEOUT_MS + 1);
      expect(settled).toMatchObject({ status: null, error: expect.stringMatching(/no answer/) });
    }
    expect(CALLBACK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("deliverCallback counts each attempt that timed out", async () => {
    vi.useFakeTimers();
    let settled: unknown = "pending";
    void deliverCallback("https://receiver.example/hook", {}, null, { fetchImpl: deaf, sleep: async () => {} }).then((r) => { settled = r; });
    await vi.advanceTimersByTimeAsync(3 * CALLBACK_TIMEOUT_MS + 10);
    expect(settled).toMatchObject({ delivered: false, attempts: 3, last_status: null });
  });
});
