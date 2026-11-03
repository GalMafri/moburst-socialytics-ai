import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeDb, type FakeDb } from "../_shared/lifecycle/fakeDb";
import { AuthzError } from "../_shared/auth/authz";
import { type NoteDeps, learnDesignNote, noteLearnedOf, undoDesignNote } from "./note";

// A note left on a design's Regenerate (notes on regenerate, Lital 3 Nov
// 2026): the design follows it, the brand's design memory keeps it only when
// it is lasting, and what was learned is written on the request with Undo.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const NOTE = "Never show people, only the rink";

function world(request: Row = {}, learnings: Row[] = []): FakeDb {
  return fakeDb({
    design_requests: [{ id: "req-1", client_id: "c1", platform: "Instagram", format: "Single image", note: NOTE, note_learned: null, status: "preparing", ...request }],
    design_learnings: learnings,
  });
}

function deps(db: FakeDb, over: Partial<NoteDeps> = {}) {
  const d = {
    db,
    requireMember: vi.fn(async () => "person-1"),
    learn: vi.fn(async () => [{ id: "dl-1", pattern_type: "avoid", pattern_description: "Never show people." }]),
    now: () => new Date("2026-11-03T12:00:00Z"),
    ...over,
  };
  return d as typeof d & NoteDeps;
}

describe("learnDesignNote", () => {
  it("asks the memory about the note and writes what it learned on the request", async () => {
    const db = world();
    const d = deps(db);
    await learnDesignNote(d, db.tables.design_requests[0], "person-1");
    expect(d.learn).toHaveBeenCalledWith({ clientId: "c1", platform: "Instagram", format: "Single image", note: NOTE, userId: "person-1" });
    expect(db.tables.design_requests[0].note_learned).toEqual({ rules: [{ id: "dl-1", type: "avoid", text: "Never show people." }] });
  });

  it("writes an empty list for a note about this design alone: used for this design only", async () => {
    const db = world();
    await learnDesignNote(deps(db, { learn: vi.fn(async () => []) }), db.tables.design_requests[0], "person-1");
    expect(db.tables.design_requests[0].note_learned).toEqual({ rules: [] });
  });

  it("writes nothing when the learning did not finish, so no learned line shows", async () => {
    const db = world();
    await learnDesignNote(deps(db, { learn: vi.fn(async () => null) }), db.tables.design_requests[0], "person-1");
    expect(db.tables.design_requests[0].note_learned).toBeNull();
  });

  it("asks nothing for a request without a note", async () => {
    const db = world({ note: null });
    const d = deps(db);
    await learnDesignNote(d, db.tables.design_requests[0], "person-1");
    expect(d.learn).not.toHaveBeenCalled();
  });
});

describe("noteLearnedOf", () => {
  it("keeps the rules Not right stored, by id; none stored is nothing learned yet", () => {
    expect(noteLearnedOf([{ id: "a", pattern_type: "prefer", pattern_description: "Dark rinks." }, { pattern_type: "avoid", pattern_description: "Not stored." }])).toEqual({ rules: [{ id: "a", type: "prefer", text: "Dark rinks." }] });
    expect(noteLearnedOf([{ pattern_type: "avoid", pattern_description: "Not stored." }])).toBeNull();
    expect(noteLearnedOf(null)).toBeNull();
  });
});

describe("undo_note", () => {
  const learned = { rules: [{ id: "dl-1", type: "avoid", text: "Never show people." }, { id: "dl-2", type: "prefer", text: "Night rinks." }] };

  it("removes the rules the note taught, for a member of the client, and marks the request undone", async () => {
    const db = world({ note_learned: learned }, [
      { id: "dl-1", client_id: "c1", pattern_type: "avoid", pattern_description: "Never show people." },
      { id: "dl-2", client_id: "c1", pattern_type: "prefer", pattern_description: "Night rinks." },
      { id: "dl-9", client_id: "c1", pattern_type: "avoid", pattern_description: "From Not right." },
    ]);
    const d = deps(db);
    const r = await undoDesignNote(d, { request_id: "req-1" });
    expect(d.requireMember).toHaveBeenCalledWith("c1");
    expect(db.tables.design_learnings.map((l) => l.id)).toEqual(["dl-9"]);
    expect(db.tables.design_requests[0].note_learned).toEqual({ ...learned, undone_at: "2026-11-03T12:00:00.000Z" });
    expect(r.body).toMatchObject({ ok: true, request: { id: "req-1" } });
  });

  it("never removes another client's rule, and a second press changes nothing", async () => {
    const db = world({ note_learned: learned }, [{ id: "dl-1", client_id: "c2", pattern_type: "avoid", pattern_description: "Theirs." }]);
    await undoDesignNote(deps(db), { request_id: "req-1" });
    expect(db.tables.design_learnings).toHaveLength(1);
    const once = db.tables.design_requests[0].note_learned;
    await undoDesignNote(deps(db, { now: () => new Date("2026-11-04T00:00:00Z") }), { request_id: "req-1" });
    expect(db.tables.design_requests[0].note_learned).toEqual(once);
  });

  it("checks membership before anything is removed", async () => {
    const db = world({ note_learned: learned }, [{ id: "dl-1", client_id: "c1" }]);
    const d = deps(db, { requireMember: vi.fn(async () => { throw new AuthzError(403, "You do not have access to this client."); }) });
    await expect(undoDesignNote(d, { request_id: "req-1" })).rejects.toThrow(AuthzError);
    expect(db.tables.design_learnings).toHaveLength(1);
  });

  it("asks for a request that exists", async () => {
    expect((await undoDesignNote(deps(world()), { request_id: "gone" })).status).toBe(404);
  });
});

describe("design-request and the note", () => {
  const index = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
  const action = (name: string) => index.slice(index.indexOf(`if (body?.action === "${name}")`), index.indexOf("if (body?.action", index.indexOf(`if (body?.action === "${name}")`) + 10));

  it("stores the note on every request it starts, with what was learned when Not right learned it", () => {
    const start = index.slice(index.indexOf("async function startRequest("), index.indexOf("const work = plan(", index.indexOf("async function startRequest(")));
    expect(start).toContain("note: p.note ?? null, note_learned: p.noteLearned ?? null,");
  });

  it("create takes the note and learns from it; Not right's new design carries its note and what it taught", () => {
    expect(action("create")).toMatch(/note: note \|\| null, learnNote: true/);
    expect(action("feedback")).toMatch(/note: note \|\| null, noteLearned: note \? noteLearnedOf\(learnings\) : null/);
  });

  it("hands the note to every planner", () => {
    expect(index).toMatch(/const common = \{[^}]*note: request\.note \?\? null/);
  });
});
