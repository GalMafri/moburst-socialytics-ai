// @vitest-environment node
// How a preview request reaches the database (role-preview/store.ts): one
// read of the person's open row, and the two functions that each make a
// whole switch in one transaction. No table is written from here, and an
// answer that cannot be read is an error, never a start and never an exit.
import { describe, expect, it } from "vitest";
import { eqs, fakeDb, op } from "../support/dbFake.ts";
import { previewStore, readBegin, readEnd, readPreview } from "../../functions/role-preview/store.ts";

const USER = "00000000-0000-4000-8000-0000000000a1";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const ROW = { id: "p1", client_id: CLIENT, client_name: "North Bakery", started_at: "2026-11-18T09:00:00+00:00" };

describe("the preview's database calls", () => {
  it("makes each switch with one function call and writes no table", async () => {
    const { db, calls } = fakeDb((call) => (call.table === "rpc:role_preview_begin" ? { data: { code: "started", preview: ROW } } : { data: { open: false, ended: "exited" } }));
    const store = previewStore(db);
    expect(await store.begin(USER, CLIENT)).toEqual({ code: "started", preview: { ...ROW, started_at: "2026-11-18T09:00:00.000Z" } });
    expect(await store.end("p1", "exited")).toEqual({ open: false, ended: "exited" });
    expect(calls.map((c) => [c.table, op(c, "rpc")?.[0]])).toEqual([
      ["rpc:role_preview_begin", { p_user: USER, p_client: CLIENT }],
      ["rpc:role_preview_end", { p_id: "p1", p_reason: "exited" }],
    ]);
  });

  it("reads only the person's own open row", async () => {
    const { db, calls } = fakeDb(() => ({ data: ROW }));
    expect(await previewStore(db).openPreview(USER)).toMatchObject({ id: "p1", client_id: CLIENT });
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("role_previews");
    expect(eqs(calls[0])).toEqual({ user_id: USER });
    expect(op(calls[0], "is")).toEqual(["ended_at", null]);
    expect(calls[0].ops.map(([name]) => name)).not.toEqual(expect.arrayContaining(["insert", "update", "upsert", "delete"]));
  });

  it("throws when the database refuses, so a switch that did not happen is never taken for one that did", async () => {
    const { db } = fakeDb(() => ({ error: { message: "connection reset" } }));
    const store = previewStore(db);
    await expect(store.begin(USER, CLIENT)).rejects.toThrow(/begin preview/);
    await expect(store.end("p1", "check")).rejects.toThrow(/end preview/);
    await expect(store.openPreview(USER)).rejects.toThrow(/read preview/);
  });
});

describe("reading the functions' answers", () => {
  it("takes a start or an open preview only with the preview itself", () => {
    expect(readBegin({ code: "not_staff" })).toEqual({ code: "not_staff", preview: null });
    expect(() => readBegin({ code: "started" })).toThrow(/no preview/);
    expect(() => readBegin({ code: "already_previewing", preview: { id: "p1" } })).toThrow(/no preview/);
  });

  it("refuses an answer it does not know", () => {
    for (const answer of [null, {}, { code: "ok", preview: ROW }, "started"]) expect(() => readBegin(answer)).toThrow(/unreadable/);
    for (const answer of [null, {}, { ended: "exited" }, { open: "false" }]) expect(() => readEnd(answer)).toThrow(/unreadable/);
  });

  it("keeps a preview whose client was deleted, and drops a reason it does not know", () => {
    expect(readPreview({ ...ROW, client_id: null })).toMatchObject({ client_id: null, client_name: "North Bakery" });
    expect(readEnd({ open: false, ended: "because" })).toEqual({ open: false, ended: null });
    expect(readEnd({ open: true, ended: null })).toEqual({ open: true, ended: null });
  });
});
