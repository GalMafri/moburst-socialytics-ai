// @vitest-environment node
// P37-02 (QA 22 Nov 2026): the refresh lease is 30 s but the token call had no limit. When the provider was slow,
// a second caller took over the "expired" lease while the first was still at the provider and spent the same
// refresh token; the first caller's end then cleared the second caller's lease and saved its older pair last.
// The hunt's repro let the provider ignore the abort and jumped the clock past the lease; in the real world the
// call is now given up inside the lease, and a caller whose lease was taken over writes nothing over the other's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";
import { accessTokenFor, TOKEN_TIMEOUT_MS } from "../../../functions/_shared/higgsfield/oauth";

const T0 = Date.parse("2026-11-20T10:00:00.000Z");
const MISSING = "Could not find the function public.higgsfield_tokens_read without parameters in the schema cache";
afterEach(() => vi.useRealTimers());

const world = () => {
  const missing = () => { throw new Error(MISSING); };
  return fakeDb(
    { integration_tokens: [{ provider: "higgsfield", client_id: "cid", refresh_token: "refresh-1", access_token: "access-1", expires_at: new Date(T0 - 1000).toISOString(), refreshing_until: null }] },
    { higgsfield_tokens_read: missing, higgsfield_tokens_save: missing },
  );
};

describe("one refresh at a time", () => {
  it("gives up a token call that does not answer well inside its lease, and lets the lease go", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const db = world();
    const provider = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    const a = accessTokenFor(db, provider, async () => {}).then(() => null, (e: Error) => e);
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS);
    const failed = await a;
    expect(failed?.message).toMatch(/did not answer in time/);
    // Given up before its 30-second lease ran out, so no other caller could have taken it over meanwhile.
    expect(Date.now() - T0).toBeLessThan(30_000);
    expect(db.tables.integration_tokens[0].refreshing_until).toBeNull();
  });

  it("never lets go of a lease another caller took over, nor keeps its older pair over that caller's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const db = world();
    let answer!: () => void;
    const answered = new Promise<void>((r) => { answer = r; });
    const provider = vi.fn(async () => {
      await answered;
      return new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = accessTokenFor(db, provider, async () => {});
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    // Meanwhile another caller holds the lease and has kept a newer pair.
    const theirs = new Date(T0 + 61_000).toISOString();
    Object.assign(db.tables.integration_tokens[0], { refreshing_until: theirs, refresh_token: "refresh-3", access_token: "access-3" });
    answer();
    expect(await a).toBe("access-2");
    expect(db.tables.integration_tokens[0]).toMatchObject({ refreshing_until: theirs, refresh_token: "refresh-3", access_token: "access-3" });
  });
});
