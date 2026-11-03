// supabase/functions/_shared/notes/regenerateNote.ts
//
// A note someone leaves when they regenerate a post's copy or its design
// (notes on regenerate, Lital 3 Nov 2026; design:
// docs/superpowers/specs/2026-11-03-post-notes-stories-design.md). It is used
// for that one regeneration, and the app decides whether it is also a lasting
// preference for the brand. Free of Deno and network imports: the functions
// and the screen import it alike.

/** The longest note (design_requests.note holds as many characters). */
export const NOTE_MAX = 500;

/** A note as it is used: its outer spaces gone and cut to NOTE_MAX; "" when there is none. */
export function cleanNote(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, NOTE_MAX).trim() : "";
}
