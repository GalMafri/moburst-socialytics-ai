import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../_shared/lifecycle/fakeDb";
import { AuthzError } from "../_shared/auth/authz";
import { type CopyDeps, saveCopy, undoNote } from "./copy";

// Saving a post's copy, and what the client's memory learns from it (notes on
// regenerate, Lital 3 Nov 2026): a person's edit teaches as before, a
// regeneration teaches only through the note someone left on it, and that
// learning can be taken back.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function world(post: Row = {}): FakeDb {
  return fakeDb({
    calendar_posts: [{ client_id: "c1", post_key: "post:p1", copy: "Join us Friday!", platform: "Instagram", format: "Single image", ...post }],
    post_iterations: [],
  });
}

const CHANGES = [{ op: "add" as const, id: "pref-1", description: "Never use exclamation marks.", platform: null }];

function deps(db: FakeDb, over: Partial<CopyDeps> = {}) {
  const d = {
    db,
    requireMember: vi.fn(async () => "person-1"),
    learn: vi.fn(async () => ({ ops: 1, changes: CHANGES })),
    undo: vi.fn(async () => 1),
    background: vi.fn(),
    ...over,
  };
  return d as typeof d & CopyDeps;
}

const regenerated = (over: Row = {}) => ({ client_id: "c1", calendar_post_key: "post:p1", post_copy: "Join us Friday.", platform: "Instagram", version: 2, source: "regeneration", ...over });

describe("save_copy", () => {
  it("teaches the memory through the note on a regeneration, with the copy before and after, and answers what it learned", async () => {
    const db = world();
    const d = deps(db);
    const r = await saveCopy(d, regenerated({ note: "  Never use exclamation marks  " }));
    expect(r.status ?? 200).toBe(200);
    expect(d.learn).toHaveBeenCalledWith("c1", { kind: "rewrite_note", note: "Never use exclamation marks", before: "Join us Friday!", after: "Join us Friday.", platform: "Instagram", story: false });
    expect(r.body).toEqual({ ok: true, learned: { changes: CHANGES } });
    expect(d.background).not.toHaveBeenCalled();
    expect(db.tables.post_iterations[0]).toMatchObject({ source: "regeneration", post_copy: "Join us Friday.", created_by: "person-1" });
    expect(db.tables.calendar_posts[0].copy).toBe("Join us Friday.");
  });

  it("never teaches from a regeneration without a note", async () => {
    const d = deps(world());
    const r = await saveCopy(d, regenerated());
    expect(r.body).toEqual({ ok: true });
    expect(d.learn).not.toHaveBeenCalled();
    expect(d.background).not.toHaveBeenCalled();
  });

  it("tells the memory a Story's message is a Story's", async () => {
    const d = deps(world({ format: "Story" }));
    await saveCopy(d, regenerated({ note: "Punchier" }));
    expect(d.learn.mock.calls[0][1]).toMatchObject({ kind: "rewrite_note", story: true });
  });

  it("saves the rewrite and answers with nothing learned when the learning does not finish", async () => {
    const db = world();
    const d = deps(db, { learn: vi.fn(async () => { throw new Error("model busy"); }) });
    const r = await saveCopy(d, regenerated({ note: "Shorter" }));
    expect(r.body).toEqual({ ok: true });
    expect(db.tables.calendar_posts[0].copy).toBe("Join us Friday.");
  });

  it("still teaches from a person's own edit in the background, as before, and a note there changes nothing", async () => {
    const d = deps(world());
    const r = await saveCopy(d, regenerated({ source: "calendar", post_copy: "Join us on Friday.", note: "ignored" }));
    expect(r.body).toEqual({ ok: true });
    expect(d.learn).toHaveBeenCalledWith("c1", { kind: "copy_edit", before: "Join us Friday!", after: "Join us on Friday.", platform: "Instagram" });
    expect(d.background).toHaveBeenCalledTimes(1);
  });

  it("checks membership before anything is written", async () => {
    const db = world();
    const d = deps(db, { requireMember: vi.fn(async () => { throw new AuthzError(403, "You do not have access to this client."); }) });
    await expect(saveCopy(d, regenerated({ note: "x" }))).rejects.toThrow(AuthzError);
    expect(db.tables.post_iterations).toEqual([]);
    expect(d.learn).not.toHaveBeenCalled();
  });

  it("asks for the post and its copy", async () => {
    expect((await saveCopy(deps(world()), { client_id: "c1", calendar_post_key: "post:p1" })).status).toBe(400);
  });
});

describe("undo_note", () => {
  it("takes back what a note taught, for a member of the client", async () => {
    const d = deps(world());
    const r = await undoNote(d, { client_id: "c1", changes: CHANGES });
    expect(d.requireMember).toHaveBeenCalledWith("c1");
    expect(d.undo).toHaveBeenCalledWith("c1", CHANGES);
    expect(r.body).toEqual({ ok: true, undone: 1 });
  });

  it("passes on only well-formed additions and replacements, at most three", async () => {
    const d = deps(world());
    await undoNote(d, { client_id: "c1", changes: [
      { op: "confirm", id: "p2", description: "x", platform: null },
      { op: "add", id: 7 },
      { op: "replace", id: "n1", description: "New.", platform: "LinkedIn", added: true, replaced: { id: "o1", description: "Old." } },
      "nonsense",
      ...CHANGES, ...CHANGES, ...CHANGES,
    ] });
    expect(d.undo.mock.calls[0][1]).toEqual([
      { op: "replace", id: "n1", description: "New.", platform: "LinkedIn", added: true, replaced: { id: "o1", description: "Old." } },
      CHANGES[0], CHANGES[0],
    ]);
  });

  it("asks for the client", async () => {
    expect((await undoNote(deps(world()), { changes: CHANGES })).status).toBe(400);
  });
});
