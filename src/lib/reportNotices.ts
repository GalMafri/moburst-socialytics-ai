/**
 * The notes a monthly report run leaves for the team (report_data.warnings),
 * as they stand now.
 *
 * They are setup notes for Moburst staff ("the linked brief could not be
 * read"), never shown to a client. A note whose cause has since been fixed in
 * client setup is dropped: Bader Law's 7 Oct report kept telling staff to add
 * a brief that had been pasted in since (13 Oct).
 */
export function reportNotices(warnings: unknown, setup: { briefText?: string | null }): string[] {
  if (!Array.isArray(warnings)) return [];
  const briefInSetup = !!String(setup.briefText ?? "").trim();
  return warnings
    .filter((w): w is string => typeof w === "string" && !!w.trim())
    .filter((w) => !(briefInSetup && /\bbrief\b/i.test(w)));
}
