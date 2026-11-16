// @vitest-environment node
// Runs in Node: the claim sets AbortSignal.timeout, which jsdom lacks.
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_DEFAULTS } from "../../public-env.ts";
import { CLAIM_TIMEOUT_MS, databaseClaim, isCallId } from "../src/call.ts";

const CALL = "5f0c2f6e-8a1b-4c3d-9e2f-1a2b3c4d5e6f";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake fetch that answers once (an Error is thrown) and records the call. */
function fakeFetch(answer: Response | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("isCallId", () => {
  it("is true for a UUID and false for anything else", () => {
    expect(isCallId(CALL)).toBe(true);
    expect(isCallId(CALL.toUpperCase())).toBe(true);
    for (const v of [undefined, null, "", "wrong", `${CALL}0`, ` ${CALL}`, `${CALL}\n`, CALL.replace(/-/g, ""), 7]) expect(isCallId(v), String(v)).toBe(false);
  });
});

describe("databaseClaim", () => {
  it("asks the project's public REST endpoint to claim the id, with the public anon key from the repository's public values", async () => {
    const { calls, fetchImpl } = fakeFetch(json(200, true));
    expect(await databaseClaim(fetchImpl)(CALL)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/rest/v1/rpc/claim_picture_call`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      apikey: PUBLIC_DEFAULTS.VITE_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${PUBLIC_DEFAULTS.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_call: CALL });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is false when the database says the call is not ours to claim", async () => {
    const { fetchImpl } = fakeFetch(json(200, false));
    expect(await databaseClaim(fetchImpl)(CALL)).toBe(false);
  });

  it("throws, naming only the status, when the database answers anything but 200: missing function, refused key, busy or down", async () => {
    for (const status of [401, 404, 429, 500, 503]) {
      const { fetchImpl } = fakeFetch(json(status, { code: "PGRST202", message: `no function for ${CALL}` }));
      await expect(databaseClaim(fetchImpl)(CALL)).rejects.toThrow(`The database answered ${status}.`);
    }
  });

  it("throws when a 200 answer is not true or false", async () => {
    for (const body of [null, "true", 1, { claimed: true }, [true]]) {
      const { fetchImpl } = fakeFetch(json(200, body));
      await expect(databaseClaim(fetchImpl)(CALL)).rejects.toThrow("The database gave an answer that is not true or false.");
    }
    const page = fakeFetch(new Response("<html>OK</html>", { status: 200 }));
    await expect(databaseClaim(page.fetchImpl)(CALL)).rejects.toThrow("The database gave an answer that is not true or false.");
  });

  it("throws when the database cannot be reached", async () => {
    const { fetchImpl } = fakeFetch(new TypeError("fetch failed"));
    await expect(databaseClaim(fetchImpl)(CALL)).rejects.toThrow("The database could not be reached: fetch failed.");
  });

  it("gives up after a short time, well inside the worker's own wait for the service", async () => {
    expect(CLAIM_TIMEOUT_MS).toBe(5_000);
    // A database that never answers: only the signal ends the call.
    const hangs = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
    const spy = vi.fn(hangs);
    await expect(databaseClaim(spy as unknown as typeof fetch, 20)(CALL)).rejects.toThrow("The database could not be reached: timeout.");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
