// supabase/functions/_shared/calendar/evidence.ts
//
// What a week's plan is written from (weekly calendar, Lital 19 Oct 2026),
// scored in code so no model decides what "worked":
//   * the client's own posts, each against the client's own median for the
//     same platform and format, once the post has had 48 hours to settle;
//   * competitor posts from the newest weekly feed, each against that
//     competitor's own median on that platform over the stored weeks, per
//     follower, leaving out posts RivalIQ marks as likely boosted;
//   * the client's posting rhythm, which always resolves (resolveRhythm):
//     its own posting, then its competitors', then every tracked company's.
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
  /** Paid promotion (Sprout's is_boosted, RivalIQ's "Likely Boosted"): left out, paid reach is not a content signal. */
  boosted?: boolean;
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

/**
 * Where a platform's posts per week came from, in order of preference:
 * the client's own posts over the last 8 full weeks, its own posts over 90
 * days, the median of its tracked competitors, the median of every company
 * the app tracks; or staff's setting, which overrides all of them.
 */
export type RhythmSource = "published_8w" | "published_90d" | "competitors" | "all_tracked" | "setting";

export interface RhythmLine {
  platform: string;
  /** Posts this week (a rate under 1 a week plans some weeks only). */
  perWeek: number;
  /** Weekdays the client usually posts on this platform, most used first. */
  days: string[];
  /** The hour it usually posts at, in the client's time zone ("17:00"). */
  time: string | null;
  /** Posts per week, before rounding. */
  average: number;
  source: RhythmSource;
}

export const SETTLE_HOURS = 48;
export const OWN_DAYS = 90;
export const MIN_SAMPLE = 5;
export const MIN_COMPETITOR_WEEKS = 4;
export const RHYTHM_WEEKS = 8;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram", fb_instagram_account: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", linkedin_company: "LinkedIn",
  tiktok: "TikTok", youtube: "YouTube", twitter: "X", x: "X", "twitter/x": "X", "x (twitter)": "X", threads: "Threads", pinterest: "Pinterest",
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

/** How far above its usual a value is, smoothed so a near-zero usual can't produce a four-digit multiple. */
const ratio = (value: number, usual: number) => (value + 1) / (usual + 1);

/**
 * The client's organic posts from the last 90 days that have settled, each
 * against the client's median for the same platform and format. A post
 * counts as far above its usual as both its reach (impressions, where the
 * platform reports them for most posts) and its engagement say: paid views
 * inflate reach far more than engagement, so an ad cannot top the list on
 * reach alone. The multiple shown is the lower of the two, with its metric.
 */
export function scoreOwnPosts(posts: OwnPost[], now: Date, opts: { top?: number; low?: number } = {}): {
  top: Scored<OwnPost>[];
  low: Scored<OwnPost>[];
  platforms: Record<string, { posts: number; thin: boolean }>;
} {
  const t = now.getTime();
  const settled = posts.filter((p) => {
    const at = Date.parse(p.publishedAt);
    return !p.boosted && Number.isFinite(at) && at <= t - SETTLE_HOURS * 3600_000 && at >= t - OWN_DAYS * 86400_000;
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
    const reported = group.filter((p) => (p.impressions ?? 0) > 0);
    const useImpressions = reported.length >= Math.ceil(group.length / 2);
    const engagementMid = median(group.map((p) => p.engagement)) ?? 0;
    const impressionsMid = useImpressions ? median(reported.map((p) => p.impressions as number)) : null;
    const thin = group.length < MIN_SAMPLE || (perPlatform.get(group[0].platform) ?? 0) < MIN_SAMPLE;
    for (const p of group) {
      const byEngagement = { metric: "engagement", value: p.engagement, median: engagementMid, multiple: ratio(p.engagement, engagementMid) };
      const byReach = impressionsMid !== null && (p.impressions ?? 0) > 0
        ? { metric: "impressions", value: p.impressions as number, median: impressionsMid, multiple: ratio(p.impressions as number, impressionsMid) }
        : null;
      const binding = byReach && byReach.multiple < byEngagement.multiple ? byReach : byEngagement;
      scored.push({ post: p, value: binding.value, median: binding.median, multiple: round1(binding.multiple), metric: binding.metric, sample: group.length, thin });
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
  // A post with no date can't be placed in a week, and one with no text can't be judged for fit.
  const organic = posts.filter((p) => !p.boosted && /^\d{4}-\d{2}-\d{2}/.test(String(p.publishedAt)) && String(p.text || "").trim().length > 0);
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
    if (mid === null || (perFollower && mid <= 0)) continue;
    const thin = group.length < MIN_SAMPLE || weeksOfHistory < MIN_COMPETITOR_WEEKS;
    for (const p of group) {
      if (day(p.publishedAt) < newestStart) continue;
      const v = valueOf(p);
      // Per follower, both sides are small fractions of the same scale; raw engagement is smoothed like the client's.
      const multiple = round1(perFollower ? v / mid : ratio(v, mid));
      if (multiple <= 1) continue;
      out.push({ post: p, value: v, median: mid, multiple, metric, sample: group.length, thin });
    }
  }
  return out.sort((a, b) => b.multiple - a.multiple).slice(0, opts.top ?? 10);
}

function zoned(iso: string, timeZone: string): { weekday: string; hour: string | null; date: string } {
  const text = String(iso ?? "");
  // A date with no time (some feed rows) is that calendar day, with no hour to learn from.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { weekday: WEEKDAYS[(new Date(`${text}T00:00:00Z`).getUTCDay() + 6) % 7], hour: null, date: text };
  }
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return { weekday: "", hour: null, date: "" };
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { weekday: get("weekday"), hour: get("hour"), date: `${get("year")}-${get("month")}-${get("day")}` };
  } catch {
    return { weekday: WEEKDAYS[(d.getUTCDay() + 6) % 7], hour: String(d.getUTCHours()).padStart(2, "0"), date: d.toISOString().slice(0, 10) };
  }
}

const DAY_MS = 86400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const addDay = (isoDay: string, n: number) => new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const validDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s.slice(0, 10)));

function mondayOfDate(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000).toISOString().slice(0, 10);
}

interface Timing {
  posts: number;
  days: string[];
  time: string | null;
}

/**
 * Per platform: how many posts went out from one date up to (not including)
 * another, in the client's time zone, the weekdays used most and the usual
 * hour.
 */
function timing(posts: Array<{ platform: string; publishedAt: string }>, timeZone: string, from: string, before: string): Map<string, Timing> {
  const seen = new Map<string, Array<{ weekday: string; hour: string | null }>>();
  for (const p of posts) {
    const z = zoned(p.publishedAt, timeZone);
    if (!p.platform || !z.date || z.date < from || z.date >= before) continue;
    seen.set(p.platform, [...(seen.get(p.platform) ?? []), z]);
  }
  const out = new Map<string, Timing>();
  for (const [platform, list] of seen) {
    const dayCounts = new Map<string, number>();
    const hourCounts = new Map<string, number>();
    for (const s of list) {
      dayCounts.set(s.weekday, (dayCounts.get(s.weekday) ?? 0) + 1);
      if (s.hour !== null) hourCounts.set(s.hour, (hourCounts.get(s.hour) ?? 0) + 1);
    }
    const days = [...dayCounts].sort((a, b) => b[1] - a[1] || WEEKDAYS.indexOf(a[0]) - WEEKDAYS.indexOf(b[0])).map(([d]) => d);
    const hour = [...hourCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    out.set(platform, { posts: list.length, days, time: hour ? `${hour}:00` : null });
  }
  return out;
}

/** The last eight full weeks, Monday to Sunday in the client's time zone, before the current one. */
function rhythmWindow(now: Date, timeZone: string): { from: string; before: string } {
  const before = mondayOfDate(zoned(now.toISOString(), timeZone).date);
  return { from: addDay(before, -RHYTHM_WEEKS * 7), before };
}

const sortLines = (lines: RhythmLine[]) =>
  lines.sort((a, b) => b.perWeek - a.perWeek || b.average - a.average || a.platform.localeCompare(b.platform));

/**
 * How often the client publishes on each platform: posts per week over the
 * last eight full weeks, with the weekdays and hour it usually posts at.
 * Platforms it posts on less than every other week are left out. This is the
 * learned part of the rhythm; resolveRhythm plans from it first.
 */
export function rhythmFromPosts(posts: OwnPost[], now: Date, timeZone: string): RhythmLine[] {
  const { from, before } = rhythmWindow(now, timeZone);
  const lines: RhythmLine[] = [];
  for (const [platform, t] of timing(posts, timeZone, from, before)) {
    const average = t.posts / RHYTHM_WEEKS;
    const perWeek = Math.min(7, Math.round(average));
    if (perWeek < 1) continue;
    lines.push({ platform, perWeek, days: t.days, time: t.time, average: round1(average), source: "published_8w" });
  }
  return sortLines(lines);
}

/** The Monday the rule for rates under one a week counts weeks from. */
export const RATE_EPOCH = "2026-01-05";

/**
 * Posts a platform gets in the week that starts on a Monday. A weekly habit
 * (WEEKLY_RATE or more, such as Moburst's Instagram at 0.88) is rounded, at
 * least 1 and at most 7. A lower rate is spread by a fixed rule with no
 * state: week w, counted in whole weeks from RATE_EPOCH, gets
 * floor(rate*(w+1)) - floor(rate*w) posts, so 0.5 a week posts every other
 * week and 0.25 every fourth.
 */
export const WEEKLY_RATE = 0.75;
export function postsInWeek(rate: number, monday: string): number {
  if (!(rate > 0)) return 0;
  if (rate >= WEEKLY_RATE) return Math.max(1, Math.min(7, Math.round(rate)));
  const w = Math.floor((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${RATE_EPOCH}T00:00:00Z`)) / (7 * DAY_MS));
  // The small margin keeps float error (0.29 * 100 = 28.999…) from moving a post a week.
  const floor = (x: number) => Math.floor(x + 1e-9);
  return Math.min(7, floor(rate * (w + 1)) - floor(rate * w));
}

/**
 * Staff's posts-per-week setting wins for the platforms it names; 0 removes a
 * platform. A platform it adds gets its usual days and hour from timingOf.
 */
export function applyRhythmSetting(
  learned: RhythmLine[],
  setting: Record<string, unknown> | null | undefined,
  timingOf: (platform: string) => { days: string[]; time: string | null } | undefined = () => undefined,
): RhythmLine[] {
  if (!setting || typeof setting !== "object") return learned;
  const out = new Map(learned.map((l) => [l.platform, l]));
  for (const [rawPlatform, rawCount] of Object.entries(setting)) {
    if (rawCount === null || rawCount === undefined || rawCount === "") continue;
    const platform = platformName(rawPlatform);
    const n = Math.max(0, Math.min(7, Math.round(Number(rawCount))));
    if (!platform || !Number.isFinite(n)) continue;
    if (n === 0) { out.delete(platform); continue; }
    const had = out.get(platform);
    const usual = had ?? timingOf(platform);
    out.set(platform, { platform, perWeek: n, days: usual?.days ?? [], time: usual?.time ?? null, average: had?.average ?? n, source: "setting" });
  }
  return sortLines([...out.values()]);
}

// ── Where the rhythm comes from when the client's own posting can't say ────

/** A company's post, as posting rates need it. */
export interface TrackedPost {
  /** The company, the same key in every feed (its normalized name). */
  company: string;
  platform: string;
  publishedAt: string;
}

/** A company's name without case, punctuation or legal suffixes ("Ltd", "LLC"), so feeds and competitor sets agree on who is who. */
export function companyKey(name: unknown): string {
  return String(name ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|pa|llp|lp|group|the)\b/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The median posts per week on each platform across companies. A company's
 * rate is its posts there over the weeks its feed covers; only companies that
 * posted on the platform count. A company seen in several clients' feeds
 * counts once, from the feed that covers the most weeks.
 */
export function medianRates(groups: Array<{ weeks: number; posts: TrackedPost[] }>): Record<string, number> {
  const best = new Map<string, { weeks: number; counts: Map<string, number> }>();
  for (const g of groups) {
    const weeks = Math.max(1, g.weeks);
    const byCompany = new Map<string, Map<string, number>>();
    for (const p of g.posts) {
      if (!p.company || !p.platform) continue;
      const counts = byCompany.get(p.company) ?? new Map<string, number>();
      counts.set(p.platform, (counts.get(p.platform) ?? 0) + 1);
      byCompany.set(p.company, counts);
    }
    for (const [company, counts] of byCompany) {
      const had = best.get(company);
      if (!had || weeks > had.weeks) best.set(company, { weeks, counts });
    }
  }
  const rates = new Map<string, number[]>();
  for (const { weeks, counts } of best.values()) {
    for (const [platform, n] of counts) rates.set(platform, [...(rates.get(platform) ?? []), n / weeks]);
  }
  const out: Record<string, number> = {};
  for (const [platform, xs] of rates) {
    const m = round2(median(xs) ?? 0);
    if (m > 0) out[platform] = m;
  }
  return out;
}

/** Which company in a feed is the client: the feed's own id for it, else its Sprout posts or its name. */
// deno-lint-ignore no-explicit-any
export function clientCompanyId(payload: any, clientName: string): string | null {
  if (payload?.client_company_id) return String(payload.client_company_id);
  // deno-lint-ignore no-explicit-any
  const own = (payload?.socialPosts ?? []).find((p: any) => p?.source === "sprout" || String(p?.companyName || "").toLowerCase() === clientName.toLowerCase());
  return own?.companyId ? String(own.companyId) : null;
}

// deno-lint-ignore no-explicit-any
export function isClientPost(p: any, clientCompany: string | null, clientName: string): boolean {
  if (clientCompany && String(p?.companyId) === clientCompany) return true;
  const name = String(p?.companyName || "").toLowerCase();
  return !!clientName && !!name && name.includes(clientName.toLowerCase());
}

/** A weekly feed snapshot reduced to what posting rates need; the post text is left behind, since snapshots are large. */
export interface FeedRow {
  client_id: string;
  window: { start: string; end: string } | null;
  client_company_id: string | null;
  posts: Array<{ id: string; companyId: string; companyName: string; channel: string; publishedAt: string; source: string | null }>;
}

// deno-lint-ignore no-explicit-any
export function compactFeedRow(row: { client_id: unknown; feed_window?: any; client_company_id?: unknown; posts?: unknown }): FeedRow {
  const w = row.feed_window;
  // deno-lint-ignore no-explicit-any
  const posts = (Array.isArray(row.posts) ? row.posts : []).map((p: any) => ({
    id: String(p?.postId || p?.nativeId || p?.postLink || ""),
    companyId: String(p?.companyId ?? ""),
    companyName: String(p?.companyName ?? ""),
    channel: String(p?.channel ?? ""),
    publishedAt: String(p?.publishedAt ?? ""),
    source: p?.source ? String(p.source) : null,
  }));
  return {
    client_id: String(row.client_id ?? ""),
    window: w && validDay(w.start) && validDay(w.end) ? { start: String(w.start).slice(0, 10), end: String(w.end).slice(0, 10) } : null,
    client_company_id: row.client_company_id ? String(row.client_company_id) : null,
    posts,
  };
}

export interface FeedPost extends TrackedPost {
  companyId: string;
  companyName: string;
  /** The client's own post, in its own feed. */
  own: boolean;
}

export interface FeedHistory {
  /** Weeks the feeds cover: the distinct days inside their windows over 7, at least 1. */
  weeks: number;
  posts: FeedPost[];
}

/**
 * Each client's feed history: every post once (by post id, native id or
 * link), only posts with a date, and the weeks the feeds cover with
 * overlapping windows counted once.
 */
export function feedHistories(rows: FeedRow[], clientNames: Record<string, string> = {}): Map<string, FeedHistory> {
  const acc = new Map<string, { days: Set<string>; posts: Map<string, FeedPost> }>();
  for (const row of rows) {
    if (!row.client_id) continue;
    const h = acc.get(row.client_id) ?? { days: new Set<string>(), posts: new Map<string, FeedPost>() };
    acc.set(row.client_id, h);
    if (row.window && row.window.start <= row.window.end) {
      for (let d = row.window.start, i = 0; d <= row.window.end && i < 400; d = addDay(d, 1), i++) h.days.add(d);
    }
    const name = clientNames[row.client_id] ?? "";
    const clientCompany = clientCompanyId({ client_company_id: row.client_company_id, socialPosts: row.posts }, name);
    for (const p of row.posts) {
      if (!p.id || h.posts.has(p.id) || !validDay(p.publishedAt)) continue;
      const platform = platformName(p.channel);
      const company = companyKey(p.companyName) || (p.companyId ? `id:${p.companyId}` : "");
      if (!platform || !company) continue;
      h.posts.set(p.id, { company, platform, publishedAt: p.publishedAt, companyId: p.companyId, companyName: p.companyName, own: isClientPost(p, clientCompany, name) });
    }
  }
  return new Map([...acc].map(([id, h]) => [id, { weeks: Math.max(1, h.days.size / 7), posts: [...h.posts.values()] }]));
}

/**
 * The posts of the client's tracked competitors: only the companies in its
 * current competitor set, matched by RivalIQ company id where the set stores
 * one and by name otherwise, so a feed that briefly held another landscape
 * can't skew the client's numbers. Never the client's own posts.
 */
export function competitorPosts(history: FeedHistory | undefined, set: Array<{ name: string; rivaliq_company_id?: string | null }>): { weeks: number; posts: TrackedPost[] } {
  const weeks = history?.weeks ?? 1;
  if (!history || !set.length) return { weeks, posts: [] };
  const idOf = (c: { rivaliq_company_id?: string | null }) => String(c.rivaliq_company_id ?? "").trim();
  const ids = new Set(set.map(idOf).filter(Boolean));
  const names = new Set(set.filter((c) => !idOf(c)).map((c) => companyKey(c.name)).filter(Boolean));
  return { weeks, posts: history.posts.filter((p) => !p.own && (ids.has(p.companyId) || names.has(companyKey(p.companyName)))) };
}

export interface RhythmInput {
  /** The client's own posts from the last 90 days. */
  own: OwnPost[];
  /** clients.primary_platforms, as stored. */
  primaryPlatforms: unknown;
  /** The client's tracked competitors' posts, from all its feeds. */
  competitors: { weeks: number; posts: TrackedPost[] };
  /** Median posts per week per platform across every company the app tracks; null when not read yet (it is read only when needed). */
  allTracked: Record<string, number> | null;
  /** clients.posting_rhythm: staff's override, optional. */
  setting: Record<string, unknown> | null | undefined;
  /** The Monday of the week being planned. */
  monday: string;
  now: Date;
  timeZone: string;
}

export interface RhythmSources {
  /** Where the list of platforms came from. */
  platforms: "published_90d" | "primary_platforms" | "all_tracked";
  /** Weeks of competitor feeds the competitor rates are from. */
  competitor_weeks: number;
  /** Competitors with posts in those feeds. */
  competitor_companies: number;
  /** Platforms no source had a rate for, left out of the plan. */
  unrated: string[];
}

export interface ResolvedRhythm {
  /** Each platform's rate, where it came from, and its posts this week before staff's setting. */
  learned: RhythmLine[];
  /** What the week follows: the setting applied, platforms with no post this week left out. */
  applied: RhythmLine[];
  /** A rate can only come from every tracked company and allTracked was not given: read it and resolve again. */
  needsAllTracked: boolean;
  sources: RhythmSources;
}

/**
 * The posting rhythm a week is planned with. It never needs a setting:
 *   * platforms: those the client published on in the last 90 days; with
 *     none, its primary platforms;
 *   * each platform's rate, the first that exists: its own posts over the
 *     last 8 full weeks, its own posts over 90 days, the median of its
 *     tracked competitors, the median of every company the app tracks;
 *   * a platform no source has a rate for is left out, and when no platform
 *     resolves at all, every platform with a median across tracked companies
 *     is planned, so a plan always has platforms;
 *   * rates under one a week post some weeks only (postsInWeek);
 *   * usual days and hour from the client's own posts, else its competitors';
 *   * staff's setting overrides per platform (0 removes one).
 */
/**
 * The platforms with posts this week. A week where every platform's spread
 * comes to 0 still gets one post, on the platform it posts on most: a planned
 * week is never empty. A platform staff set to 0 stays out.
 */
function atLeastOne(lines: RhythmLine[]): RhythmLine[] {
  const posting = lines.filter((l) => l.perWeek > 0);
  if (posting.length || !lines.length) return posting;
  const top = [...lines].sort((a, b) => b.average - a.average || a.platform.localeCompare(b.platform))[0];
  return [{ ...top, perWeek: 1 }];
}

export function resolveRhythm(input: RhythmInput): ResolvedRhythm {
  const tz = input.timeZone;
  const today = zoned(input.now.toISOString(), tz).date || input.now.toISOString().slice(0, 10);
  const last8 = rhythmWindow(input.now, tz);
  const own8 = timing(input.own, tz, last8.from, last8.before);
  const own90 = timing(input.own, tz, addDay(today, -OWN_DAYS), today);
  const competitorRates = medianRates([input.competitors]);
  const competitorTiming = timing(input.competitors.posts, tz, "0000-01-01", "9999-12-31");
  const timingOf = (platform: string) => own90.get(platform) ?? own8.get(platform) ?? competitorTiming.get(platform);
  const line = (platform: string, rate: number, source: RhythmSource, t: Timing | undefined): RhythmLine =>
    ({ platform, perWeek: postsInWeek(rate, input.monday), days: t?.days ?? [], time: t?.time ?? null, average: rate, source });

  const primary = [...new Set((Array.isArray(input.primaryPlatforms) ? input.primaryPlatforms : []).map(platformName).filter(Boolean))];
  let from: RhythmSources["platforms"] = own90.size ? "published_90d" : "primary_platforms";
  const platforms = own90.size ? [...own90.keys()] : primary;

  const learned: RhythmLine[] = [];
  const unrated: string[] = [];
  let needsAllTracked = false;
  for (const platform of platforms) {
    // The client's own pace: its last 8 weeks when that is a weekly habit;
    // otherwise the faster of its 8-week and 90-day pace, so a quiet month
    // (Pay The Pyper: 0.25 a week lately, 0.78 over 90 days) does not shrink
    // its calendar below what it has kept up over the quarter.
    const r8 = round2((own8.get(platform)?.posts ?? 0) / RHYTHM_WEEKS);
    const r90 = round2(((own90.get(platform)?.posts ?? 0) * 7) / OWN_DAYS);
    if (r8 >= WEEKLY_RATE || (r8 > 0 && r8 >= r90)) learned.push(line(platform, r8, "published_8w", own8.get(platform)));
    else if (r90 > 0) learned.push(line(platform, r90, "published_90d", own90.get(platform)));
    else if ((competitorRates[platform] ?? 0) > 0) learned.push(line(platform, competitorRates[platform], "competitors", competitorTiming.get(platform)));
    else if (input.allTracked === null) needsAllTracked = true;
    else if ((input.allTracked[platform] ?? 0) > 0) learned.push(line(platform, input.allTracked[platform], "all_tracked", timingOf(platform)));
    else unrated.push(platform);
  }
  if (!learned.length) {
    if (input.allTracked === null) needsAllTracked = true;
    else {
      from = "all_tracked";
      for (const [platform, rate] of Object.entries(input.allTracked)) {
        if (rate > 0) learned.push(line(platform, rate, "all_tracked", timingOf(platform)));
      }
    }
  }
  sortLines(learned);
  return {
    learned,
    applied: atLeastOne(applyRhythmSetting(learned, input.setting, timingOf)),
    needsAllTracked,
    sources: {
      platforms: from,
      competitor_weeks: round1(input.competitors.weeks),
      competitor_companies: new Set(input.competitors.posts.map((p) => p.company)).size,
      unrated,
    },
  };
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
