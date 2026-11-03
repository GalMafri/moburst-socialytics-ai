// supabase/functions/calendar-posts/copy.ts
//
// Saving a post's copy, and what the client's preference memory learns from
// it (notes on regenerate, Lital 3 Nov 2026; design:
// docs/superpowers/specs/2026-11-03-post-notes-stories-design.md).
//
//   save_copy {client_id, calendar_post_key, post_copy, source?, note?, ...}
//        a person's edit teaches the memory, in the background, as before. A
//        regeneration teaches only through the note someone left on it: the
//        memory merge decides whether the note is a lasting preference (a
//        note about this post alone teaches nothing), and the answer says
//        what it learned, so the post can show it with Undo. A learning step
//        that does not finish answers nothing learned; the copy is saved.
//   undo_note {client_id, changes}
//        takes back what a note taught (voice/load.ts undoLearning).
//
// Clients cannot write these tables (staff-only RLS), so both go through the
// service role after a membership check. Free of Deno and network imports:
// index.ts hands in the database, the membership check, the memory and its
// background runner, so the actions run against a fake database in tests.

import type { LearnedChange, MemorySignal } from "../_shared/voice/voice.ts";
import { cleanNote } from "../_shared/notes/regenerateNote.ts";
import { isStoryPost } from "../_shared/design/story.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface CopyDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  /** The preference memory learning from one signal (voice/load.ts learnFromSignal). */
  learn(clientId: string, signal: MemorySignal): Promise<{ ops: number; changes: LearnedChange[] }>;
  /** A note's learning taken back (voice/load.ts undoLearning). */
  undo(clientId: string, changes: LearnedChange[]): Promise<number>;
  /** Work that goes on after the answer is sent. */
  background(work: Promise<unknown>, label: string): void;
}

export interface Answer { status?: number; body: Record<string, unknown> }

export async function saveCopy(d: CopyDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  const key = String(body.calendar_post_key || "");
  const copy = String(body.post_copy || "").trim();
  if (!clientId || !key || !copy) return { status: 400, body: { error: "client_id, calendar_post_key and post_copy are required." } };
  const userId = await d.requireMember(clientId);
  const regeneration = body.source === "regeneration";
  const hashtags = Array.isArray(body.hashtags) ? body.hashtags.map(String).slice(0, 30) : null;
  const { data: before } = await d.db.from("calendar_posts").select("copy, platform, format").eq("client_id", clientId).eq("post_key", key).maybeSingle();
  const previous = String(before?.copy || "").trim();
  const platform = before?.platform ?? body.platform ?? null;
  const format = before?.format ?? body.format ?? null;
  const { error } = await d.db.from("post_iterations").insert({
    client_id: clientId, report_id: body.report_id || null, calendar_post_key: key,
    version: Number(body.version) || 1, platform: body.platform || null, post_copy: copy,
    hashtags, cta: body.cta || null, concept: body.concept || null, visual_direction: body.visual_direction || null,
    format: body.format || null, source: regeneration ? "regeneration" : "calendar", created_by: userId,
  });
  if (error) throw new Error(`Could not save the copy: ${error.message}`);
  // The calendar post holds the current copy too, for every view that reads it directly.
  await d.db.from("calendar_posts").update({ copy, touched_at: new Date().toISOString(), ...(hashtags ? { hashtags } : {}), ...(body.cta ? { cta: String(body.cta) } : {}) })
    .eq("client_id", clientId).eq("post_key", key);

  if (!regeneration) {
    // A person's edit says how they want copy written.
    if (previous && previous !== copy) d.background(d.learn(clientId, { kind: "copy_edit", before: previous, after: copy, platform }), "memory");
    return { body: { ok: true } };
  }
  // A regeneration teaches only through its note.
  const note = cleanNote(body.note);
  if (!note) return { body: { ok: true } };
  try {
    const story = isStoryPost({ format, platform });
    // A report's own post has no calendar row: the screen sends the copy it rewrote.
    const rewritten = previous || String(body.previous_copy || "").trim();
    const { changes } = await d.learn(clientId, { kind: "rewrite_note", note, before: rewritten, after: copy, platform, story });
    return { body: { ok: true, learned: { changes } } };
  } catch (e) {
    console.warn("[calendar-posts] rewrite note not learned:", e instanceof Error ? e.message : e);
    return { body: { ok: true } };
  }
}

/** The changes a client sent back for Undo, as far as they can be taken back: additions and replacements, at most three. */
function undoable(raw: unknown): LearnedChange[] {
  const out: LearnedChange[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (out.length >= 3) break;
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) continue;
    const description = String(c.description ?? "");
    const platform = typeof c.platform === "string" ? c.platform : null;
    if (c.op === "add") out.push({ op: "add", id: c.id, description, platform });
    else if (c.op === "replace" && typeof c.replaced?.id === "string" && c.replaced.id) {
      out.push({ op: "replace", id: c.id, description, platform, added: c.added === true, replaced: { id: c.replaced.id, description: String(c.replaced.description ?? "") } });
    }
  }
  return out;
}

export async function undoNote(d: CopyDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  if (!clientId) return { status: 400, body: { error: "client_id is required." } };
  await d.requireMember(clientId);
  return { body: { ok: true, undone: await d.undo(clientId, undoable(body.changes)) } };
}
