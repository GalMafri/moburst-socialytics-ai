/** Competitive analytics use complete UTC publication days, inclusively. */
export function competitiveRangeError(range: { start?: string; end?: string }, now = new Date()): string | null {
  const valid = (s?: string) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  if (!valid(range.start) || !valid(range.end)) return "Choose valid start and end dates.";
  if (range.start! > range.end!) return "The end date must be on or after the start date.";
  if (range.end! >= now.toISOString().slice(0, 10)) return "Choose an end date before today; only complete UTC days can be analyzed.";
  if ((Date.parse(range.end!) - Date.parse(range.start!)) / 86400000 + 1 > 366) return "Choose a period of at most 366 days.";
  return null;
}
