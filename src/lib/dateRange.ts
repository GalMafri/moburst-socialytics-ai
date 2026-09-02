// Date-range helpers shared by the competitive run page, the analytics page
// and the report lists. Everything works in calendar dates (yyyy-mm-dd) so a
// range means the same thing in the UI, in the payload sent to n8n and in
// the rows the scheduler writes.

export type RangePreset = "7d" | "30d" | "90d" | "previous_month" | "custom";

export type DateRange = { start: string; end: string };

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  previous_month: "Previous month",
  custom: "Custom",
};

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Range for a preset, ending yesterday (the last full day of data). */
export function presetRange(preset: Exclude<RangePreset, "custom">, now: Date = new Date()): DateRange {
  const today = utcDay(now);
  if (preset === "previous_month") {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { start: toISODate(first), end: toISODate(last) };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const end = new Date(today.getTime() - 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { start: toISODate(start), end: toISODate(end) };
}

export function rangeDays(range: DateRange): number {
  const s = new Date(range.start + "T00:00:00Z").getTime();
  const e = new Date(range.end + "T00:00:00Z").getTime();
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

export function isValidRange(range: Partial<DateRange> | null | undefined): range is DateRange {
  if (!range?.start || !range?.end) return false;
  const s = new Date(range.start + "T00:00:00Z").getTime();
  const e = new Date(range.end + "T00:00:00Z").getTime();
  return !isNaN(s) && !isNaN(e) && s <= e;
}

export function formatRange(range: Partial<DateRange> | null | undefined): string {
  if (!range?.start || !range?.end) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  const s = new Date(range.start + "T00:00:00Z").toLocaleDateString("en-US", opts);
  const e = new Date(range.end + "T00:00:00Z").toLocaleDateString("en-US", opts);
  return `${s} to ${e}`;
}

/**
 * The period a report describes. Uses the stored range when present and
 * otherwise treats the report as describing the 30 days before it was created,
 * which is what the monthly workflow pulls.
 */
export function reportPeriod(report: { date_range_start?: string | null; date_range_end?: string | null; created_at: string }): DateRange {
  if (report.date_range_start && report.date_range_end) {
    return { start: report.date_range_start.slice(0, 10), end: report.date_range_end.slice(0, 10) };
  }
  const created = utcDay(new Date(report.created_at));
  const start = new Date(created.getTime() - 30 * 86400000);
  return { start: toISODate(start), end: toISODate(created) };
}

/** True when two calendar ranges share at least one day. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}
