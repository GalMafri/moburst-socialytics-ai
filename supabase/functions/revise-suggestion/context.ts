// What a rewrite is told about its report: the report as the screen shows it
// (_shared/reports/shownFields.ts), its insights where it has them, through
// the evidence limits, so the summary it reads and the other suggestions it
// must not duplicate are the ones shown next to the suggestion.

import { shownCompetitive, type ShownInsightsRow } from "../_shared/reports/shownFields.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export function revisionContext(reportData: unknown, insights: ShownInsightsRow | null, originalGap: string): { report: Any; summary: string; others: string[] } {
  const shown = shownCompetitive(reportData || {}, insights);
  return {
    report: shown.report,
    summary: shown.summary.map((p) => p.text).join("\n\n"),
    others: shown.gaps.map((g) => String(g?.gap ?? "").trim()).filter((g) => g && g !== originalGap),
  };
}
