// @vitest-environment node
// QA 22 Nov 2026 (regression R6 of P37-02 with P53-09): after the provider has rotated the refresh token, the renewal of
// this caller's refresh lease (keepRefresh) is a single database write. When
// that write fails (a dropped connection), accessTokenFor returns the new
// access token and never saves the rotated pair: the stored refresh token is
// the spent one, so the next refresh is refused and Higgsfield needs linking
// again. This is the outcome P53-09 set out to prevent.
// Expected: the rotated pair is kept (or the failure is retried / reported).
import { expect, it } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { accessTokenFor } from "../../../functions/_shared/higgsfield/oauth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

it("keeps the rotated refresh token when renewing the refresh lease fails once", async () => {
  const state = { vault: { refresh_token: "refresh-1", access_token: "access-1" } };
  const db = fakeDb(
    { integration_tokens: [{ provider: "higgsfield", client_id: "cid", expires_at: new Date(Date.now() - 3_600_000).toISOString() }] },
    {
      higgsfield_tokens_read: () => state.vault,
      higgsfield_tokens_save: (a: Row) => { state.vault = { refresh_token: String(a.p_refresh), access_token: String(a.p_access) }; return null; },
    },
  );
  // The second write of a refreshing_until time (after the claim) is the lease renewal: it does not get through.
  let leaseWrites = 0;
  const from = db.from.bind(db);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).from = (table: string) => {
    const b = from(table);
    if (table !== "integration_tokens") return b;
    const update = b.update.bind(b);
    b.update = (values: Row) => {
      if (typeof values.refreshing_until === "string" && ++leaseWrites === 2) {
        const failed: Row = {};
        for (const m of ["eq", "is", "lt", "select", "in"]) failed[m] = () => failed;
        failed.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "connection reset" } }).then(res);
        return failed;
      }
      return update(values);
    };
    return b;
  };
  const grant = (async () => new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;

  expect(await accessTokenFor(db, grant, async () => {})).toBe("access-2");
  // The provider has spent refresh-1. What is stored must be the rotated pair.
  expect(state.vault.refresh_token).toBe("refresh-2");
});
