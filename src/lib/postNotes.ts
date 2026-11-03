// A note left on Regenerate, for a post's copy or its design (notes on
// regenerate, Lital 3 Nov 2026; design:
// docs/superpowers/specs/2026-11-03-post-notes-stories-design.md). The note is
// used for that regeneration; the app decides whether it is also a lasting
// preference for the brand, and the post shows what was learned with Undo.
// Nothing here reports a failure: an Undo that does not get through is sent
// again quietly, and the line shows what the server has.

import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import type { DesignRequest } from "@/lib/designRequests";
import { NOTE_MAX, cleanNote } from "../../supabase/functions/_shared/notes/regenerateNote";
import type { LearnedChange } from "../../supabase/functions/_shared/voice/voice";

export { NOTE_MAX, cleanNote };
export type { LearnedChange };

/** What the brand's design memory learned from a request's note (design_requests.note_learned). */
export interface NoteLearned {
  rules: Array<{ id: string; type: string; text: string }>;
  undone_at?: string;
}

/** A line under a regeneration made with a note, and whether it offers Undo. */
export interface LearnedLine { text: string; undo: boolean }

const quoted = (xs: string[]) => xs.map((x) => `"${x.replace(/[.\s]+$/, "")}"`).join(" and ");
const brandOf = (brand: string | null | undefined) => (brand && brand.trim()) || "this brand";

/** The placeholder in a note box. */
export const NOTE_PLACEHOLDER = {
  copy: "For example: shorter, and end with a question",
  story: "For example: more playful, and mention the sale",
  design: "For example: show the product, and use a darker background",
};

/** Said when a rewrite or design did not start: the note stays in its box. */
export function notStartedLine(kind: "copy" | "design", note: string): string {
  const what = kind === "copy" ? "Not rewritten yet." : "Not started yet.";
  return note.trim() ? `${what} Your note is kept here.` : what;
}

/**
 * The line under copy rewritten with a note. learned is what the save
 * answered: absent when the learning did not finish (no learned line), no
 * changes when the note was about this post only.
 */
export function copyLearnedLine(learned: { changes?: LearnedChange[] } | null | undefined, brand: string | null | undefined, opts: { undone?: boolean } = {}): LearnedLine {
  const lead = "Rewritten with your note.";
  if (opts.undone) return { text: `${lead} ${brandOf(brand)}'s preferences are as they were.`, undo: false };
  if (!learned || !Array.isArray(learned.changes)) return { text: lead, undo: false };
  const kept = learned.changes.filter((c) => c.op === "add" || c.op === "replace");
  if (kept.length) return { text: `${lead} Learned for ${brandOf(brand)}: ${quoted(kept.map((c) => c.description))}.`, undo: true };
  if (learned.changes.some((c) => c.op === "confirm")) return { text: `${lead} Matches what ${brandOf(brand)} already prefers.`, undo: false };
  return { text: `${lead} Used for this post only.`, undo: false };
}

/** The line under a design asked for with a note: null while nothing was learned yet. */
export function designLearnedLine(learned: NoteLearned | null | undefined, brand: string | null | undefined): LearnedLine | null {
  if (!learned || !Array.isArray(learned.rules)) return null;
  if (learned.undone_at) return { text: `${brandOf(brand)}'s design preferences are as they were.`, undo: false };
  if (!learned.rules.length) return { text: "Used for this design only.", undo: false };
  return { text: `Learned for ${brandOf(brand)}: ${quoted(learned.rules.map((r) => r.text))}.`, undo: true };
}

/** Take back what a rewrite note taught. True once the server has done it. */
export async function undoCopyNote(clientId: string, changes: LearnedChange[]): Promise<boolean> {
  const { data, error } = await sendQuietly(() => supabase.functions.invoke("calendar-posts", { body: { action: "undo_note", client_id: clientId, changes } }), {
    again: (e) => invokeResendable(e, { idempotent: true }),
  });
  return !error && !data?.error && data?.ok === true;
}

/** Take back what a design note taught. The request as it is now, or null when the answer did not come. */
export async function undoDesignNote(requestId: string): Promise<DesignRequest | null> {
  const { data, error } = await sendQuietly(() => supabase.functions.invoke("design-request", { body: { action: "undo_note", request_id: requestId } }), {
    again: (e) => invokeResendable(e, { idempotent: true }),
  });
  if (error || !data || data.error) return null;
  return (data.request as DesignRequest | null) ?? null;
}
