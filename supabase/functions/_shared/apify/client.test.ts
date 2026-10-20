// @vitest-environment node
// The Apify client against a stand-in API: the requests it makes, its quiet
// retries, the start it never repeats blindly, the dataset read a page at a
// time, and a missing token that is a wait, not a failure.
import { describe, expect, it } from "vitest";
import { apifyClient, ApifyError, apifyRetryWaitMs, ApifyTokenMissing, isFinalRunStatus } from "./client";

type Call = { method: string; url: string; auth: string | null; body: unknown };

function api(answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, auth: new Headers(init?.headers).get("Authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    if (next instanceof Error) throw next;
    return next;
  };
  const waits: number[] = [];
  return { calls, waits, fetchImpl, sleep: async (ms: number) => { waits.push(ms); } };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, text = "") => new Response(text, { status: code });
const RUN = { id: "run-1", status: "RUNNING", defaultDatasetId: "ds-1" };

describe("apifyClient", () => {
  it("starts an actor run with its input, timeout and memory, authenticated by the token", async () => {
    const a = api([ok({ data: RUN })]);
    const run = await apifyClient({ token: "tok", fetchImpl: a.fetchImpl, sleep: a.sleep }).startRun("WI0tj4Ieb5Kq458gB", { targetUrls: ["u"] }, { timeoutSecs: 240, memoryMbytes: 512 });
    expect(run).toEqual(RUN);
    expect(a.calls).toEqual([{ method: "POST", url: "https://api.apify.com/v2/acts/WI0tj4Ieb5Kq458gB/runs?timeout=240&memory=512", auth: "Bearer tok", body: { targetUrls: ["u"] } }]);
  });

  it("looks at a run with Apify holding the answer up to a minute, never longer", async () => {
    const a = api([ok({ data: { ...RUN, status: "SUCCEEDED" } }), ok({ data: RUN })]);
    const c = apifyClient({ token: "tok", fetchImpl: a.fetchImpl, sleep: a.sleep });
    expect((await c.getRun("run-1", { waitSecs: 600 })).status).toBe("SUCCEEDED");
    await c.getRun("run-1");
    expect(a.calls.map((x) => x.url)).toEqual(["https://api.apify.com/v2/actor-runs/run-1?waitForFinish=60", "https://api.apify.com/v2/actor-runs/run-1"]);
    expect(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].every(isFinalRunStatus)).toBe(true);
    expect(["READY", "RUNNING", "TIMING-OUT", "ABORTING"].some(isFinalRunStatus)).toBe(false);
  });

  it("reads a dataset a page at a time until a short page", async () => {
    const page = (n: number, from: number) => ok(Array.from({ length: n }, (_, i) => ({ i: from + i })));
    const a = api([page(2, 0), page(2, 2), page(1, 4)]);
    const items = await apifyClient({ token: "tok", fetchImpl: a.fetchImpl, sleep: a.sleep }).datasetItems("ds-1", { pageSize: 2 });
    expect(items).toHaveLength(5);
    expect(a.calls.map((x) => new URL(x.url).searchParams.get("offset"))).toEqual(["0", "2", "4"]);
    const b = api([page(2, 0), page(2, 2)]);
    await expect(apifyClient({ token: "tok", fetchImpl: b.fetchImpl, sleep: b.sleep }).datasetItems("ds-1", { pageSize: 2, maxItems: 3 })).rejects.toThrow("more than 3 items");
  });

  it("tries a read again quietly after a rate limit, a server error or a dropped connection", async () => {
    const a = api([status(429), status(502), new TypeError("connection reset"), ok({ data: RUN })]);
    expect((await apifyClient({ token: "tok", fetchImpl: a.fetchImpl, sleep: a.sleep }).getRun("run-1")).id).toBe("run-1");
    expect(a.waits).toEqual([1000, 2000, 4000]);
    const b = api([status(500), status(500), status(500), status(500)]);
    await expect(apifyClient({ token: "tok", fetchImpl: b.fetchImpl, sleep: b.sleep }).getRun("run-1")).rejects.toBeInstanceOf(ApifyError);
    const c = api([status(404, "not found")]);
    await expect(apifyClient({ token: "tok", fetchImpl: c.fetchImpl, sleep: c.sleep }).getRun("run-1")).rejects.toThrow("answered 404");
    expect(c.calls).toHaveLength(1);
  });

  it("starts a run again only when Apify refused it, never after a lost answer", async () => {
    const a = api([status(429), ok({ data: RUN })]);
    expect((await apifyClient({ token: "tok", fetchImpl: a.fetchImpl, sleep: a.sleep }).startRun("actor", {}, { timeoutSecs: 240, memoryMbytes: 512 })).id).toBe("run-1");
    const b = api([new TypeError("socket hang up"), ok({ data: RUN })]);
    await expect(apifyClient({ token: "tok", fetchImpl: b.fetchImpl, sleep: b.sleep }).startRun("actor", {}, { timeoutSecs: 240, memoryMbytes: 512 })).rejects.toThrow("socket hang up");
    expect(b.calls).toHaveLength(1);
    const c = api([status(500)]);
    await expect(apifyClient({ token: "tok", fetchImpl: c.fetchImpl, sleep: c.sleep }).startRun("actor", {}, { timeoutSecs: 240, memoryMbytes: 512 })).rejects.toThrow("answered 500");
    expect(c.calls).toHaveLength(1);
  });

  it("honors a Retry-After of up to 10 s", () => {
    expect(apifyRetryWaitMs(0, "3")).toBe(3000);
    expect(apifyRetryWaitMs(0, "120")).toBe(10_000);
    expect(apifyRetryWaitMs(2, null)).toBe(4000);
  });

  it("is a quiet wait without a token, and never shows the token in an error", async () => {
    const a = api([]);
    await expect(apifyClient({ token: "  ", fetchImpl: a.fetchImpl }).getRun("run-1")).rejects.toBeInstanceOf(ApifyTokenMissing);
    expect(a.calls).toEqual([]);
    const b = api([status(401, "token secret-token is not valid")]);
    await expect(apifyClient({ token: "secret-token", fetchImpl: b.fetchImpl, sleep: b.sleep }).getRun("run-1")).rejects.toThrow("token [redacted] is not valid");
  });
});
