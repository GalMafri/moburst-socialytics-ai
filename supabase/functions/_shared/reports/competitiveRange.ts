const MAX_DAYS = 366;

const validDay = (s?: string) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

const spanDays = (range: { start?: string; end?: string }) => (Date.parse(range.end!) - Date.parse(range.start!)) / 86400000 + 1;

/** Competitive analytics use complete UTC publication days, inclusively. */
export function competitiveRangeError(range: { start?: string; end?: string }, now = new Date()): string | null {
  if (!validDay(range.start) || !validDay(range.end)) return "Choose valid start and end dates.";
  if (range.start! > range.end!) return "The end date must be on or after the start date.";
  if (range.end! >= now.toISOString().slice(0, 10)) return "Choose an end date before today; only complete UTC days can be analyzed.";
  if (spanDays(range) > MAX_DAYS) return "Choose a period of at most 366 days.";
  return null;
}

/** Today in a time zone as YYYY-MM-DD; a zone that is missing or unknown reads as UTC. */
export function dayInZone(timeZone: string | null | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * A monthly report's period: real dates, the start on or before the end, the
 * end no later than today in the client's own zone (the day the run page
 * offers as its last), and at most a year. Today itself is allowed: the month
 * so far is a period the page offers.
 */
export function socialRangeError(range: { start?: string; end?: string }, timeZone: string | null | undefined, now = new Date()): string | null {
  if (!validDay(range.start) || !validDay(range.end)) return "Choose valid start and end dates.";
  if (range.start! > range.end!) return "The end date must be on or after the start date.";
  if (range.end! > dayInZone(timeZone, now)) return "Choose an end date that is not in the future.";
  if (spanDays(range) > MAX_DAYS) return "Choose a period of at most 366 days.";
  return null;
}
