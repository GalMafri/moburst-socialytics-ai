/**
 * The notes a monthly report run leaves for the team (report_data.warnings),
 * as they stand now.
 *
 * They are notes for Moburst staff, never shown to a client. Notes about the
 * brief are never shown: a report is built from the brief text the app holds,
 * and a brief the workflow could not open or summarize does not stop or weaken
 * it, so there is nothing for anyone to do about one. Reports from before
 * 19 Oct still carry such notes ("the linked brief could not be read").
 */
export function reportNotices(warnings: unknown, _setup: { briefText?: string | null } = {}): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter((w): w is string => typeof w === "string" && !!w.trim())
    .filter((w) => !/\bbrief\b/i.test(w));
}
