// supabase/functions/_shared/strategy/publicRead.ts
//
// The 90-day public read a strategy is written from (spec: docs/superpowers/
// specs/2026-11-03-strategy-v2-design.md, section 3), with Lital's answer of
// 3 Nov 2026: prospects, and any profile RivalIQ's record lacks, are read
// with the public-data tools the app already uses, never RivalIQ (its 40
// tracking slots are full and pinned). So:
//   * the client's and its competitors' posts that RivalIQ already tracks
//     come from the weekly feed the app stores (rivaliq_snapshots, endpoint
//     feed): no new RivalIQ call at all;
//   * a profile the feed does not cover, on a platform the app has a public
//     profile reader for, is read with that Apify actor: LinkedIn company
//     pages with harvestapi/linkedin-company-posts (the competitor feed's own
//     LinkedIn source), Instagram profiles with apify/instagram-profile-
//     scraper (the bio reader's actor; its answer carries the profile's 12
//     latest posts and its followers) and TikTok profiles with
//     apidojo/tiktok-scraper (the trends source, given the profile's link, as
//     its input schema documents). Facebook, YouTube and X have no profile
//     reader in the app, so a profile there that the feed does not cover has
//     no public posts;
//   * the client's posts on a platform Sprout covers are never read in
//     public: Sprout measures them.
// The read runs across lifecycle runs (start, then look again a few minutes
// later), never holds a run open, and is reused for 7 days while the same
// profiles are in play. A run that does not finish leaves its profiles with
// no public posts; the strategy is still written from everything else.

import { clientCompanyId, companyKey, isBoosted, isClientPost, median, OWN_DAYS, platformName } from "../calendar/evidence.ts";
import { LINKEDIN_ACTOR, LINKEDIN_MAX_POSTS, linkedInProfile } from "../pipelines/linkedin/sources.ts";
import { TREND_SOURCES } from "../trends/sources.ts";
import { INSTAGRAM_PROFILE_ACTOR } from "../apify/instagramProfile.ts";
import { isFinalRunStatus, type ApifyClient } from "../apify/client.ts";
import { textHash } from "../lifecycle/names.ts";
import { desiredProfiles, profileInputs, syncProfiles } from "./profiles.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

const DAY = 86_400_000;
export const READ_DAYS = OWN_DAYS;
export const REUSE_DAYS = 7;
/** Posts asked for per TikTok profile: about nine a week over 90 days, more than a brand posts. */
export const TIKTOK_MAX_PER_PROFILE = 120;
/** How long to wait before looking at the runs again. */
export const POLL_MINUTES = 3;
/** Runs that have not finished after this long are left out. */
const GIVE_UP_MS = 60 * 60_000;
const TEXT_CHARS = 400;

export interface PublicPost {
  company: string;
  client: boolean;
  /** Display name: Instagram, LinkedIn, TikTok. */
  platform: string;
  id: string;
  publishedAt: string;
  text: string;
  link: string | null;
  format: string;
  engagement: number;
  views: number | null;
  /** The profile's followers when the post was read, if the source shows them. */
  followers: number | null;
  boosted: boolean;
  source: "feed" | "apify";
  /** The most posts the read could bring back for the profile: a read that reached it covers less than 90 days. */
  capped?: number;
}

/** A profile the app has a public reader for and the feed does not cover. */
export interface Target {
  company: string;
  client: boolean;
  platform: string;
  url: string;
}

interface Reader {
  actor: { id: string; name: string; timeoutSecs?: number; memoryMbytes?: number };
  /** A profile link as the actor takes it, or "" when the handle cannot make one. */
  url(handle: string, url: string | null): string;
  /** The runs for these targets: LinkedIn takes every page in one run, TikTok one profile a run. */
  runs(targets: Target[], since: string): Array<{ targets: Target[]; input: Record<string, unknown> }>;
  /** A row of the answer as posts of one of the targets; none for a row that is not one. */
  normalize(row: Any, targets: Target[]): PublicPost[];
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const clipText = (s: string) => (s.length > TEXT_CHARS ? `${s.slice(0, TEXT_CHARS - 1)}…` : s);

/** The latest posts the Instagram profile actor answers with. */
export const INSTAGRAM_LATEST = 12;
const instagramHandle = (url: string) => (url.match(/instagram\.com\/([a-z0-9._]+)/i)?.[1] ?? "").toLowerCase();
const tiktokHandle = (url: string) => (url.match(/tiktok\.com\/@([a-z0-9._]+)/i)?.[1] ?? "").toLowerCase();

/** The public profile readers, one per platform: only actors the app already runs. */
export const PUBLIC_READERS: Record<string, Reader> = {
  LinkedIn: {
    actor: LINKEDIN_ACTOR,
    url: (handle, url) => linkedInProfile(url) || (/^[a-z0-9_-]+$/i.test(handle) ? linkedInProfile(`https://www.linkedin.com/company/${handle}`) : ""),
    runs: (targets, since) => targets.length ? [{
      targets,
      input: { targetUrls: targets.map((t) => t.url), maxPosts: LINKEDIN_MAX_POSTS, postedLimitDate: since, scrapeComments: false, scrapeReactions: false, includeReposts: false, includeQuotePosts: true },
    }] : [],
    normalize(row, targets) {
      if (!row || typeof row !== "object" || row.type !== "post") return [];
      const target = targets.find((t) => t.url === linkedInProfile(row.query?.targetUrl));
      if (!target) return [];
      // The competitor feed's checks: the page's own post (or a collaboration it shows), never a repost.
      const header = linkedInProfile(row.header?.imageLink) === target.url;
      if (header && /reposted this/i.test(row.header?.text || "")) return [];
      const collaboration = header && /collaborated on this/i.test(row.header?.text || "");
      if (linkedInProfile(row.author?.linkedinUrl) !== target.url && !collaboration) return [];
      const at = iso(row.postedAt?.date);
      const link = text(row.linkedinUrl);
      const counts = ["likes", "comments", "shares"].map((k) => num(row.engagement?.[k]));
      if (!at || !/^https:\/\/www\.linkedin\.com\//.test(link) || counts.some((n) => n === null)) return [];
      const image = row.postImages?.[0]?.url || row.document || row.postVideo || row.article;
      return [{
        company: target.company, client: target.client, platform: "LinkedIn", id: `linkedin:${text(row.id) || link}`, publishedAt: at,
        text: clipText(text(row.content)), link, format: row.document ? "carousel" : row.postVideo ? "video" : row.article ? "link" : image ? "image" : "text",
        engagement: (counts as number[]).reduce((s, n) => s + n, 0), views: null, followers: null, boosted: false, source: "apify", capped: LINKEDIN_MAX_POSTS,
      }];
    },
  },
  Instagram: {
    actor: INSTAGRAM_PROFILE_ACTOR,
    url: (handle, url) => {
      const h = (String(url ?? "").match(/instagram\.com\/([a-z0-9._]+)/i)?.[1] ?? String(handle ?? "")).replace(/^@/, "").toLowerCase();
      return /^[a-z0-9._]{1,30}$/.test(h) && !["p", "reel", "explore"].includes(h) ? `https://www.instagram.com/${h}/` : "";
    },
    runs: (targets) => targets.length ? [{ targets, input: { usernames: targets.map((t) => instagramHandle(t.url)) } }] : [],
    normalize(row, targets) {
      if (!row || typeof row !== "object") return [];
      const target = targets.find((t) => instagramHandle(t.url) === text(row.username).toLowerCase());
      if (!target) return [];
      const followers = num(row.followersCount);
      return (Array.isArray(row.latestPosts) ? row.latestPosts : []).flatMap((p: Any): PublicPost[] => {
        const at = iso(p?.timestamp);
        const link = text(p?.url) || (text(p?.shortCode) ? `https://www.instagram.com/p/${text(p.shortCode)}/` : "");
        if (!at || !/^https:\/\//.test(link)) return [];
        const kind = text(p?.type).toLowerCase();
        return [{
          company: target.company, client: target.client, platform: "Instagram", id: `instagram:${text(p?.id) || text(p?.shortCode) || link}`, publishedAt: at,
          text: clipText(text(p?.caption)), link, format: kind === "sidecar" ? "carousel" : kind === "video" ? "video" : "image",
          engagement: (num(p?.likesCount) ?? 0) + (num(p?.commentsCount) ?? 0), views: num(p?.videoViewCount), followers, boosted: false, source: "apify", capped: INSTAGRAM_LATEST,
        }];
      });
    },
  },
  TikTok: {
    actor: TREND_SOURCES.tiktok.actor,
    url: (handle, url) => {
      const h = tiktokHandle(url ?? "") || String(handle ?? "").replace(/^@/, "").toLowerCase();
      return /^[a-z0-9._]+$/.test(h) ? `https://www.tiktok.com/@${h}` : "";
    },
    runs: (targets) => targets.map((t) => ({ targets: [t], input: { startUrls: [t.url], maxItems: TIKTOK_MAX_PER_PROFILE } })),
    normalize(row, targets) {
      if (!row || typeof row !== "object") return [];
      const handle = (text(row.channel?.username) || text(row.authorMeta?.name)).toLowerCase();
      const target = targets.find((t) => tiktokHandle(t.url) === handle);
      const link = text(row.postPage) || text(row.webVideoUrl);
      const at = iso(row.uploadedAtFormatted) ?? iso(row.createTimeISO) ?? iso(row.uploadedAt);
      if (!target || !at || !/^https:\/\//.test(link)) return [];
      const likes = num(row.likes ?? row.diggCount) ?? 0;
      const comments = num(row.comments ?? row.commentCount) ?? 0;
      const shares = num(row.shares ?? row.shareCount) ?? 0;
      return [{
        company: target.company, client: target.client, platform: "TikTok", id: `tiktok:${text(row.id) || link}`, publishedAt: at,
        text: clipText(text(row.title) || text(row.text)), link, format: "short_video", engagement: likes + comments + shares,
        views: num(row.views ?? row.playCount), followers: num(row.channel?.followers ?? row.authorMeta?.fans), boosted: false, source: "apify", capped: TIKTOK_MAX_PER_PROFILE,
      }];
    },
  },
};

/** The weekly feed's posts over the read's window, each once, with the client's own marked. */
export function feedPosts(snapshots: Array<{ payload: Any }>, clientName: string, since: string): PublicPost[] {
  const out = new Map<string, PublicPost>();
  for (const s of snapshots) {
    const clientCompany = clientCompanyId(s.payload, clientName);
    for (const p of (s.payload?.socialPosts ?? []) as Any[]) {
      const id = String(p?.postId || p?.nativeId || p?.postLink || "");
      const at = iso(p?.publishedAt);
      const platform = platformName(p?.channel);
      if (!id || !at || !platform || at.slice(0, 10) < since || out.has(id)) continue;
      const client = isClientPost(p, clientCompany, clientName);
      out.set(id, {
        company: client ? clientName : String(p?.companyName ?? ""), client, platform, id, publishedAt: at,
        text: clipText(String(p?.message ?? "")), link: p?.postLink ?? null, format: String(p?.type || "unknown"),
        engagement: Number(p?.engagementTotal) || 0, views: num(p?.tiktokViews ?? p?.youtubeViews ?? p?.views),
        followers: num(p?.presenceReach), boosted: isBoosted(p?.facebookLikelyBoosted), source: "feed",
      });
    }
  }
  return [...out.values()].filter((p) => p.company);
}

export interface Profile { company: string; client: boolean; platform: string; handle: string; url: string | null }

/**
 * The profiles to read with Apify: a reader exists for the platform, the
 * client's own profile is not on Sprout there, and the feed neither has posts
 * from the company there nor tracks its profile.
 */
export function planTargets(i: { profiles: Profile[]; feed: PublicPost[]; tracked: Set<string>; sprout: Set<string> }): Target[] {
  const covered = new Set([...i.tracked, ...i.feed.map((p) => `${companyKey(p.company)}|${p.platform}`)]);
  const out: Target[] = [];
  for (const p of i.profiles) {
    const platform = platformName(p.platform);
    const reader = PUBLIC_READERS[platform];
    if (!reader || (p.client && i.sprout.has(platform)) || covered.has(`${companyKey(p.company)}|${platform}`)) continue;
    const url = reader.url(p.handle, p.url);
    if (!url || out.some((t) => t.platform === platform && (t.url === url || companyKey(t.company) === companyKey(p.company)))) continue;
    out.push({ company: p.company, client: p.client, platform, url });
  }
  return out;
}

/** The targets as one key: the read is reused while it is the same. */
export const targetsKey = (targets: Target[]) => textHash(targets.map((t) => `${t.platform}:${t.url}:${t.client ? "c" : ""}`).sort().join("|"));

/** A read under way or done (content_strategies.public_read). */
export interface PublicReadState {
  key: string;
  status: "reading" | "done";
  started_at: string;
  read_at?: string;
  window: { start: string; end: string };
  runs: Array<{ platform: string; run_id: string; targets: Target[]; status?: string; usd?: number | null }>;
  /** The posts the Apify runs brought back. */
  posts: PublicPost[];
  /** Why no actor ran, for developers ("no_token"). */
  skipped?: string;
}

export interface CompanyFigures {
  company: string;
  client: boolean;
  platform: string;
  posts: number;
  posts_per_week: number;
  median_engagement: number | null;
  /** Engagement per view, over posts that show views (TikTok, YouTube); null otherwise. */
  rate_per_view: number | null;
  followers: number | null;
}

/** Posts a week, median engagement, rate per view and the newest follower count per company and platform. Paid posts and posts under 48 hours old are left out of engagement. */
export function figures(posts: PublicPost[], now: Date, days = READ_DAYS): CompanyFigures[] {
  const t = now.getTime();
  const groups = new Map<string, PublicPost[]>();
  for (const p of posts) {
    const at = Date.parse(p.publishedAt);
    if (!Number.isFinite(at) || at > t || at < t - days * DAY) continue;
    const key = `${p.client ? "\u0000client" : companyKey(p.company)}|${p.platform}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return [...groups.values()].map((g) => {
    // A read that reached its cap covers less than the 90 days: its pace is over the days it covers, at least a week.
    const cap = g.find((p) => p.capped)?.capped;
    const oldest = Math.min(...g.map((p) => Date.parse(p.publishedAt)));
    const span = cap && g.length >= cap ? Math.min(days, Math.max(7, (t - oldest) / DAY)) : days;
    const settled = g.filter((p) => !p.boosted && Date.parse(p.publishedAt) <= t - 48 * 3_600_000);
    const mid = median(settled.map((p) => p.engagement));
    const viewed = settled.filter((p) => (p.views ?? 0) > 0);
    const views = viewed.reduce((s, p) => s + (p.views as number), 0);
    const newest = [...g].filter((p) => p.followers !== null).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
    return {
      company: g[0].company, client: g[0].client, platform: g[0].platform, posts: g.length, posts_per_week: round((g.length * 7) / span, 2),
      median_engagement: mid === null ? null : round(mid, 1),
      rate_per_view: views > 0 && ["TikTok", "YouTube"].includes(g[0].platform) ? round(viewed.reduce((s, p) => s + p.engagement, 0) / views, 4) : null,
      followers: newest ? newest.followers : null,
    };
  });
}

export type ApifyFactory = () => ApifyClient | null;

/** One step of the read: start the runs, or look at them; done when every run has ended or the read needs none. */
export async function stepRead(state: PublicReadState | null, targets: Target[], apify: ApifyFactory, now: Date): Promise<PublicReadState> {
  const key = targetsKey(targets);
  const window = { start: new Date(now.getTime() - READ_DAYS * DAY).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  const fresh = (s: PublicReadState) => s.status === "done" && !!s.read_at && now.getTime() - Date.parse(s.read_at) < REUSE_DAYS * DAY;
  if (state && state.key === key && (fresh(state) || state.status === "reading")) {
    if (state.status === "done") return state;
    return await look(state, apify, now);
  }
  const base: PublicReadState = { key, status: "done", started_at: now.toISOString(), read_at: now.toISOString(), window, runs: [], posts: [] };
  if (!targets.length) return base;
  const client = apify();
  if (!client) return { ...base, skipped: "no_token" };
  const runs: PublicReadState["runs"] = [];
  for (const [platform, reader] of Object.entries(PUBLIC_READERS)) {
    for (const r of reader.runs(targets.filter((t) => t.platform === platform), window.start)) {
      try {
        const run = await client.startRun(reader.actor.id, r.input, { timeoutSecs: reader.actor.timeoutSecs, memoryMbytes: reader.actor.memoryMbytes });
        runs.push({ platform, run_id: run.id, targets: r.targets, status: run.status });
      } catch (e) {
        console.warn("[strategy] public read not started", platform, e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (!runs.length) return base;
  return { key, status: "reading", started_at: now.toISOString(), window, runs, posts: [] };
}

async function look(state: PublicReadState, apify: ApifyFactory, now: Date): Promise<PublicReadState> {
  const client = apify();
  const late = now.getTime() - Date.parse(state.started_at) > GIVE_UP_MS;
  if (!client) return { ...state, status: "done", read_at: now.toISOString(), skipped: "no_token" };
  const runs = [];
  const posts: PublicPost[] = [];
  let waiting = false;
  for (const r of state.runs) {
    if (r.status && isFinalRunStatus(r.status)) { runs.push(r); continue; }
    try {
      const run = await client.getRun(r.run_id);
      if (!isFinalRunStatus(run.status) && !late) { waiting = true; runs.push({ ...r, status: run.status }); continue; }
      runs.push({ ...r, status: run.status, usd: num(run.usageTotalUsd) });
      if (run.status !== "SUCCEEDED") continue;
      const reader = PUBLIC_READERS[r.platform];
      const rows = await client.datasetItems(run.defaultDatasetId, { maxItems: 5000 });
      for (const row of rows) {
        for (const p of reader?.normalize(row, r.targets) ?? []) {
          if (p.publishedAt.slice(0, 10) >= state.window.start && !posts.some((x) => x.id === p.id)) posts.push(p);
        }
      }
    } catch (e) {
      console.warn("[strategy] public read not looked at", r.platform, e instanceof Error ? e.message : String(e));
      if (late) runs.push({ ...r, status: "FAILED" });
      else { waiting = true; runs.push(r); }
    }
  }
  if (waiting) return { ...state, runs };
  return { ...state, status: "done", read_at: now.toISOString(), runs, posts: [...state.posts, ...posts] };
}

// ── What the read is made from, in the database ────────────────────────────

/** The client's and its competitors' profiles, and what RivalIQ's records track, as the read needs them. */
export async function readInputs(db: Db, client: Any, trackingResult: Any): Promise<{ profiles: Profile[]; tracked: Set<string>; sprout: Set<string> }> {
  const name = String(client.name ?? "");
  const [own, accounts, set] = await Promise.all([
    db.from("client_public_profiles").select("platform, handle, url, source").eq("client_id", client.id),
    db.from("sprout_profiles").select("network_type").eq("client_id", client.id).eq("is_active", true),
    db.from("competitor_sets").select("id").eq("client_id", client.id).in("status", ["confirmed", "analyzing", "complete", "failed"])
      .order("confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (own.error) throw new Error(`Could not read the client's public profiles: ${own.error.message}`);
  if (accounts.error) throw new Error(`Could not read the client's social accounts: ${accounts.error.message}`);
  if (set.error) throw new Error(`Could not read the competitor set: ${set.error.message}`);
  const profiles: Profile[] = (own.data ?? []).filter((r: Any) => r.source !== "removed")
    .map((r: Any) => ({ company: name, client: true, platform: String(r.platform), handle: String(r.handle), url: r.url ?? null }));
  const tracked = new Set<string>();
  for (const h of (trackingResult?.client_company?.handles ?? []) as Any[]) tracked.add(`${companyKey(name)}|${platformName(h.platform)}`);
  if (set.data?.id) {
    const { data: comps, error } = await db.from("competitors").select("id, name").eq("set_id", set.data.id).eq("is_selected", true);
    if (error) throw new Error(`Could not read the competitors: ${error.message}`);
    const ids = (comps ?? []).map((c: Any) => c.id);
    const { data: handles, error: handlesError } = ids.length
      ? await db.from("competitor_handles").select("competitor_id, platform, handle, profile_url, is_active, source").in("competitor_id", ids)
      : { data: [], error: null };
    if (handlesError) throw new Error(`Could not read the competitors' profiles: ${handlesError.message}`);
    for (const h of (handles ?? []) as Any[]) {
      const company = String((comps ?? []).find((c: Any) => c.id === h.competitor_id)?.name ?? "");
      if (!company || h.is_active === false || h.source === "rejected") continue;
      if (h.source === "rivaliq") tracked.add(`${companyKey(company)}|${platformName(h.platform)}`);
      profiles.push({ company, client: false, platform: String(h.platform), handle: String(h.handle ?? ""), url: h.profile_url ?? null });
    }
  }
  const sprout = new Set<string>((accounts.data ?? []).map((a: Any) => platformName(a.network_type)).filter(Boolean));
  return { profiles, tracked, sprout };
}

/**
 * One lifecycle run's share of the read: keep the client's public profiles
 * filled from data (profiles.ts), work out what Apify must read, and start
 * or look at those runs. The state is kept on the client's strategy row.
 */
export async function advancePublicRead(
  db: Db, client: { id: string; name: string }, results: { tracking?: Record<string, unknown> | null; brand_read?: Record<string, unknown> | null },
  now: Date, io: { apify: ApifyFactory; feedSnapshots(db: Db, clientId: string): Promise<Array<{ payload: Any }>> },
): Promise<PublicReadState> {
  const pi = await profileInputs(db, client, results);
  await syncProfiles(db, client.id, pi.rows, desiredProfiles(pi), now);
  const inputs = await readInputs(db, client, results.tracking ?? null);
  const since = new Date(now.getTime() - READ_DAYS * DAY).toISOString().slice(0, 10);
  const feed = feedPosts(await io.feedSnapshots(db, client.id), String(client.name ?? ""), since);
  const targets = planTargets({ profiles: inputs.profiles, feed, tracked: inputs.tracked, sprout: inputs.sprout });
  const { data, error } = await db.from("content_strategies").select("public_read").eq("client_id", client.id).maybeSingle();
  if (error) throw new Error(`Could not read the public read under way: ${error.message}`);
  const before = (data?.public_read ?? null) as PublicReadState | null;
  const state = await stepRead(before, targets, io.apify, now);
  if (state !== before) {
    const { error: saveError } = await db.from("content_strategies").upsert({
      client_id: client.id, public_read: state, ...(state.status === "done" ? { public_read_at: state.read_at } : {}), updated_at: now.toISOString(),
    }, { onConflict: "client_id" });
    if (saveError) throw new Error(`Could not keep the public read: ${saveError.message}`);
  }
  return state;
}
