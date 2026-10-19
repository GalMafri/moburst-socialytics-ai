// supabase/functions/_shared/calendar/evidence.ts
//
// What a week's plan is written from (weekly calendar, Lital 19 Oct 2026),
// scored in code so no model decides what "worked":
//   * the client's own posts, each against the client's own median for the
//     same platform and format, once the post has had 48 hours to settle;
//   * competitor posts from the newest weekly feed, each against that
//     competitor's own median on that platform over the stored weeks, per
//     follower, leaving out posts RivalIQ marks as likely boosted;
//   * the client's posting rhythm, from what it actually published.
// There is no published threshold for "outperformed", so posts are ranked by
// how far above their own median they are and the multiple is shown as is.
// Free of Deno and network imports so it can be tested.

export interface OwnPost {
  id: string;
  /** Display name: Instagram, LinkedIn, Facebook, TikTok, YouTube, X. */
  platform: string;
  format: string;
  publishedAt: string;
  text: string;
  link: string | null;
  impressions: number | null;
  engagement: number;
}

export interface CompetitorPost {
  id: string;
  company: string;
  platform: string;
  format: string;
  publishedAt: string;
  text: string;
  link: string | null;
  engagement: number;
  followers: number | null;
  boosted: boolean;
}

export interface EvidenceItem {
  /** P = the client's post, C = competitor post, T = competitor topic, N = platform trend, R = report finding. */
  id: string;
  kind: "own" | "competitor" | "topic" | "trend" | "report";
  text: string;
  platform?: string;
  company?: string;
  format?: string;
  date?: string;
  link?: string | null;
  metric?: string;
  value?: number;
  median?: number;
  multiple?: number;
  /** Posts the median is from. */
  sample?: number;
  /** Too little history to call it more than an early signal. */
  thin?: boolean;
  /** Topics: how many companies posted about it. */
  companies?: number;
}

export interface RhythmLine {
  platform: string;
  perWeek: number;
  /** Weekdays the client usually posts on this platform, most used first. */
  days: string[];
  /** The hour it usually posts at, in the client's time zone ("17:00"). */
  time: string | null;
  /** Posts per week over the weeks looked at, before rounding. */
  average: number;
  source: "published" | "setting";
}

export const SETTLE_HOURS = 48;
export const OWN_DAYS = 90;
export const MIN_SAMPLE = 5;
export const MIN_COMPETITOR_WEEKS = 4;
export const RHYTHM_WEEKS = 8;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram", fb_instagram_account: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", linkedin_company: "LinkedIn",
  tiktok: "TikTok", youtube: "YouTube", twitter: "X", x: "X", threads: "Threads", pinterest: "Pinterest",
};

export function platformName(raw: unknown): string {
  const key = String(raw ?? "").trim().toLowerCase();
  return PLATFORM_NAMES[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : "");
}

/**
 * RivalIQ marks Facebook posts "Likely Boosted", "Not Likely Boosted" or "No
 * Prediction" (as text); paid reach is not a content signal. The same reading
 * as the competitor feed page and the competitive aggregate.
 */
export function isBoosted(v: unknown): boolean {
  return typeof v === "string" ? v.trim().toLowerCase() === "likely boosted" : v === true;
}

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const day = (iso: string) => String(iso).slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const excerpt = (s: string, n = 220) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

interface Scored<T> {
  post: T;
  value: number;
  median: number;
  multiple: number;
  metric: string;
  sample: number;
  thin: boolean;
}

/**
 * The client's posts from the last 90 days that have settled, each against
 * the client's median for the same platform and format: impressions where
 * the platform reports them for most posts, engagement where it does not.
 */
export function scoreOwnPosts(posts: OwnPost[], now: Date, opts: { top?: number; low?: number } = {}): {
  top: Scored<OwnPost>[];
  low: Scored<OwnPost>[];
  platforms: Record<string, { posts: number; thin: boolean }>;
} {
  const t = now.getTime();
  const settled = posts.filter((p) => {
    const at = Date.parse(p.publishedAt);
    return Number.isFinite(at) && at <= t - SETTLE_HOURS * 3600_000 && at >= t - OWN_DAYS * 86400_000;
  });
  const perPlatform = new Map<string, number>();
  for (const p of settled) perPlatform.set(p.platform, (perPlatform.get(p.platform) ?? 0) + 1);
  const groups = new Map<string, OwnPost[]>();
  for (const p of settled) {
    const key = `${p.platform}|${p.format}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const scored: Scored<OwnPost>[] = [];
  for (const group of groups.values()) {
    const withImpressions = group.filter((p) => (p.impressions ?? 0) > 0).length;
    const useImpressions = withImpressions >= Math.ceil(group.length / 2);
    const metric = useImpressions ? "impressions" : "engagement";
    const valueOf = (p: OwnPost) => (useImpressions ? (p.impressions ?? null) : p.engagement);
    const values = group.map(valueOf).filter((v): v is number => v !== null && Number.isFinite(v));
    const mid = median(values);
    if (mid === null || mid <= 0) continue;
    const thin = group.length < MIN_SAMPLE || (perPlatform.get(group[0].platform) ?? 0) < MIN_SAMPLE;
    for (const p of group) {
      const v = valueOf(p);
      if (v === null) continue;
      scored.push({ post: p, value: v, median: mid, multiple: round1(v / mid), metric, sample: group.length, thin });
    }
  }
  const platforms = Object.fromEntries([...perPlatform].map(([k, n]) => [k, { posts: n, thin: n < MIN_SAMPLE }]));
  return {
    top: scored.filter((s) => s.multiple > 1).sort((a, b) => b.multiple - a.multiple).slice(0, opts.top ?? 8),
    low: scored.filter((s) => s.multiple < 1).sort((a, b) => a.multiple - b.multiple).slice(0, opts.low ?? 4),
    platforms,
  };
}

/**
 * Competitor posts from the newest feed week that beat that competitor's own
 * median on the same platform, measured over every stored week. Engagement
 * per follower where RivalIQ gives followers; likely-boosted posts are left
 * out because paid reach is not a content signal.
 */
export function scoreCompetitorPosts(posts: CompetitorPost[], newestStart: string, weeksOfHistory: number, opts: { top?: number } = {}): Scored<CompetitorPost>[] {
  const organic = posts.filter((p) => !p.boosted);
  const groups = new Map<string, CompetitorPost[]>();
  for (const p of organic) {
    const key = `${p.company}|${p.platform}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: Scored<CompetitorPost>[] = [];
  for (const group of groups.values()) {
    const perFollower = group.every((p) => (p.followers ?? 0) > 0);
    const metric = perFollower ? "engagement per follower" : "engagement";
    const valueOf = (p: CompetitorPost) => (perFollower ? p.engagement / (p.followers as number) : p.engagement);
    const mid = median(group.map(valueOf));
    if (mid === null || mid <= 0) continue;
    const thin = group.length < MIN_SAMPLE || weeksOfHistory < MIN_COMPETITOR_WEEKS;
    for (const p of group) {
      if (day(p.publishedAt) < newestStart) continue;
      const v = valueOf(p);
      const multiple = round1(v / mid);
      if (multiple <= 1) continue;
      out.push({ post: p, value: v, median: mid, multiple, metric, sample: group.length, thin });
    }
  }
  return out.sort((a, b) => b.multiple - a.multiple).slice(0, opts.top ?? 10);
}

function zoned(iso: string, timeZone: string): { weekday: string; hour: string; date: string } {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { weekday: get("weekday"), hour: get("hour"), date: `${get("year")}-${get("month")}-${get("day")}` };
  } catch {
    return { weekday: WEEKDAYS[(d.getUTCDay() + 6) % 7], hour: String(d.getUTCHours()).padStart(2, "0"), date: d.toISOString().slice(0, 10) };
  }
}

function mondayOfDate(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000).toISOString().slice(0, 10);
}

/**
 * How often the client publishes on each platform: posts per week over the
 * last eight full weeks, with the weekdays and hour it usually posts at.
 * Platforms it posts on less than every other week are left out.
 */
export function rhythmFromPosts(posts: OwnPost[], now: Date, timeZone: string): RhythmLine[] {
  const thisMonday = mondayOfDate(zoned(now.toISOString(), timeZone).date);
  const first = new Date(Date.parse(`${thisMonday}T00:00:00Z`) - RHYTHM_WEEKS * 7 * 86400_000).toISOString().slice(0, 10);
  const byPlatform = new Map<string, Array<{ weekday: string; hour: string }>>();
  for (const p of posts) {
    const z = zoned(p.publishedAt, timeZone);
    if (!z.date || z.date < first || z.date >= thisMonday) continue;
    byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), { weekday: z.weekday, hour: z.hour }]);
  }
  const lines: RhythmLine[] = [];
  for (const [platform, seen] of byPlatform) {
    const average = seen.length / RHYTHM_WEEKS;
    const perWeek = Math.min(7, Math.round(average));
    if (perWeek < 1) continue;
    const dayCounts = new Map<string, number>();
    const hourCounts = new Map<string, number>();
    for (const s of seen) {
      dayCounts.set(s.weekday, (dayCounts.get(s.weekday) ?? 0) + 1);
      hourCounts.set(s.hour, (hourCounts.get(s.hour) ?? 0) + 1);
    }
    const days = [...dayCounts].sort((a, b) => b[1] - a[1] || WEEKDAYS.indexOf(a[0]) - WEEKDAYS.indexOf(b[0])).map(([d]) => d);
    const hour = [...hourCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    lines.push({ platform, perWeek, days, time: hour ? `${hour}:00` : null, average: round1(average), source: "published" });
  }
  return lines.sort((a, b) => b.perWeek - a.perWeek || a.platform.localeCompare(b.platform));
}

/** Staff's posts-per-week setting wins for the platforms it names; 0 removes a platform. */
export function applyRhythmSetting(learned: RhythmLine[], setting: Record<string, unknown> | null | undefined): RhythmLine[] {
  if (!setting || typeof setting !== "object") return learned;
  const out = new Map(learned.map((l) => [l.platform, l]));
  for (const [rawPlatform, rawCount] of Object.entries(setting)) {
    const platform = platformName(rawPlatform);
    const n = Math.max(0, Math.min(7, Math.round(Number(rawCount))));
    if (!platform || !Number.isFinite(n)) continue;
    if (n === 0) { out.delete(platform); continue; }
    const had = out.get(platform);
    out.set(platform, { platform, perWeek: n, days: had?.days ?? [], time: had?.time ?? null, average: had?.average ?? 0, source: "setting" });
  }
  return [...out.values()].sort((a, b) => b.perWeek - a.perWeek || a.platform.localeCompare(b.platform));
}

/** The client's best recent posts per platform, as examples of its real voice. */
export function bestExamples(top: Scored<OwnPost>[], perPlatform = 3): Record<string, Array<{ text: string; date: string; link: string | null; format: string }>> {
  const out: Record<string, Array<{ text: string; date: string; link: string | null; format: string }>> = {};
  for (const s of top) {
    if (String(s.post.text || "").trim().length < 20) continue;
    const list = (out[s.post.platform] ??= []);
    if (list.length < perPlatform) list.push({ text: excerpt(s.post.text, 600), date: day(s.post.publishedAt), link: s.post.link, format: s.post.format });
  }
  return out;
}

export interface EvidenceInput {
  ownTop: Scored<OwnPost>[];
  competitors: Scored<CompetitorPost>[];
  topics: Array<{ topic: string; summary?: string | null; companies?: unknown; post_urls?: unknown }>;
  trends: string[];
  findings: string[];
}

/** Numbered evidence the planner cites by id; the numbers on a post's reason come from here, never from the model. */
export function numberEvidence(input: EvidenceInput): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  input.ownTop.forEach((s, i) => items.push({
    id: `P${i + 1}`, kind: "own", text: excerpt(s.post.text), platform: s.post.platform, format: s.post.format, date: day(s.post.publishedAt),
    link: s.post.link, metric: s.metric, value: s.value, median: s.median, multiple: s.multiple, sample: s.sample, thin: s.thin,
  }));
  input.competitors.forEach((s, i) => items.push({
    id: `C${i + 1}`, kind: "competitor", text: excerpt(s.post.text), company: s.post.company, platform: s.post.platform, format: s.post.format,
    date: day(s.post.publishedAt), link: s.post.link, metric: s.metric, value: s.value, median: s.median, multiple: s.multiple, sample: s.sample, thin: s.thin,
  }));
  input.topics.slice(0, 8).forEach((t, i) => {
    const companies = Array.isArray(t.companies) ? t.companies.length : undefined;
    const urls = Array.isArray(t.post_urls) ? (t.post_urls as unknown[]).map(String) : [];
    items.push({ id: `T${i + 1}`, kind: "topic", text: excerpt(`${t.topic}${t.summary ? `: ${t.summary}` : ""}`, 260), companies, link: urls[0] ?? null });
  });
  input.trends.slice(0, 8).forEach((t, i) => items.push({ id: `N${i + 1}`, kind: "trend", text: excerpt(t, 260) }));
  input.findings.slice(0, 10).forEach((f, i) => items.push({ id: `R${i + 1}`, kind: "report", text: excerpt(f, 260) }));
  return items;
}
