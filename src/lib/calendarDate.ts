import { postingTimeOf } from "../../supabase/functions/_shared/calendar/reasonText";

/** A calendar date must not move to the previous day during UTC serialization. */
export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Resolve a wall-clock input in the named zone, independent of the browser zone. */
export function scheduledInstant(date: string, time: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Enter a valid date and time.");
  }
  const wall = new Date(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== `${date}T${time}`) {
    throw new Error("Enter a valid date and time.");
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
  } catch {
    throw new Error("The client's timezone is invalid. Correct it in the client's setup before scheduling.");
  }
  const asWall = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  };
  // Include offsets on both sides of a transition (including half-hour DST).
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = wall.getTime() + hours * 3_600_000;
    offsets.add(asWall(sample) - sample);
  }
  const candidates = [...offsets].map((offset) => wall.getTime() - offset)
    .filter((instant) => asWall(instant) === wall.getTime());
  if (!candidates.length) throw new Error("This local time does not exist because the clocks change. Choose another time.");
  if (candidates.length > 1) throw new Error("This local time occurs twice because the clocks change. Choose an unambiguous time.");
  return new Date(candidates[0]).toISOString();
}

/**
 * A post's planned date as a date input's value (YYYY-MM-DD), or "" when it
 * names no full date. A label without a year ("Nov 9") is left empty rather
 * than guessed: the browser reads it as 2001.
 */
export function dateInputOf(label: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(String(label ?? "").trim());
  if (!m) return "";
  const d = new Date(`${m[1]}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === m[1] ? m[1] : "";
}

/**
 * A post's planned time as a time input's value (HH:MM, 24-hour), or "" when
 * it names no time. Reads "6:45 PM", "6 PM", "6:45pm EST" and "18:45".
 */
export function timeInputOf(postingTime: string | null | undefined): string {
  return postingTimeOf(postingTime) ?? "";
}

/** A posting time as minutes after midnight, for putting a day's posts in order; null when it names no time. */
export function postingMinutes(postingTime: string | null | undefined): number | null {
  const t = postingTimeOf(postingTime);
  return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null;
}

/** Sorts a day's posts by their time; a post with no time goes last. */
export function byPostingTime(a: string | null | undefined, b: string | null | undefined): number {
  return (postingMinutes(a) ?? Infinity) - (postingMinutes(b) ?? Infinity) || 0;
}

/**
 * A posting time as people read it, in one form: "6:45 PM", with the client's
 * zone name beside it when the zone is known ("6:45 PM EST"). The zone name is
 * the one in force on the post's date (EST or EDT), or today's without a date.
 */
export function postingTimeText(postingTime: string | null | undefined, timeZone?: string | null, date?: string | null): string {
  const t = postingTimeOf(postingTime);
  if (!t) return "";
  const h = Number(t.slice(0, 2));
  const text = `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? "AM" : "PM"}`;
  if (!timeZone) return text;
  try {
    const at = /^\d{4}-\d{2}-\d{2}/.test(String(date ?? "")) ? new Date(`${String(date).slice(0, 10)}T12:00:00Z`) : new Date();
    const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value;
    return zone ? `${text} ${zone}` : text;
  } catch {
    return text;
  }
}

/** The time most of these posts use, as HH:MM; a tie goes to the one that comes first (give the newest first). null with none. */
export function commonPostingTime(times: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const t of times) {
    const hhmm = postingTimeOf(t);
    if (hhmm) counts.set(hhmm, (counts.get(hhmm) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [t, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = t;
  return best;
}
