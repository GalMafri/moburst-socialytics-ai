/**
 * The one definition of "this week": Monday to Sunday of the week that today
 * falls in, in the client's time zone. The dashboard counts it, and the
 * calendar's "N posts this week" counts the same days, so the two never
 * disagree. Pure date math on calendar dates (YYYY-MM-DD), with no imports,
 * so any module can use it.
 */

export interface WeekWindow {
  /** Today in the time zone. */
  today: string;
  /** Monday of this week. */
  start: string;
  /** Sunday of this week. */
  end: string;
}

const DAY = 86400000;
const utc = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Today in a time zone, as YYYY-MM-DD. An unknown zone falls back to UTC. */
export function todayInZone(timeZone: string | null | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return iso(now);
  }
}

/** The Monday to Sunday window of the week containing `day`. */
export function weekOf(day: string): { start: string; end: string } {
  const d = utc(day);
  const back = (d.getUTCDay() + 6) % 7;
  const start = iso(new Date(d.getTime() - back * DAY));
  return { start, end: iso(new Date(utc(start).getTime() + 6 * DAY)) };
}

/** This week for a client, in its time zone. */
export function thisWeek(timeZone: string | null | undefined, now = new Date()): WeekWindow {
  const today = todayInZone(timeZone, now);
  return { today, ...weekOf(today) };
}

/** True when a calendar date falls inside the window. */
export function inWeek(day: string, week: { start: string; end: string }): boolean {
  return day >= week.start && day <= week.end;
}
