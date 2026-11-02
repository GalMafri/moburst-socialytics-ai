// supabase/functions/_shared/strategy/platforms.ts
//
// Where a client's content strategy stands on each platform, decided from
// data rather than a toggle (spec: docs/superpowers/specs/2026-11-02-content-
// strategy-tab-design.md, "Brand new or set up"), so one client can run
// Instagram and launch TikTok in the same strategy:
//   posting    the client published there in the last 90 days, read the way
//              the calendar reads its own posts (Sprout, or RivalIQ's copy);
//   new        a platform the client chose, or one with an active Sprout
//              account, with no posts in 90 days (a quiet account is new,
//              and its handle is named);
//   candidate  a platform the trend profile lists for the industry that the
//              client neither posts on nor chose; the strategy's writer marks
//              each one new or not now, at most two new.
// Platforms nobody chose (the setup page's untouched default) are no choice,
// so a client with no posts and no accounts gets its list from the profile.
// Cadence is the calendar's own rhythm wherever the calendar has a line, and
// otherwise the same fallbacks it uses: the tracked competitors' median, then
// every tracked company's. Free of Deno and network imports so it can be
// tested, and so the screens can read the same keys.

import { median, platformName, SETTLE_HOURS, OWN_DAYS, type OwnPost, type RhythmLine, type RhythmSource } from "../calendar/evidence.ts";

export type PlatformState = "posting" | "new" | "candidate";
/** A platform's state once the strategy is written: a candidate has become new or not now. */
export type WrittenState = "posting" | "new" | "not_now";

export interface Cadence {
  /** Posts per week: the calendar's average rate, a setting as set, or a fallback median. */
  per_week: number;
  source: RhythmSource;
}

/** The last 90 days on a platform, measured in code: what a strategy's targets are stated against. */
export interface Baseline {
  posts: number;
  posts_per_week: number;
  /** Over settled organic posts; null with none. */
  median_engagement: number | null;
  /** Engagement over impressions, settled organic posts that report impressions; null with none. */
  engagement_rate: number | null;
}

export interface StrategyPlatform {
  /** As people write it: Instagram, TikTok, X. */
  platform: string;
  /** The platform in a section key: instagram, tiktok, x. */
  key: string;
  state: PlatformState;
  /** The handle of the client's active Sprout account there, if it has one. */
  handle: string | null;
  /** Why the trend profile lists it, when it does. */
  profile_reason: string | null;
  cadence: Cadence | null;
  /** Posting platforms only. */
  baseline: Baseline | null;
}

export interface PlatformInput {
  /** The client's own posts, as the calendar's gatherEvidence reads them. */
  own: OwnPost[];
  now: Date;
  /** clients.primary_platforms, as stored. */
  primary: unknown;
  /** Someone (a person, the lifecycle or the portal) set the primary platforms; the untouched default is no choice. */
  primarySet: boolean;
  /** The client's active Sprout accounts. */
  accounts: Array<{ network_type: string | null; native_name: string | null }>;
  /** trend_profiles.platforms. */
  profile: Array<{ platform: string; reason: string }>;
  /** The calendar's rhythm per platform, staff's setting applied. */
  rhythm: RhythmLine[];
  /** The rhythm's fallbacks: posts per week among the tracked competitors, and across every tracked company (null until read). */
  rates: { competitors: Record<string, number>; allTracked: Record<string, number> | null };
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A platform as a section key names it: lowercase letters and digits only. */
export function platformKey(name: string): string {
  return platformName(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The key of a platform's section. The state is part of it, so an edited launch plan stops showing once the platform is posting. */
export function platformSectionKey(name: string, state: "posting" | "new"): string {
  return `platform:${platformKey(name)}:${state}`;
}

/** The key of a pillar's section: the pillar's name as Client setup has it. */
export function pillarSectionKey(name: string): string {
  return `pillar:${String(name ?? "").trim()}`;
}

/** The last 90 days on one platform. Engagement measures leave out paid posts and posts younger than 48 hours. */
export function baselineOf(own: OwnPost[], platform: string, now: Date): Baseline {
  const t = now.getTime();
  const recent = own.filter((p) => {
    const at = Date.parse(p.publishedAt);
    return p.platform === platform && Number.isFinite(at) && at <= t && at >= t - OWN_DAYS * DAY;
  });
  const settled = recent.filter((p) => !p.boosted && Date.parse(p.publishedAt) <= t - SETTLE_HOURS * 3600_000);
  const mid = median(settled.map((p) => Number(p.engagement) || 0));
  const reach = settled.filter((p) => (p.impressions ?? 0) > 0);
  const impressions = reach.reduce((s, p) => s + (p.impressions as number), 0);
  return {
    posts: recent.length,
    posts_per_week: round2((recent.length * 7) / OWN_DAYS),
    median_engagement: mid === null ? null : Math.round(mid * 10) / 10,
    engagement_rate: impressions > 0 ? round4(reach.reduce((s, p) => s + (Number(p.engagement) || 0), 0) / impressions) : null,
  };
}

/**
 * Every platform in play for the client, posting first, then new (chosen
 * platforms, then accounts), then the profile's candidates. needsAllTracked:
 * a platform has no rate without every tracked company's, which was not read;
 * read it and ask again (the calendar's resolveRhythm works the same way).
 */
export function platformStates(i: PlatformInput): { platforms: StrategyPlatform[]; needsAllTracked: boolean } {
  const t = i.now.getTime();
  const posting: string[] = [];
  for (const p of i.own) {
    const at = Date.parse(p.publishedAt);
    const name = platformName(p.platform);
    if (name && Number.isFinite(at) && at <= t && at >= t - OWN_DAYS * DAY && !posting.includes(name)) posting.push(name);
  }
  // Most posts first.
  const count = (name: string) => i.own.filter((p) => platformName(p.platform) === name).length;
  posting.sort((a, b) => count(b) - count(a));

  const handles = new Map<string, string>();
  const accountPlatforms: string[] = [];
  for (const a of i.accounts) {
    const name = platformName(a.network_type);
    if (!name) continue;
    if (!accountPlatforms.includes(name)) accountPlatforms.push(name);
    const handle = String(a.native_name ?? "").trim();
    if (handle && !handles.has(name)) handles.set(name, handle);
  }
  const chosen = i.primarySet && Array.isArray(i.primary) ? i.primary.map((p) => platformName(String(p))).filter(Boolean) : [];
  const profile = new Map<string, string>();
  for (const p of i.profile) {
    const name = platformName(p.platform);
    if (name && !profile.has(name)) profile.set(name, String(p.reason ?? "").trim());
  }

  const order: Array<[string, PlatformState]> = [];
  const seen = new Set<string>();
  const add = (name: string, state: PlatformState) => {
    if (seen.has(name)) return;
    seen.add(name);
    order.push([name, state]);
  };
  for (const name of posting) add(name, "posting");
  for (const name of [...chosen, ...accountPlatforms]) add(name, "new");
  for (const name of profile.keys()) add(name, "candidate");

  let needsAllTracked = false;
  const cadenceOf = (name: string): Cadence | null => {
    const line = i.rhythm.find((l) => l.platform === name);
    if (line) return { per_week: line.source === "setting" ? line.perWeek : line.average, source: line.source };
    if ((i.rates.competitors[name] ?? 0) > 0) return { per_week: i.rates.competitors[name], source: "competitors" };
    if (i.rates.allTracked === null) {
      needsAllTracked = true;
      return null;
    }
    return (i.rates.allTracked[name] ?? 0) > 0 ? { per_week: i.rates.allTracked[name], source: "all_tracked" } : null;
  };

  const platforms = order.map(([name, state]): StrategyPlatform => ({
    platform: name,
    key: platformKey(name),
    state,
    handle: handles.get(name) ?? null,
    profile_reason: profile.get(name) || null,
    cadence: cadenceOf(name),
    baseline: state === "posting" ? baselineOf(i.own, name, i.now) : null,
  }));
  return { platforms, needsAllTracked };
}
