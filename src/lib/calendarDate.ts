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
    throw new Error("The client's timezone is invalid. Correct it in Client Setup before scheduling.");
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
