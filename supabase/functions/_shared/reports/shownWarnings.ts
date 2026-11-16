// supabase/functions/_shared/reports/shownWarnings.ts
//
// The warnings a social report shows, read one way by every reader. A stored
// report can carry sentences written by the engine that was retired on 8 Nov
// 2026 (for example one that tells staff to add keywords in client setup).
// The app engine writes the sentences below, in one place, and a reader keeps
// only those. Free of Deno and network imports.

export const DECK_TIMED_OUT_WARNING = "The analysis is available, but presentation generation timed out. No presentation link is available.";
export const DECK_INCOMPLETE_WARNING = "The analysis is available, but the presentation did not complete. No presentation link is available.";
export const BRIEF_UNREAD_WARNING = "The linked brief could not be read.";
export const BRIEF_UNREAD_USED_SAVED = " The saved brief text was used instead.";
export const BRIEF_UNREAD_NO_TEXT = " This analysis has no text from that brief.";
export const BRIEF_NOT_SUMMARIZED_WARNING = "The brief could not be summarized; its original text was included in the analysis.";

const APP_WARNINGS = new Set([
  DECK_TIMED_OUT_WARNING,
  DECK_INCOMPLETE_WARNING,
  BRIEF_UNREAD_WARNING,
  BRIEF_UNREAD_WARNING + BRIEF_UNREAD_USED_SAVED,
  BRIEF_UNREAD_WARNING + BRIEF_UNREAD_NO_TEXT,
  BRIEF_NOT_SUMMARIZED_WARNING,
]);

/** The warnings a report shows: the ones the app engine writes, in their stored order. */
export function shownWarnings(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((w): w is string => typeof w === "string" && APP_WARNINGS.has(w));
}
