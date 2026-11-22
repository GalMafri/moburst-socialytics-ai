// @vitest-environment node
// QA 22 Nov 2026 (P31-07): the shared call-recording fake (supabase/functions/_shared/db.fake.ts) accepts any method
// name and answers every chain with the test's rows, so it cannot catch (a) a misspelled or
// nonexistent builder method, which throws TypeError in supabase-js, or (b) a write read back
// without .select(), which yields data null from PostgREST (return=minimal).
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../functions/_shared/db.fake";

describe("P31-07 db.fake.ts fidelity", () => {
  const { db } = fakeDb(() => ({ data: [{ id: "row" }] }));
  it("refuses a builder method supabase-js does not have", async () => {
    // deno-lint-ignore no-explicit-any
    const call = async () => (db.from("t") as any).select("id").eqq("client_id", "c"); // typo of .eq
    await expect(call()).rejects.toThrow(TypeError);
  });
  it("gives no rows back for an insert that never asked for them", async () => {
    // deno-lint-ignore no-explicit-any
    const { data } = await (db.from("t") as any).insert({ id: "row" });
    expect(data).toBeNull();
  });
});
