import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../support/lifecycleFakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { type UseDeps, putDesignInUse } from "../../functions/design-request/use";

// Putting a design in use: only a live design option of the caller's client,
// switched by one database call (use_design).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const iteration = (over: Row = {}): Row => ({ id: "it-1", client_id: "c1", calendar_post_key: "post:1", variant_angle: "Design option 1", is_selected: false, archived_at: null, rejected_at: null, ...over });

function setup(rows: Row[], used = true) {
  const db: FakeDb = fakeDb({ post_iterations: rows }, { use_design: () => used });
  const d = { db, requireMember: vi.fn(async () => "person-1") } satisfies UseDeps;
  return { db, d };
}
const calls = (db: FakeDb) => db.rpcCalls.filter((c) => c.name === "use_design");

describe("use", () => {
  it("answers 404 and changes nothing for a design someone deleted", async () => {
    const { db, d } = setup([iteration({ archived_at: "2026-11-02T10:00:00Z" })]);
    expect(await putDesignInUse(d, { iteration_id: "it-1" })).toMatchObject({ status: 404 });
    expect(calls(db)).toHaveLength(0);
  });

  it("answers 404 for a design turned down with Not right, for other media and for a row that is not there", async () => {
    for (const row of [iteration({ rejected_at: "2026-11-02T10:00:00Z" }), iteration({ variant_angle: "Reference creative 1" })]) {
      const { db, d } = setup([row]);
      expect(await putDesignInUse(d, { iteration_id: "it-1" })).toMatchObject({ status: 404 });
      expect(calls(db)).toHaveLength(0);
    }
    const { d } = setup([]);
    expect(await putDesignInUse(d, { iteration_id: "nope" })).toMatchObject({ status: 404 });
  });

  it("refuses someone who is not a member of the design's client, and changes nothing", async () => {
    const { db, d } = setup([iteration()]);
    d.requireMember.mockRejectedValue(new AuthzError(403, "You do not have access to this client."));
    await expect(putDesignInUse(d, { iteration_id: "it-1" })).rejects.toMatchObject({ status: 403 });
    expect(d.requireMember).toHaveBeenCalledWith("c1");
    expect(calls(db)).toHaveLength(0);
  });

  it("puts a live design in use with one call", async () => {
    const { db, d } = setup([iteration()]);
    expect(await putDesignInUse(d, { iteration_id: "it-1" })).toEqual({ body: { ok: true } });
    expect(calls(db)).toEqual([{ name: "use_design", args: { p_iteration: "it-1" } }]);
  });

  it("answers 404 when the database does not take the design (it was deleted meanwhile)", async () => {
    const { d } = setup([iteration()], false);
    expect(await putDesignInUse(d, { iteration_id: "it-1" })).toMatchObject({ status: 404 });
  });
});
