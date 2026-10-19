// The posting rhythm on screen (weekly calendar, 19 Oct 2026): what each
// week's plan follows per platform and where that came from, and the
// optional posts-per-week override on clients.posting_rhythm.

/** One platform of the rhythm the latest plan resolved (calendar_plans.rhythm.learned). */
export interface ResolvedRhythmLine {
  platform: string;
  /** Posts per week before rounding. */
  average: number;
  source: string;
}

/** Where the latest plan's platforms and rates came from (calendar_plans.rhythm.sources). */
export interface RhythmSourcesSummary {
  platforms?: string;
  unrated?: string[];
}

/** The setting as stored on clients.posting_rhythm: numbers only, null when nothing overrides. */
export function rhythmSetting(value: Record<string, string>): Record<string, number> | null {
  const entries = Object.entries(value).filter(([, v]) => v !== "" && Number.isFinite(Number(v))).map(([k, v]) => [k, Math.max(0, Math.min(7, Number(v)))] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}

/** "3 a week", or "1 every 4 weeks" for a rate under one a week. */
export function rateWords(average: number): string {
  if (!(average > 0)) return "None planned";
  if (average >= 1) return `${Math.min(7, Math.round(average))} a week`;
  const every = Math.round(1 / average);
  return every <= 1 ? "1 a week" : `1 every ${every} weeks`;
}

const SOURCE_WORDS: Record<string, string> = {
  published_8w: "From its posts in the last 8 weeks",
  // Plans from before 19 Oct 2026 evening called the 8-week rhythm "published".
  published: "From its posts in the last 8 weeks",
  published_90d: "From its posts in the last 90 days",
  competitors: "From its competitors",
  all_tracked: "From companies the app tracks",
};

/** Where a platform's rate came from, in plain words. */
export function sourceWords(source: string): string {
  return SOURCE_WORDS[source] ?? "";
}
