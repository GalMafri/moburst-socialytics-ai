// supabase/functions/_shared/notes/add.ts
//
// Adding one typed client note: the one path for a note typed in the app
// (client-notes add_text) and a note saved from Claude (the connector's
// socialytics_note_save; docs/superpowers/specs/2026-11-03-claude-sync-
// design.md). The row names the person and where it came from, carries the
// hash of its text, and the client's notes_read job is queued to read it.
// A note from Claude is matched by its text across all of the client's
// notes first, so the same words saved again (a retry, a rerun of the
// project's knowledge, two people) are one note. The app's note keeps the id
// its screen made, so a resend adds nothing, as before.

import { clipText } from "../text/clip.ts";
import { NOTE_TEXT_MAX, noteTitle, todayIn, validNoteDate } from "./notes.ts";

export type NoteSource = "app" | "claude";

/** A note as the connector answers about it. */
export interface StoredNote {
  id: string;
  title: string;
  note_date: string;
  added_by_name: string | null;
  created_at: string;
  source: string;
}

/** The row a typed note is stored as (client_notes). */
export interface TypedNoteRow {
  id: string;
  client_id: string;
  kind: "typed";
  title: string;
  text: string;
  note_date: string;
  date_set_by: "person" | "app";
  added_by: string;
  added_by_name: string | null;
  source: NoteSource;
  text_hash: string;
}

/** What adding a note reads and writes, through the service role. */
export interface NoteWrites {
  client(clientId: string): Promise<{ id: string; timezone: string | null } | null>;
  /** The name people know the person by: their profile's display name, else its email. */
  authorName(userId: string): Promise<string | null>;
  /** The client's oldest note with this text hash, from the app or Claude. */
  sameText(clientId: string, hash: string): Promise<StoredNote | null>;
  /** Stores the row unless its id (or, from Claude, its text) is there; says whether this call added it. */
  insert(row: TypedNoteRow): Promise<{ added: boolean; note: StoredNote | null }>;
  queueRead(clientId: string): Promise<void>;
}

export interface AddText {
  clientId: string;
  /** The app's own id for the note, so a resend adds nothing; made here when absent. */
  noteId?: unknown;
  text: unknown;
  /** From Claude: the file's name or the note's title. The app titles a note by its first line. */
  title?: unknown;
  /** The day it was said (YYYY-MM-DD). A date given counts as a person's date. */
  date?: unknown;
  source: NoteSource;
  userId: string;
  now: Date;
}

export type AddTextResult =
  | { ok: true; added: boolean; note: StoredNote | null }
  | { ok: false; status: 400 | 404; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Spaces, tabs and line breaks: the whitespace a copy and paste may change. The migration's backfill uses the same set. */
const EDGES = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
const RUNS = /[ \t\n\r\f\v]+/g;
export const NOTE_TITLE_MAX = 200;

/** The text a note's hash is made from: its ends trimmed and each run of whitespace one space. */
export function noteHashText(text: string): string {
  return String(text ?? "").replace(EDGES, "").replace(RUNS, " ");
}

/** SHA-256 of noteHashText, in hex: client_notes.text_hash. */
export async function noteTextHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(noteHashText(text)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function addTextNote(w: NoteWrites, a: AddText): Promise<AddTextResult> {
  const client = await w.client(a.clientId);
  if (!client) return { ok: false, status: 404, error: "No such client." };
  const today = todayIn(String(client.timezone || "UTC"), a.now);
  const date = a.date ? validNoteDate(a.date, today) : null;
  if (a.date && !date) return { ok: false, status: 400, error: "date must be a day no later than tomorrow (YYYY-MM-DD)." };
  const text = String(a.text ?? "").replace(/\r/g, "").trim();
  if (!text) return { ok: false, status: 400, error: "text is required." };
  if (text.length > NOTE_TEXT_MAX) return { ok: false, status: 400, error: `A note holds at most ${NOTE_TEXT_MAX} characters.` };

  const hash = await noteTextHash(text);
  if (a.source === "claude") {
    const same = await w.sameText(a.clientId, hash);
    if (same) return { ok: true, added: false, note: same };
  }
  const given = clipText(String(a.title ?? "").replace(/\s+/g, " ").trim(), NOTE_TITLE_MAX).trim();
  const row: TypedNoteRow = {
    id: UUID.test(String(a.noteId || "")) ? String(a.noteId) : crypto.randomUUID(),
    client_id: a.clientId, kind: "typed", title: given || noteTitle(text), text,
    // A date a person gave beats any date the reading finds; the day it was added does not.
    note_date: date ?? today, date_set_by: date ? "person" : "app",
    added_by: a.userId, added_by_name: await w.authorName(a.userId), source: a.source, text_hash: hash,
  };
  const { added, note } = await w.insert(row);
  // A note from Claude that lost a race to the same text was queued by the call that won.
  if (added || a.source === "app") await w.queueRead(a.clientId);
  return { ok: true, added, note };
}

// deno-lint-ignore no-explicit-any
type Db = any;

const STORED = "id, title, note_date, added_by_name, created_at, source";

/** NoteWrites over a service-role client. */
export function noteWrites(db: Db): NoteWrites {
  const sameText = async (clientId: string, hash: string): Promise<StoredNote | null> => {
    const { data, error } = await db.from("client_notes").select(STORED).eq("client_id", clientId).eq("text_hash", hash)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1);
    if (error) throw new Error(`Could not read the client's notes: ${error.message}`);
    return ((data ?? []) as StoredNote[])[0] ?? null;
  };
  return {
    async client(clientId) {
      const { data } = await db.from("clients").select("id, timezone").eq("id", clientId).maybeSingle();
      return data ?? null;
    },
    async authorName(userId) {
      const { data: profile } = await db.from("profiles").select("display_name, email").eq("user_id", userId).maybeSingle();
      return String(profile?.display_name || profile?.email || "").trim() || null;
    },
    sameText,
    async insert(row) {
      if (row.source === "app") {
        const { data, error } = await db.from("client_notes").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select(STORED);
        if (error) throw new Error(`Could not add the note: ${error.message}`);
        const note = ((data ?? []) as StoredNote[])[0] ?? null;
        return { added: !!note, note };
      }
      const { data, error } = await db.from("client_notes").insert(row).select(STORED);
      // The same text from Claude, saved a moment ago by another call (client_notes_claude_text).
      if (error?.code === "23505") return { added: false, note: await sameText(row.client_id, row.text_hash) };
      if (error) throw new Error(`Could not add the note: ${error.message}`);
      return { added: true, note: ((data ?? []) as StoredNote[])[0] ?? null };
    },
    async queueRead(clientId) {
      const { error } = await db.rpc("client_notes_queue_read", { p_client: clientId });
      if (error) throw new Error(`Could not queue the reading: ${error.message}`);
    },
  };
}
