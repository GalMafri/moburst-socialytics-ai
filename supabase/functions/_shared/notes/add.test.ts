// Adding a typed note, the one path for the app (client-notes add_text) and
// for Claude (the connector's socialytics_note_save). The app's rows are the
// rows it wrote before the move, plus their source and text hash; a note
// from Claude is matched by its text, so the same words twice are one note.

import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eqs, fakeDb, op } from "../db.fake";
import { addTextNote, noteHashText, noteTextHash, noteWrites, type NoteWrites, type StoredNote, type TypedNoteRow } from "./add";
import { noteTitle } from "./notes";

const CLIENT = "00000000-0000-4000-8000-000000000001";
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const NOTE = "00000000-0000-4000-8000-00000000000e";
// 3 Nov 2026, 02:00 UTC: still Nov 2 in New York.
const NOW = new Date("2026-11-03T02:00:00.000Z");

function writes(over: Partial<NoteWrites> = {}) {
  const inserted: TypedNoteRow[] = [];
  const queued: string[] = [];
  const stored: StoredNote[] = [];
  const w: NoteWrites = {
    client: async (id) => (id === CLIENT ? { id, timezone: "America/New_York" } : null),
    authorName: async () => "Sinéad Cronin",
    sameText: vi.fn(async (_c: string, hash: string) => stored.find((n) => (n as StoredNote & { hash?: string }).hash === hash) ?? null),
    insert: async (row) => {
      if (stored.some((n) => n.id === row.id)) return { added: false, note: stored.find((n) => n.id === row.id)! };
      inserted.push(row);
      const note = { id: row.id, title: row.title, note_date: row.note_date, added_by_name: row.added_by_name, created_at: NOW.toISOString(), source: row.source, hash: row.text_hash };
      stored.push(note);
      return { added: true, note };
    },
    queueRead: async (id) => { queued.push(id); },
    ...over,
  };
  return { w, inserted, queued, stored };
}

describe("noteTextHash", () => {
  it("is the SHA-256 of the text with its ends trimmed and each run of spaces, tabs and line breaks made one space", async () => {
    expect(await noteTextHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(noteHashText("  Never say\t\"cheap\".\r\n\nSay  it  \f\v ")).toBe("Never say \"cheap\". Say it");
    const same = await noteTextHash("Launch on Dec 1.\nNo puns.");
    for (const variant of ["Launch on Dec 1. No puns.", "  Launch on Dec 1.\n\n  No puns.  ", "Launch\ton Dec 1.\r\nNo puns."]) expect(await noteTextHash(variant), variant).toBe(same);
    expect(await noteTextHash("Launch on Dec 2. No puns.")).not.toBe(same);
    expect(await noteTextHash("Café ✓")).toBe(createHash("sha256").update("Café ✓", "utf8").digest("hex"));
  });
});

describe("addTextNote", () => {
  it("writes the app's row as client-notes did before, with its source and text hash, and queues the reading", async () => {
    const { w, inserted, queued } = writes();
    const text = "  Meeting Oct 28\nNever say cheap.\r\n";
    const r = await addTextNote(w, { clientId: CLIENT, noteId: NOTE, text, source: "app", userId: PERSON, now: NOW });
    expect(r).toMatchObject({ ok: true, added: true });
    const clean = "Meeting Oct 28\nNever say cheap.";
    expect(inserted).toEqual([{
      id: NOTE, client_id: CLIENT, kind: "typed", title: noteTitle(clean), text: clean, note_date: "2026-11-02", date_set_by: "app",
      added_by: PERSON, added_by_name: "Sinéad Cronin", source: "app", text_hash: await noteTextHash(clean),
    }]);
    expect(queued).toEqual([CLIENT]);
  });

  it("adds an app note sent again once, and still queues the reading as before", async () => {
    const { w, inserted, queued } = writes();
    await addTextNote(w, { clientId: CLIENT, noteId: NOTE, text: "No puns", source: "app", userId: PERSON, now: NOW });
    const again = await addTextNote(w, { clientId: CLIENT, noteId: NOTE, text: "No puns", source: "app", userId: PERSON, now: NOW });
    expect(again).toMatchObject({ ok: true, added: false });
    expect(inserted).toHaveLength(1);
    expect(queued).toEqual([CLIENT, CLIENT]);
    expect(w.sameText).not.toHaveBeenCalled();
  });

  it("dates a note a person gave a date by that date, and any other by the client's today", async () => {
    const { w, inserted } = writes();
    await addTextNote(w, { clientId: CLIENT, text: "a", date: "2026-10-28", source: "claude", userId: PERSON, now: NOW });
    await addTextNote(w, { clientId: CLIENT, text: "b", source: "claude", userId: PERSON, now: NOW });
    expect(inserted.map((r) => [r.note_date, r.date_set_by])).toEqual([["2026-10-28", "person"], ["2026-11-02", "app"]]);
  });

  it("keeps a note from Claude once per text, whoever sends it again, and answers who saved it first", async () => {
    const { w, inserted, queued } = writes();
    const first = await addTextNote(w, { clientId: CLIENT, text: "Launch on Dec 1.\nNo puns.", title: "Kickoff call", source: "claude", userId: PERSON, now: NOW });
    expect(first).toMatchObject({ ok: true, added: true, note: { title: "Kickoff call", source: "claude", added_by_name: "Sinéad Cronin" } });
    const again = await addTextNote(w, { clientId: CLIENT, text: "  Launch on Dec 1. No puns. ", title: "Kickoff call (part 1 of 2)", source: "claude", userId: "someone-else", now: NOW });
    expect(again).toMatchObject({ ok: true, added: false, note: { id: first.ok ? first.note!.id : "", added_by_name: "Sinéad Cronin" } });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ source: "claude", kind: "typed", added_by: PERSON });
    expect(queued).toEqual([CLIENT]);
  });

  it("titles a note from Claude as given, on one line and at most 200 characters, else by its first line", async () => {
    const { w, inserted } = writes();
    await addTextNote(w, { clientId: CLIENT, text: "one", title: "  Brand book.pdf\n(partial) ", source: "claude", userId: PERSON, now: NOW });
    await addTextNote(w, { clientId: CLIENT, text: "two", title: "x".repeat(300), source: "claude", userId: PERSON, now: NOW });
    await addTextNote(w, { clientId: CLIENT, text: "\nFirst line\nsecond", title: "  ", source: "claude", userId: PERSON, now: NOW });
    expect(inserted.map((r) => r.title)).toEqual(["Brand book.pdf (partial)", "x".repeat(200), "First line"]);
  });

  it("refuses what it cannot add with the app's own words", async () => {
    const { w, inserted } = writes();
    expect(await addTextNote(w, { clientId: "00000000-0000-4000-8000-000000000009", text: "a", source: "app", userId: PERSON, now: NOW })).toEqual({ ok: false, status: 404, error: "No such client." });
    expect(await addTextNote(w, { clientId: CLIENT, text: "a", date: "2026-11-05", source: "app", userId: PERSON, now: NOW })).toEqual({ ok: false, status: 400, error: "date must be a day no later than tomorrow (YYYY-MM-DD)." });
    expect(await addTextNote(w, { clientId: CLIENT, text: " \r\n ", source: "app", userId: PERSON, now: NOW })).toEqual({ ok: false, status: 400, error: "text is required." });
    expect(await addTextNote(w, { clientId: CLIENT, text: "x".repeat(20_001), source: "claude", userId: PERSON, now: NOW })).toEqual({ ok: false, status: 400, error: "A note holds at most 20000 characters." });
    expect(inserted).toEqual([]);
  });
});

describe("noteWrites", () => {
  const ROW: TypedNoteRow = { id: NOTE, client_id: CLIENT, kind: "typed", title: "t", text: "x", note_date: "2026-11-02", date_set_by: "app", added_by: PERSON, added_by_name: "S", source: "app", text_hash: "h" };
  const STORED = { id: NOTE, title: "t", note_date: "2026-11-02", added_by_name: "S", created_at: NOW.toISOString(), source: "app" };

  it("reads the client, the author's name and the same text as before, and queues the reading through client_notes_queue_read", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "clients") return { data: { id: CLIENT, timezone: "UTC" } };
      if (c.table === "profiles") return { data: { display_name: null, email: "sinead@moburst.com" } };
      if (c.table === "client_notes") return { data: [STORED] };
      return { data: null };
    });
    const w = noteWrites(db);
    expect(await w.client(CLIENT)).toEqual({ id: CLIENT, timezone: "UTC" });
    expect(await w.authorName(PERSON)).toBe("sinead@moburst.com");
    expect(await w.sameText(CLIENT, "h")).toEqual(STORED);
    await w.queueRead(CLIENT);
    expect(calls.map((c) => c.table)).toEqual(["clients", "profiles", "client_notes", "rpc:client_notes_queue_read"]);
    expect(eqs(calls[2])).toEqual({ client_id: CLIENT, text_hash: "h" });
    expect(op(calls[3], "rpc")).toEqual([{ p_client: CLIENT }]);
  });

  it("adds an app note with the upsert client-notes used, so a resend adds nothing", async () => {
    let answer: unknown[] = [STORED];
    const { db, calls } = fakeDb(() => ({ data: answer }));
    expect(await noteWrites(db).insert(ROW)).toEqual({ added: true, note: STORED });
    expect(op(calls[0], "upsert")).toEqual([ROW, { onConflict: "id", ignoreDuplicates: true }]);
    answer = [];
    expect((await noteWrites(db).insert(ROW)).added).toBe(false);
  });

  it("adds a note from Claude with a plain insert, and answers a race on the same text with the note that won", async () => {
    const claude = { ...ROW, source: "claude" as const };
    const { db, calls } = fakeDb((c) => (op(c, "insert") ? { error: { message: "duplicate key value violates unique constraint \"client_notes_claude_text\"", code: "23505" } } : { data: [STORED] }));
    expect(await noteWrites(db).insert(claude)).toEqual({ added: false, note: STORED });
    expect(op(calls[0], "insert")).toEqual([claude]);
    expect(eqs(calls[1])).toEqual({ client_id: CLIENT, text_hash: "h" });
  });

  it("throws on any other failure, as client-notes did", async () => {
    const { db } = fakeDb(() => ({ error: { message: "boom" } }));
    await expect(noteWrites(db).insert(ROW)).rejects.toThrow("Could not add the note: boom");
    await expect(noteWrites(db).queueRead(CLIENT)).rejects.toThrow("Could not queue the reading: boom");
  });
});
