// Saving a calendar post's copy, the one path for the calendar's Save and
// Regenerate (calendar-posts save_copy and undo_note) and for copy approved
// in Claude (the connector's socialytics_post_copy_save). The calendar's rows
// are the rows it wrote before the move; a person's edit teaches the memory
// in the background, a regeneration only through the note left on it, and
// that learning can be taken back. A save from Claude carries the updated_at
// it read and is refused, with the current copy, when the post changed since.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AuthzError } from "../../../functions/_shared/auth/authz";
import { eqs, fakeDb, op } from "../../../functions/_shared/db.fake";
import { fakeDb as tableDb, type FakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import type { LearnedChange, MemorySignal } from "../../../functions/_shared/voice/voice";
import { copyWrites, sameInstant, saveCopy, saveCopyAction, undoNote, type CopyDeps, type CopyMemory, type CopyPost, type CopyWrites, type IterationRow } from "../../../functions/_shared/calendar/saveCopy";
import { functionsDir } from "../../paths.ts";

const CLIENT = "00000000-0000-4000-8000-000000000001";
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const KEY = "plan:2026-11-09:instagram:1";
const AT = "2026-11-03T10:15:42.123456+00:00";
const NOW = new Date("2026-11-03T12:00:00.000Z");

function writes(post: CopyPost | null, over: Partial<CopyWrites> = {}) {
  const iterations: IterationRow[] = [];
  const updates: Array<{ fields: Record<string, unknown>; unchangedSince?: string }> = [];
  let current = post;
  const w: CopyWrites = {
    post: async () => current,
    lastVersion: async () => 2,
    insertIteration: async (row) => { iterations.push(row); },
    updatePost: async (_c, _k, fields, unchangedSince) => {
      updates.push({ fields, unchangedSince });
      if (unchangedSince && current && !sameInstant(unchangedSince, current.updated_at)) return null;
      if (current) current = { ...current, copy: String(fields.copy), updated_at: "2026-11-03T12:00:00.5+00:00" };
      return current?.updated_at ?? null;
    },
    ...over,
  };
  return { w, iterations, updates, set: (p: CopyPost) => { current = p; } };
}
const POST: CopyPost = { copy: "Hurt in a crash? Call us.", hashtags: ["injurylaw"], cta: "Call now", platform: "Instagram", format: "Single image", updated_at: AT };

/** The memory as a test sees it: what it was taught, and the work left to run after the answer. */
function memory(changes: LearnedChange[] = []) {
  const taught: MemorySignal[] = [];
  const later: Array<Promise<unknown>> = [];
  const m: CopyMemory = {
    learn: vi.fn(async (signal: MemorySignal) => { taught.push(signal); return { changes }; }),
    background: vi.fn((work: Promise<unknown>) => { later.push(work); }),
  };
  return { m, taught, later };
}

describe("sameInstant", () => {
  it("compares two timestamps to the microsecond, whatever their zone is written as", () => {
    expect(sameInstant(AT, "2026-11-03T10:15:42.123456Z")).toBe(true);
    expect(sameInstant(AT, "2026-11-03 12:15:42.123456+02")).toBe(true);
    expect(sameInstant(AT, "2026-11-03T05:15:42.123456-0500")).toBe(true);
    expect(sameInstant("2026-11-03T10:15:42+00:00", "2026-11-03T10:15:42.000Z")).toBe(true);
    expect(sameInstant(AT, "2026-11-03T10:15:42.123457+00:00")).toBe(false);
    expect(sameInstant(AT, "2026-11-03T10:15:42.123+00:00")).toBe(false);
    for (const bad of ["", "yesterday", null, undefined, 42]) expect(sameInstant(AT, bad)).toBe(false);
  });
});

describe("saveCopy from the calendar", () => {
  it("writes the revision row and the post's copy as calendar-posts did, and teaches the memory from a person's edit", async () => {
    const { w, iterations, updates } = writes(POST);
    const { m, taught, later } = memory();
    const r = await saveCopy(w, {
      clientId: CLIENT, key: KEY, copy: "  Hurt in a crash? We answer 24/7. ", hashtags: ["injurylaw", 7], cta: "Call", reportId: "r1", version: "3",
      platform: "instagram", concept: "c", visualDirection: "v", format: "reel", source: "calendar", userId: PERSON, now: NOW,
    }, m);
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(iterations).toEqual([{
      client_id: CLIENT, report_id: "r1", calendar_post_key: KEY, version: 3, platform: "instagram", post_copy: "Hurt in a crash? We answer 24/7.",
      hashtags: ["injurylaw", "7"], cta: "Call", concept: "c", visual_direction: "v", format: "reel", source: "calendar", created_by: PERSON,
    }]);
    expect(updates).toEqual([{ fields: { copy: "Hurt in a crash? We answer 24/7.", touched_at: NOW.toISOString(), hashtags: ["injurylaw", "7"], cta: "Call" }, unchangedSince: undefined }]);
    // In the background: the answer does not wait for the memory.
    expect(taught).toEqual([{ kind: "copy_edit", before: POST.copy, after: "Hurt in a crash? We answer 24/7.", platform: "Instagram" }]);
    expect(later).toHaveLength(1);
    expect(r).toEqual({ ok: true, changed: true, updatedAt: "2026-11-03T12:00:00.5+00:00" });
  });

  it("keeps the calendar's defaults: version 1, no hashtags or CTA left untouched, a regeneration without a note teaches nothing", async () => {
    const { w, iterations, updates } = writes(null);
    const { m, taught } = memory();
    await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "New", source: "regeneration", userId: PERSON, now: NOW }, m);
    expect(iterations[0]).toMatchObject({ version: 1, report_id: null, platform: null, hashtags: null, cta: null, concept: null, visual_direction: null, format: null, source: "regeneration" });
    expect(updates[0].fields).toEqual({ copy: "New", touched_at: NOW.toISOString() });
    expect(taught).toEqual([]);
  });

  it("teaches a regeneration's note, waiting for it, and answers what it learned", async () => {
    const CHANGES: LearnedChange[] = [{ op: "add", id: "pref-1", description: "Never use exclamation marks.", platform: null }];
    const { w } = writes({ ...POST, format: "Story" });
    const { m, taught, later } = memory(CHANGES);
    const r = await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "Hurt in a crash? Call.", source: "regeneration", note: "  No exclamation marks ", userId: PERSON, now: NOW }, m);
    expect(taught).toEqual([{ kind: "rewrite_note", note: "No exclamation marks", before: POST.copy, after: "Hurt in a crash? Call.", platform: "Instagram", story: true }]);
    expect(later).toEqual([]);
    expect(r).toMatchObject({ ok: true, changed: true, learned: { changes: CHANGES } });
  });

  it("refuses empty copy", async () => {
    const { w, iterations } = writes(POST);
    expect(await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "  ", source: "calendar", userId: PERSON, now: NOW })).toEqual({ ok: false, status: 400, error: "client_id, calendar_post_key and post_copy are required." });
    expect(iterations).toEqual([]);
  });
});

describe("saveCopy from Claude", () => {
  const claude = (over: Record<string, unknown> = {}) => ({ clientId: CLIENT, key: KEY, copy: "Hurt in a crash? We answer 24/7.", source: "claude" as const, userId: PERSON, now: NOW, basedOn: "2026-11-03T10:15:42.123456Z", ...over });

  it("saves only while the post is as Claude read it, then writes a revision from Claude after the latest one", async () => {
    const { w, iterations, updates } = writes(POST);
    const { m, taught, later } = memory();
    const r = await saveCopy(w, claude({ hashtags: ["#injurylaw", " ", "#queens"], cta: "Call today" }), m);
    expect(r).toEqual({ ok: true, changed: true, updatedAt: "2026-11-03T12:00:00.5+00:00" });
    expect(updates).toEqual([{ fields: { copy: "Hurt in a crash? We answer 24/7.", touched_at: NOW.toISOString(), hashtags: ["#injurylaw", "#queens"], cta: "Call today" }, unchangedSince: AT }]);
    expect(iterations).toEqual([{
      client_id: CLIENT, report_id: null, calendar_post_key: KEY, version: 3, platform: "Instagram", post_copy: "Hurt in a crash? We answer 24/7.",
      hashtags: ["#injurylaw", "#queens"], cta: "Call today", concept: null, visual_direction: null, format: null, source: "claude", created_by: PERSON,
    }]);
    expect(taught).toEqual([{ kind: "copy_edit", before: POST.copy, after: "Hurt in a crash? We answer 24/7.", platform: "Instagram" }]);
    expect(later).toHaveLength(1);
  });

  it("refuses a save based on an older read, and answers with the copy as it is now", async () => {
    const { w, iterations, updates } = writes({ ...POST, copy: "Edited in the app", updated_at: "2026-11-03T11:00:00.000001+00:00" });
    expect(await saveCopy(w, claude())).toEqual({
      ok: false, status: 409, error: "This post changed in Socialytics after you read it.",
      current: { copy: "Edited in the app", hashtags: ["injurylaw"], cta: "Call now", platform: "Instagram", format: "Single image", updated_at: "2026-11-03T11:00:00.000001+00:00" },
    });
    expect(updates).toEqual([]);
    expect(iterations).toEqual([]);
  });

  it("refuses when the post changes between the check and the save, and writes no revision", async () => {
    const t = writes(POST);
    const racing: CopyWrites = { ...t.w, post: async () => POST, updatePost: async () => null };
    let reads = 0;
    racing.post = async () => (reads++ === 0 ? POST : { ...POST, copy: "Changed a moment ago", updated_at: "2026-11-03T11:59:59Z" });
    const r = await saveCopy(racing, claude());
    expect(r).toMatchObject({ ok: false, status: 409, current: { copy: "Changed a moment ago" } });
    expect(t.iterations).toEqual([]);
  });

  it("changes nothing when the copy is what is stored, and says so", async () => {
    const { w, iterations, updates } = writes(POST);
    expect(await saveCopy(w, claude({ copy: ` ${POST.copy} `, basedOn: "2026-10-01T00:00:00Z" }))).toEqual({ ok: true, changed: false, updatedAt: AT });
    expect(await saveCopy(w, claude({ copy: POST.copy, hashtags: ["injurylaw"], cta: "Call now" }))).toEqual({ ok: true, changed: false, updatedAt: AT });
    expect(updates).toEqual([]);
    expect(iterations).toEqual([]);
  });

  it("refuses a post the client's calendar does not have, copy that is empty or too long, and a save with no read", async () => {
    const { w } = writes(null);
    expect(await saveCopy(w, claude())).toEqual({ ok: false, status: 404, error: "No post with that key in this client's calendar." });
    const { w: w2, iterations } = writes(POST);
    expect(await saveCopy(w2, claude({ copy: "" }))).toEqual({ ok: false, status: 400, error: "The copy is empty." });
    expect(await saveCopy(w2, claude({ copy: "x".repeat(10_001) }))).toEqual({ ok: false, status: 400, error: "Copy holds at most 10,000 characters." });
    expect(await saveCopy(w2, claude({ basedOn: "" }))).toEqual({ ok: false, status: 400, error: "Give based_on as the updated_at you read for this post." });
    expect(await saveCopy(w2, claude({ hashtags: "law" }))).toEqual({ ok: false, status: 400, error: "hashtags must be a list of at most 30 hashtags." });
    expect(await saveCopy(w2, claude({ cta: "x".repeat(301) }))).toEqual({ ok: false, status: 400, error: "The call to action holds at most 300 characters." });
    expect(iterations).toEqual([]);
  });
});

describe("copyWrites", () => {
  it("reads the post, the latest revision, and writes as calendar-posts did", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "calendar_posts" && op(c, "select") && !op(c, "update")) return { data: POST };
      if (c.table === "post_iterations" && op(c, "select")) return { data: [{ version: 4 }] };
      if (op(c, "update")) return { data: [{ updated_at: "2026-11-03T12:00:00.5+00:00" }] };
      return {};
    });
    const w = copyWrites(db);
    expect(await w.post(CLIENT, KEY)).toEqual(POST);
    expect(await w.lastVersion(CLIENT, KEY)).toBe(4);
    await w.insertIteration({ client_id: CLIENT, calendar_post_key: KEY } as IterationRow);
    expect(await w.updatePost(CLIENT, KEY, { copy: "x" })).toBe("2026-11-03T12:00:00.5+00:00");
    expect(await w.updatePost(CLIENT, KEY, { copy: "x" }, AT)).toBe("2026-11-03T12:00:00.5+00:00");
    expect(calls.map((c) => c.table)).toEqual(["calendar_posts", "post_iterations", "post_iterations", "calendar_posts", "calendar_posts"]);
    expect(eqs(calls[0])).toEqual({ client_id: CLIENT, post_key: KEY });
    expect(op(calls[2], "insert")).toEqual([{ client_id: CLIENT, calendar_post_key: KEY }]);
    expect(eqs(calls[3])).toEqual({ client_id: CLIENT, post_key: KEY });
    expect(eqs(calls[4])).toEqual({ client_id: CLIENT, post_key: KEY, updated_at: AT });
  });

  it("throws when the revision cannot be written, and reads a post no row matched as null", async () => {
    const { db } = fakeDb((c) => (op(c, "insert") ? { error: { message: "boom" } } : { data: op(c, "update") ? [] : null }));
    await expect(copyWrites(db).insertIteration({} as IterationRow)).rejects.toThrow("Could not save the copy: boom");
    expect(await copyWrites(db).post(CLIENT, KEY)).toBeNull();
    expect(await copyWrites(db).updatePost(CLIENT, KEY, { copy: "x" }, AT)).toBeNull();
  });
});

// The calendar's own actions, as calendar-posts/copy.ts had them (notes on
// regenerate, Lital 3 Nov 2026), against an in-memory database: save_copy
// checks membership and teaches as above; undo_note takes a note's learning
// back.
describe("the calendar's save_copy and undo_note", () => {
  type Row = Record<string, unknown>;
  const CHANGES = [{ op: "add" as const, id: "pref-1", description: "Never use exclamation marks.", platform: null }];
  const world = (post: Row = {}): FakeDb => tableDb({
    calendar_posts: [{ client_id: "c1", post_key: "post:p1", copy: "Join us Friday!", platform: "Instagram", format: "Single image", ...post }],
    post_iterations: [],
  });
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

  it("teaches the memory through the note on a regeneration, with the copy before and after, and answers what it learned", async () => {
    const db = world();
    const d = deps(db);
    const r = await saveCopyAction(d, regenerated({ note: "  Never use exclamation marks  " }));
    expect(r.status ?? 200).toBe(200);
    expect(d.learn).toHaveBeenCalledWith("c1", { kind: "rewrite_note", note: "Never use exclamation marks", before: "Join us Friday!", after: "Join us Friday.", platform: "Instagram", story: false });
    expect(r.body).toEqual({ ok: true, learned: { changes: CHANGES } });
    expect(d.background).not.toHaveBeenCalled();
    expect(db.tables.post_iterations[0]).toMatchObject({ source: "regeneration", post_copy: "Join us Friday.", created_by: "person-1" });
    expect(db.tables.calendar_posts[0].copy).toBe("Join us Friday.");
  });

  it("never teaches from a regeneration without a note", async () => {
    const d = deps(world());
    const r = await saveCopyAction(d, regenerated());
    expect(r.body).toEqual({ ok: true });
    expect(d.learn).not.toHaveBeenCalled();
    expect(d.background).not.toHaveBeenCalled();
  });

  it("tells the memory a Story's message is a Story's", async () => {
    const d = deps(world({ format: "Story" }));
    await saveCopyAction(d, regenerated({ note: "Punchier" }));
    expect(d.learn.mock.calls[0][1]).toMatchObject({ kind: "rewrite_note", story: true });
  });

  it("learns from the copy the screen rewrote when a report's own post has no calendar row", async () => {
    const d = deps(tableDb({ calendar_posts: [], post_iterations: [] }));
    await saveCopyAction(d, regenerated({ note: "Shorter", previous_copy: " Join us this Friday! " }));
    expect(d.learn.mock.calls[0][1]).toMatchObject({ kind: "rewrite_note", before: "Join us this Friday!", after: "Join us Friday.", platform: "Instagram" });
  });

  it("saves the rewrite and answers with nothing learned when the learning does not finish", async () => {
    const db = world();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps(db, { learn: vi.fn(async () => { throw new Error("model busy"); }) });
    const r = await saveCopyAction(d, regenerated({ note: "Shorter" }));
    expect(r.body).toEqual({ ok: true });
    expect(db.tables.calendar_posts[0].copy).toBe("Join us Friday.");
    warn.mockRestore();
  });

  it("still teaches from a person's own edit in the background, as before, and a note there changes nothing", async () => {
    const d = deps(world());
    const r = await saveCopyAction(d, regenerated({ source: "calendar", post_copy: "Join us on Friday.", note: "ignored" }));
    expect(r.body).toEqual({ ok: true });
    expect(d.learn).toHaveBeenCalledWith("c1", { kind: "copy_edit", before: "Join us Friday!", after: "Join us on Friday.", platform: "Instagram" });
    expect(d.background).toHaveBeenCalledTimes(1);
  });

  it("checks membership before anything is written", async () => {
    const db = world();
    const d = deps(db, { requireMember: vi.fn(async () => { throw new AuthzError(403, "You do not have access to this client."); }) });
    await expect(saveCopyAction(d, regenerated({ note: "x" }))).rejects.toThrow(AuthzError);
    expect(db.tables.post_iterations).toEqual([]);
    expect(d.learn).not.toHaveBeenCalled();
  });

  it("asks for the post and its copy", async () => {
    expect((await saveCopyAction(deps(world()), { client_id: "c1", calendar_post_key: "post:p1" })).status).toBe(400);
  });

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

describe("one path", () => {
  const functions = functionsDir;
  const code = (f: string) => readFileSync(join(functions, f), "utf8");

  it("is this module for both the calendar and the connector, and calendar-posts keeps no copy save of its own", () => {
    expect(existsSync(join(functions, "calendar-posts", "copy.ts"))).toBe(false);
    expect(code("calendar-posts/index.ts")).toMatch(/from "\.\.\/_shared\/calendar\/saveCopy\.ts"/);
    expect(code("calendar-posts/index.ts")).not.toMatch(/from\("post_iterations"\)|\.from\("calendar_posts"\)\.update/);
    expect(code("mcp/writes.ts")).toMatch(/import \{[^}]*\bsaveCopy\b[^}]*\} from "\.\.\/_shared\/calendar\/saveCopy\.ts"/);
  });
});
