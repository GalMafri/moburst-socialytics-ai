// supabase/functions/design-request/note.ts
//
// A note left on a design's Regenerate (notes on regenerate, Lital 3 Nov
// 2026; design: docs/superpowers/specs/2026-11-03-post-notes-stories-design.md).
// The request keeps the note (design_requests.note), so its planner and every
// design job follow it. Beside the planning, the brand's design memory hears
// the note and keeps it only when it is lasting (feedback.ts learnFromNote);
// what it learned is written on the request (note_learned), so the post shows
// it with Undo:
//
//   undo_note {request_id}   anyone who can work on the client's posts: the
//        rules the note taught are removed and the request says so.
//
// Clients cannot write these tables (staff-only RLS), so Undo goes through the
// service role after a membership check. Free of Deno and network imports:
// index.ts hands in the database, the membership check and the learner, so
// the actions run against a fake database in tests.

import type { Learning } from "../_shared/design-prompts/feedback.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** What a note taught, as the request keeps it: an empty list means used for this design only. */
export interface NoteLearned {
  rules: Array<{ id: string; type: string; text: string }>;
  undone_at?: string;
}

export interface NoteDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  /** The design memory hearing a note (feedback.ts learnFromNote): its rules, [] for a one-off, null when it did not finish. */
  learn(n: { clientId: string; platform: string | null; format: string | null; note: string; userId: string | null }): Promise<Learning[] | null>;
  now(): Date;
}

export interface Answer { status?: number; body: Record<string, unknown> }

/** The rules a learner stored, as note_learned; null when none was stored (nothing learned yet). */
export function noteLearnedOf(learnings: Learning[] | null | undefined): NoteLearned | null {
  const rules = (learnings ?? []).filter((l) => l.id).map((l) => ({ id: String(l.id), type: l.pattern_type, text: l.pattern_description }));
  return rules.length ? { rules } : null;
}

/**
 * Teach the brand's design memory from a request's note, and write what it
 * learned on the request. A learning that does not finish writes nothing.
 */
export async function learnDesignNote(d: NoteDeps, request: Row, userId: string | null): Promise<void> {
  const note = String(request.note ?? "").trim();
  if (!note) return;
  const learned = await d.learn({ clientId: request.client_id, platform: request.platform ?? null, format: request.format ?? null, note, userId });
  if (!learned) return;
  const value: NoteLearned = { rules: learned.filter((l) => l.id).map((l) => ({ id: String(l.id), type: l.pattern_type, text: l.pattern_description })) };
  await d.db.from("design_requests").update({ note_learned: value }).eq("id", request.id).is("note_learned", null);
}

export async function undoDesignNote(d: NoteDeps, body: Row): Promise<Answer> {
  const { data: request } = await d.db.from("design_requests").select("id, client_id, note, note_learned").eq("id", String(body.request_id || "")).maybeSingle();
  if (!request) return { status: 404, body: { error: "That design is no longer available." } };
  await d.requireMember(request.client_id);
  const learned = request.note_learned as NoteLearned | null;
  if (!learned?.rules || learned.undone_at) return { body: { ok: true, request } };
  const ids = learned.rules.map((r) => String(r.id)).filter(Boolean);
  if (ids.length) {
    const { error } = await d.db.from("design_learnings").delete().in("id", ids).eq("client_id", request.client_id);
    if (error) throw new Error(`Could not take back what the note taught: ${error.message}`);
  }
  const value: NoteLearned = { ...learned, undone_at: d.now().toISOString() };
  const { data: updated } = await d.db.from("design_requests").update({ note_learned: value }).eq("id", request.id).select("id, client_id, note, note_learned").single();
  return { body: { ok: true, request: updated ?? { ...request, note_learned: value } } };
}
