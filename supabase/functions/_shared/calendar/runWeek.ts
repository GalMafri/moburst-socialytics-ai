// supabase/functions/_shared/calendar/runWeek.ts
//
// The weekly calendar's jobs (Lital, 19 Oct 2026), run by run-scheduled-jobs:
//   week_plan      write one week's plan, once, from the freshest evidence
//   week_revise    rewrite a week's posts nobody worked on, from a note; or,
//                  asked by the app itself (scope "replan", replan.ts), write
//                  again from fresh evidence the ones written from an outside
//                  post, with time codes or before the client's accounts changed
//   voice_profile  learn how the client writes from its published posts, and
//                  have the client's lifecycle look at the upcoming calendar
// A week's plan waits for its dated moments (week_moments, runMoments.ts),
// as it waits for the voice profile, and cites them as evidence M1, M2. It
// also waits while the client's weekly trend collection is under way, so it
// reads the newest trends (trendsPending).
// Each job is one bounded model call. A plan that already has posts (a run
// cut off after writing them) is finished rather than written twice. Every
// active client can be planned: the posting rhythm always resolves
// (evidence.ts resolveRhythm), so no plan waits for a setting. Nothing ends
// in failure while its week can still be used: a plan or revision that
// doesn't finish is tried again with growing waits (retryWait), and a week
// that is over closes quietly. A plan a person stopped or removed
// (calendar_stop_plan, status canceled) gets no model call after the run
// sees it and nothing written: the run checks before each model call and
// before writing, every write to the plan leaves a stopped plan as it is,
// and the database takes no posts for it (calendar_posts_plan_open).
// Every post a plan or a revision writes is checked before it is saved
// (copyChecks.ts, copy sources 17 Nov 2026): one that borrows from an outside
// post, carries time codes or points to something that is not the client's
// is refused, the planner is asked once more for it (never more than two
// calls a run), and what is refused twice is listed on the plan.

import { anthropicMessages } from "../anthropic.ts";
import { collectOwnedCompetitive } from "../competitive/ownedSource.ts";
import { competitiveBrief } from "../competitive/brief.ts";
import {
  bestExamples, clientCompanyId, compactFeedRow, competitorPosts, feedHistories, isBoosted, isClientPost, latestTrendEvidence, medianRates, numberEvidence, platformName,
  outsideSources, resolveRhythm, scoreCompetitorPosts, scoreOwnPosts, scoreTrendItems, storyRhythm, MIN_COMPETITOR_WEEKS, OWN_DAYS,
  type CompetitorPost, type EvidenceItem, type FeedRow, type OutsideSource, type OwnPost, type RhythmLine, type RhythmSources,
} from "./evidence.ts";
import { parseRevision, parseWeekPlan, reasonForPlanner, revisePrompt, storyPlan, weekPrompt, withStories, type DroppedPost, type Reason, type RevisePost } from "./weekPlan.ts";
import { COPY_RULE, foreignHandles, foreignLinks, outsideFromReasons, type CopyCheck, type OwnFacts, type RefusedPost } from "./copyChecks.ts";
import { replanWhy } from "./replan.ts";
import { momentEvidence, type JudgedMoment } from "./moments.ts";
import { isStoryPost } from "../design/story.ts";
import { activePreferences, buildVoiceProfile, consolidateMemory, COPY_MODEL, learnFromSignal, loadClientVoice } from "../voice/load.ts";
import { voicePromptBlock, voiceReady, type ClientVoice } from "../voice/voice.ts";
import { notesSectionLines } from "../notes/notes.ts";
import { activeTerms } from "../trends/profile.ts";
import { HASHTAG_PLATFORMS, type HashtagPlatform } from "../trends/types.ts";
import { strategyPromptBlock } from "../strategy/prompt.ts";
import { readShownInsights, shownSocial } from "../reports/shownFields.ts";
import { plainNames, storedNames, type ListedName } from "../text/displayName.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface WeekJob {
  id: string;
  kind: string;
  client_id: string;
  occurrence: string | null;
  attempts: number;
  max_attempts: number;
  /** What a job runs on, for the moments' jobs ({ country }, { removal_id }). */
  payload?: Record<string, unknown> | null;
  priority?: number;
  /** When the job was queued (scheduled_jobs.created_at). */
  created_at?: string | null;
}

export interface WeekJobOutcome {
  status: "done" | "queued" | "skipped" | "failed";
  reason?: string | null;
  result?: Record<string, unknown> | null;
  available_at?: string;
  /** A wait for another job, which does not count as an attempt. */
  deferred?: boolean;
}

const RETRY_MINUTES = 10;
const DAY = 86400_000;

export const CLIENT_COLUMNS = "id, name, brand_identity, content_pillars, geo, language, timezone, primary_platforms, posting_rhythm, sprout_customer_id, website_url";

function apiKey(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return key;
}

function todayIn(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const list = (s: unknown) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const usage = (raw: unknown) => {
  const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
  return { input: Number(u?.input_tokens) || 0, output: Number(u?.output_tokens) || 0 };
};

// ── Evidence ────────────────────────────────────────────────────────────────

export interface Gathered {
  own: OwnPost[];
  /** Each platform's resolved rate and where it came from, before staff's setting. */
  learnedRhythm: RhythmLine[];
  /** The rhythm the week follows: staff's setting applied, platforms with no post this week left out. */
  rhythm: RhythmLine[];
  rhythmSources: RhythmSources;
  evidence: EvidenceItem[];
  avoid: string[];
  thin: string[];
  examples: ReturnType<typeof bestExamples>;
  /** The hashtags the client's trend profile keeps for each platform, for the planner to suggest. */
  hashtags: Record<HashtagPlatform, string[]>;
  /**
   * The rhythm's fallbacks, for a platform the client does not post on (the
   * content strategy's new platforms): posts per week among its tracked
   * competitors, and across every tracked company when the rhythm read them
   * (null otherwise; trackedRates reads them).
   */
  fallbackRates: { competitors: Record<string, number>; allTracked: Record<string, number> | null };
  /** trends: "themes" when the newest finished Trends week gave evidence, else "none". */
  sources: { sprout: string; feed_weeks: number; report: string | null; topics: number; trends: "themes" | "none" };
  /** The client's own Instagram Stories over 90 days, and the Stories this week gets (storyRhythm). */
  stories: { stories: number; average: number; perWeek: number };
  /** The whole captions of the outside posts in the evidence, for the copy check only: never stored with the plan, never in a prompt, never sent to a screen. */
  outside: OutsideSource[];
}

/**
 * What the calendar reads of the client's accounts: the decorated display
 * names its Sprout account lists (the accounts step's result,
 * lifecycle/steps.ts), written plainly wherever copy is learned or written
 * (text/displayName.ts); and when the one-account-per-network rule last
 * parked one of its own accounts, read from the parked rows themselves
 * (sprout_profiles.parked_at), so it does not depend on the step's result
 * standing. Each read that fails changes nothing: no names, or no date, and a
 * warning in the log.
 */
export async function accountsFacts(admin: Db, clientId: string): Promise<{ names: ListedName[]; ownDroppedAt: string | null }> {
  const warn = (e: unknown) => console.warn("[calendar] the client's account facts could not be read:", e instanceof Error ? e.message : String(e));
  let names: ListedName[] = [];
  let ownDroppedAt: string | null = null;
  try {
    const { data, error } = await admin.from("client_lifecycle_steps").select("result").eq("client_id", clientId).eq("step", "accounts").maybeSingle();
    if (error) throw new Error(error.message);
    const result = (data?.result ?? null) as { display_names?: unknown } | null;
    names = storedNames(result?.display_names);
  } catch (e) {
    warn(e);
  }
  try {
    // Parked now: switched off, with the record on the row. A row a person added back is active and is not one of them.
    const { data, error } = await admin.from("sprout_profiles").select("parked_at").eq("client_id", clientId).eq("is_active", false).not("parked_at", "is", null);
    if (error) throw new Error(error.message);
    const times = ((data ?? []) as Array<{ parked_at?: unknown }>)
      .map((r) => r.parked_at).filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)))
      .sort((x, y) => Date.parse(x) - Date.parse(y));
    ownDroppedAt = times.length ? times[times.length - 1] : null;
  } catch (e) {
    warn(e);
  }
  return { names, ownDroppedAt };
}

/**
 * The client's own posts for the last 90 days: Sprout where profiles are
 * assigned, RivalIQ's copy for other platforms. With them, when its Instagram
 * Stories went out (Sprout only), for the week's Story suggestions. A display
 * name the client's Sprout account lists with decorations is written plainly
 * in every post's text (`names` are those names), so nothing that learns from
 * the posts learns a star rating or a tagline as the client's own wording.
 */
export async function ownPosts(admin: Db, client: Record<string, unknown>, snapshots: Array<{ payload: any }>, now: Date): Promise<{ posts: OwnPost[]; sprout: string; stories: string[]; names: ListedName[] }> {
  const { names } = await accountsFacts(admin, String(client.id ?? ""));
  const end = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - OWN_DAYS * DAY).toISOString().slice(0, 10);
  let posts: OwnPost[] = [];
  let stories: string[] = [];
  let sprout = "not_connected";
  const covered = new Set<string>();
  try {
    const owned = await collectOwnedCompetitive(admin, client, { start, end }, { fields: ["is_boosted"], stories: true });
    sprout = owned.coverage;
    stories = ((owned as { stories?: Array<{ publishedAt: string }> }).stories ?? []).map((s) => String(s.publishedAt));
    for (const p of owned.profiles ?? []) covered.add(platformName(p.network));
    posts = (owned.posts ?? []).map((p: any) => ({
      id: String(p.postId), platform: platformName(p.channel), format: String(p.type || "unknown"), publishedAt: String(p.publishedAt),
      text: plainNames(String(p.message || ""), names), link: p.postLink ?? null, impressions: p.ownedImpressions ?? null, engagement: Number(p.engagementTotal) || 0,
      boosted: p.boosted === true,
    }));
  } catch (e) {
    sprout = "failed";
    console.warn("[calendar] Sprout posts could not be read:", e instanceof Error ? e.message : String(e));
  }
  // Platforms Sprout doesn't cover for this client, from the weekly feed.
  const seen = new Set(posts.map((p) => p.id));
  for (const s of snapshots) {
    const clientCompany = clientCompanyId(s.payload, String(client.name ?? ""));
    for (const p of (s.payload?.socialPosts ?? []) as any[]) {
      if (!isClientPost(p, clientCompany, String(client.name ?? ""))) continue;
      const platform = platformName(p.channel);
      const id = String(p.postId || p.nativeId || p.postLink || "");
      if (!id || covered.has(platform) || seen.has(id)) continue;
      seen.add(id);
      posts.push({ id, platform, format: String(p.type || "unknown"), publishedAt: String(p.publishedAt), text: plainNames(String(p.message || ""), names), link: p.postLink ?? null, impressions: null, engagement: Number(p.engagementTotal) || 0, boosted: isBoosted(p.facebookLikelyBoosted) });
    }
  }
  return { posts, sprout, stories, names };
}

/** The client's weekly competitor feeds, newest first (14 weeks covers the 90 days of own posts). */
export async function feedSnapshots(admin: Db, clientId: string): Promise<Array<{ payload: any }>> {
  const { data, error } = await admin.from("rivaliq_snapshots").select("payload, fetched_at")
    .eq("client_id", clientId).eq("endpoint", "feed").order("fetched_at", { ascending: false }).limit(14);
  if (error) throw new Error(`Could not read the competitor feed: ${error.message}`);
  return (data ?? []).filter((s: any) => Array.isArray(s.payload?.socialPosts));
}

/** Feed snapshots a page at a time, each reduced at once to what posting rates need: a snapshot carries every post's full text. */
const FEED_PAGE = 8;

async function feedRows(admin: Db, clientId?: string): Promise<FeedRow[]> {
  const rows: FeedRow[] = [];
  for (let from = 0; ; from += FEED_PAGE) {
    let query = admin.from("rivaliq_snapshots")
      .select("id, client_id, fetched_at, feed_window:payload->window, client_company_id:payload->>client_company_id, posts:payload->socialPosts")
      .eq("endpoint", "feed");
    if (clientId) query = query.eq("client_id", clientId);
    const { data, error } = await query.order("fetched_at", { ascending: true }).order("id", { ascending: true }).range(from, from + FEED_PAGE - 1);
    if (error) throw new Error(`Could not read the competitor feeds: ${error.message}`);
    for (const row of data ?? []) rows.push(compactFeedRow(row));
    if ((data ?? []).length < FEED_PAGE) return rows;
  }
}

/** The companies in the client's current competitor set (the newest confirmed one), as the feed knows them. */
export async function competitorSet(admin: Db, clientId: string): Promise<Array<{ name: string; rivaliq_company_id: string | null }>> {
  const { data: set, error } = await admin.from("competitor_sets").select("id").eq("client_id", clientId)
    .in("status", ["confirmed", "analyzing", "complete", "failed"])
    .order("confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the competitor set: ${error.message}`);
  if (!set) return [];
  const { data, error: listError } = await admin.from("competitors").select("name, rivaliq_company_id").eq("set_id", set.id).eq("is_selected", true);
  if (listError) throw new Error(`Could not read the competitors: ${listError.message}`);
  return (data ?? []) as Array<{ name: string; rivaliq_company_id: string | null }>;
}

/**
 * The median posts per week on each platform across every company the app
 * tracks (every client's feeds, clients and competitors alike). Read only
 * when a client's own posting and its competitors leave a platform without a
 * rate, and once per run.
 */
export async function trackedRates(admin: Db): Promise<Record<string, number>> {
  const histories = feedHistories(await feedRows(admin));
  return medianRates([...histories.values()]);
}

/** The most hashtags the planner is shown for one platform. */
const HASHTAGS_PER_PLATFORM = 10;

/**
 * The hashtags the client's trend profile keeps (the ones nobody removed) for
 * each platform: the team's own first, then the rest as the profile lists
 * them, at most ten. Empty lists for a client with no profile.
 */
export async function profileHashtags(admin: Db, clientId: string): Promise<Record<HashtagPlatform, string[]>> {
  const { hashtags } = await activeTerms(admin, clientId);
  const out = { instagram: [], tiktok: [], linkedin: [] } as Record<HashtagPlatform, string[]>;
  for (const platform of HASHTAG_PLATFORMS) {
    const terms = hashtags[platform];
    out[platform] = [...terms.filter((t) => t.source === "person"), ...terms.filter((t) => t.source !== "person")].map((t) => t.term).slice(0, HASHTAGS_PER_PLATFORM);
  }
  return out;
}

/** Monday of the week after the one a day falls in. */
const nextMonday = (day: string) => addDays(day, 7 - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * The evidence a week is planned from and the rhythm it follows. week is the
 * Monday being planned (the fractional rhythm depends on it); by default the
 * week after this one.
 */
export async function gatherEvidence(admin: Db, client: Record<string, any>, now: Date, opts: { week?: string } = {}): Promise<Gathered> {
  const tz = String(client.timezone || "UTC");
  const week = opts.week ?? nextMonday(todayIn(tz, now));
  const snapshots = await feedSnapshots(admin, client.id);
  const { posts: own, sprout, stories } = await ownPosts(admin, client, snapshots, now);

  // Competitors: the newest feed week against the four before it.
  const recent = snapshots.slice(0, 1 + MIN_COMPETITOR_WEEKS);
  const newestStart = String(recent[0]?.payload?.window?.start ?? "");
  const byId = new Map<string, CompetitorPost>();
  for (const s of [...recent].reverse()) {
    const clientCompany = clientCompanyId(s.payload, String(client.name ?? ""));
    for (const p of s.payload.socialPosts as any[]) {
      if (isClientPost(p, clientCompany, String(client.name ?? ""))) continue;
      const id = String(p.postId || p.nativeId || p.postLink || "");
      if (!id || !p.companyName) continue;
      byId.set(id, {
        id, company: String(p.companyName), platform: platformName(p.channel), format: String(p.type || "unknown"), publishedAt: String(p.publishedAt),
        text: String(p.message || ""), link: p.postLink ?? null, engagement: Number(p.engagementTotal) || 0,
        followers: Number(p.presenceReach) > 0 ? Number(p.presenceReach) : null, boosted: isBoosted(p.facebookLikelyBoosted),
      });
    }
  }
  const competitors = newestStart ? scoreCompetitorPosts([...byId.values()], newestStart, recent.length) : [];

  // The one definition of open topics, shared with the dashboard and the feed
  // page: the newest feed window's topics that nobody dismissed, best first
  // (open_competitor_topics, migration 20261019210000_shared_layers.sql).
  const { data: openTopics, error: topicsError } = await admin.rpc("open_competitor_topics", { p_client_id: client.id });
  if (topicsError) throw new Error(`Could not read the competitor topics: ${topicsError.message}`);
  const alerts = (Array.isArray(openTopics) ? openTopics : []).slice(0, 8)
    // deno-lint-ignore no-explicit-any
    .map((t: any) => ({ topic: t.topic, summary: t.summary, companies: t.companies, post_urls: t.post_urls, confidence: t.confidence }));

  const { data: report, error: reportError } = await admin.from("reports").select("id, created_at, report_data").eq("client_id", client.id).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (reportError) throw new Error(`Could not read the latest report: ${reportError.message}`);
  const rd = Array.isArray(report?.report_data) ? report.report_data[0] : report?.report_data;
  // Read as every reader reads it (shownFields.ts): the report's insights where it has them, its own
  // fields otherwise, field by field, so the competitive takeaways the insights don't carry stay.
  const shown = shownSocial(rd?.ai_analysis, await readShownInsights(admin, "reports", report?.id));
  const findings = [...shown.insights.map((i) => i.text), ...shown.recommendations.map((r) => r.text), ...shown.takeaways];

  // Industry trends come from the newest finished weekly Trends run (its themes staff did not dismiss), not from the report.
  const trendInputs = await latestTrendEvidence(admin, client.id, now);
  const trends = scoreTrendItems(trendInputs);

  const hashtags = await profileHashtags(admin, client.id);

  const scored = scoreOwnPosts(own, now);
  const evidence = numberEvidence({ ownTop: scored.top, competitors, topics: alerts ?? [], trends, findings });
  const [history, set] = await Promise.all([feedRows(admin, client.id), competitorSet(admin, client.id)]);
  const rhythmInput = {
    own, primaryPlatforms: client.primary_platforms, setting: client.posting_rhythm, monday: week, now, timeZone: tz,
    competitors: competitorPosts(feedHistories(history, { [client.id]: String(client.name ?? "") }).get(client.id), set),
    allTracked: null as Record<string, number> | null,
  };
  let resolved = resolveRhythm(rhythmInput);
  if (resolved.needsAllTracked) {
    rhythmInput.allTracked = await trackedRates(admin);
    resolved = resolveRhythm(rhythmInput);
  }
  const thin = [
    ...Object.entries(scored.platforms).filter(([, v]) => v.thin).map(([k, v]) => `${k}: ${v.posts} post${v.posts === 1 ? "" : "s"} in the last 90 days, so its numbers are an early signal.`),
    ...(recent.length && recent.length < 1 + MIN_COMPETITOR_WEEKS ? [`Competitor history: ${recent.length} week${recent.length === 1 ? "" : "s"} so far, so competitor numbers are an early signal.`] : []),
  ];
  const fmt = (s: typeof scored.low[number]) => `${s.post.platform} ${s.post.format} from ${s.post.publishedAt.slice(0, 10)} got ${s.multiple}x the usual ${s.metric}: ${s.post.text.replace(/\s+/g, " ").slice(0, 140)}`;
  return {
    own, learnedRhythm: resolved.learned, rhythm: resolved.applied, rhythmSources: resolved.sources, evidence, avoid: scored.low.map(fmt), thin,
    examples: bestExamples(scored.top), hashtags,
    fallbackRates: { competitors: medianRates([rhythmInput.competitors]), allTracked: rhythmInput.allTracked },
    sources: { sprout, feed_weeks: recent.length, report: report?.id ?? null, topics: (alerts ?? []).length, trends: trends.length ? "themes" : "none" },
    stories: storyRhythm(stories, now, week),
    outside: outsideSources(evidence, trendInputs, competitors),
  };
}

// ── What is the client's own, for the copy checks ───────────────────────────

/**
 * The client's own handles: its active Sprout profiles' and its public
 * profiles', lowercase, without "@". Each read that fails gives none and a
 * warning; the handle check is then stricter, never looser.
 */
async function ownHandles(admin: Db, clientId: string): Promise<string[]> {
  const read = async (table: string, column: string, filter: (q: Db) => Db): Promise<string[]> => {
    try {
      const { data, error } = await filter(admin.from(table).select(column).eq("client_id", clientId));
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => String(r[column] ?? ""));
    } catch (e) {
      console.warn(`[calendar] the client's handles could not be read from ${table}:`, e instanceof Error ? e.message : String(e));
      return [];
    }
  };
  const [sprout, shown] = await Promise.all([
    read("sprout_profiles", "native_name", (q) => q.eq("is_active", true)),
    read("client_public_profiles", "handle", (q) => q.neq("source", "removed")),
  ]);
  return [...new Set([...sprout, ...shown].map((h) => h.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
}

/**
 * What the copy checks count as the client's own (copyChecks.ts): its
 * website's host, its handles, and its own words: its name, its posts of the
 * last 90 days (where the run read them) and its notes in use. `material`
 * names the other parts of the client's own material the prompt holds, which
 * a post may point its reader to (weekPlan.ts assetRule): its pillars and its
 * content strategy where it has them, and the voice section, always.
 */
function ownFacts(client: Record<string, unknown>, gathered: Gathered | null, voice: ClientVoice, profiles: { handles: string[] }, has: { pillars: boolean; strategy: boolean }): OwnFacts {
  let host = "";
  try {
    const raw = String(client.website_url ?? "").trim();
    host = raw ? new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const notes = voice.notes ? notesSectionLines(voice.notes) : [];
  return {
    hosts: host ? [host] : [],
    handles: profiles.handles,
    text: [String(client.name ?? ""), ...(gathered?.own ?? []).map((p) => p.text), ...notes].join("\n").toLowerCase(),
    hasNotes: notes.length > 0,
    material: [...(has.pillars ? ["pillars"] : []), ...(has.strategy ? ["strategy"] : []), "voice"],
  };
}

// ── Plan a week ─────────────────────────────────────────────────────────────

/** Longer than the worker's 5-minute lease, so a run still going is never doubled. */
const CLAIM_MS = 6 * 60_000;

async function must(p: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
}

/**
 * One run at a time per week: a run claims the plan before it writes or
 * revises, and a claim older than CLAIM_MS belonged to a run that died. A
 * plan a person stopped is never claimed.
 */
async function claimPlan(admin: Db, planId: string, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - CLAIM_MS).toISOString();
  const { data, error } = await admin.from("calendar_plans").update({ claimed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", planId).neq("status", "canceled").or(`claimed_at.is.null,claimed_at.lt."${stale}"`).select("id");
  if (error) throw new Error(`Could not claim the week: ${error.message}`);
  return !!data?.length;
}

/** A person stopped the week's plan or removed it (calendar_stop_plan): nothing more is asked of the model or written for it. */
async function planStopped(admin: Db, planId: string): Promise<boolean> {
  const { data, error } = await admin.from("calendar_plans").select("status").eq("id", planId).maybeSingle();
  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  return !data || data.status === "canceled";
}

const STOPPED: WeekJobOutcome = { status: "skipped", reason: "A person stopped this week's plan." };

/** The client's voice profile is being learned: plans and revisions wait for it. */
async function voicePending(admin: Db, clientId: string): Promise<boolean> {
  const { count, error } = await admin.from("scheduled_jobs").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("kind", "voice_profile").in("status", ["queued", "running"]);
  if (error) throw new Error(`Could not check the voice profile: ${error.message}`);
  return !!count;
}

const waitForVoice = (now: Date): WeekJobOutcome => ({ status: "queued", reason: "Waiting for the client's voice profile.", available_at: new Date(now.getTime() + 60_000).toISOString(), deferred: true });

const waitForMoments = (now: Date): WeekJobOutcome => ({ status: "queued", reason: "Waiting for the week's dated moments.", available_at: new Date(now.getTime() + 60_000).toISOString(), deferred: true });

/**
 * The week's dated moments are judged before it is planned (week_moments,
 * runMoments.ts): queued here once per week, and waited for while queued or
 * running. A moments job that failed or was skipped before this planning job
 * was created (an earlier week's plan, a stopped plan, or a failure the code
 * has since outgrown) is put
 * back in the queue once and waited for. One that fails during this planning
 * job's own wait, or a queue that won't take the job, means the week is
 * planned with no moments rather than held, so nothing loops.
 */
async function momentsPending(admin: Db, job: WeekJob, plan: { moments?: unknown }, week: string, now: Date): Promise<boolean> {
  if (plan.moments) return false;
  const key = `week_moments:${job.client_id}:${week}`;
  const { data, error } = await admin.from("scheduled_jobs").select("dedupe_key, status, finished_at").eq("dedupe_key", key);
  if (error) {
    console.warn("[calendar] the week's moments were left out:", error.message);
    return false;
  }
  const row = (data ?? []).find((r: { dedupe_key?: string }) => r.dedupe_key === key);
  if (row) {
    if (row.status === "queued" || row.status === "running") return true;
    // QA 22 Nov 2026: a moments job skipped because a person stopped the plan
    // ("Stop planning", then "Plan next week") ended for a reason the re-plan
    // undid, so it is put back like a failed one; before, the week was planned
    // with no seasonal moments.
    const endedBefore = (row.status === "failed" || row.status === "skipped") && !!job.created_at && !!row.finished_at && Date.parse(row.finished_at) < Date.parse(job.created_at);
    if (!endedBefore) return false;
    const { error: requeueError } = await admin.from("scheduled_jobs")
      .update({ status: "queued", attempts: 0, available_at: now.toISOString(), lease_until: null, reason: null, finished_at: null })
      .eq("dedupe_key", key).in("status", ["failed", "skipped"]);
    if (requeueError) {
      console.warn("[calendar] the week's moments were left out:", requeueError.message);
      return false;
    }
    return true;
  }
  const { error: queueError } = await admin.from("scheduled_jobs").upsert({
    kind: "week_moments", client_id: job.client_id, occurrence: `${week}T00:00:00Z`, dedupe_key: key, priority: job.priority ?? 40, available_at: now.toISOString(),
  }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (queueError) {
    console.warn("[calendar] the week's moments were left out:", queueError.message);
    return false;
  }
  return true;
}

/** How long a plan waits for the client's trend collection, from when the collection began. */
const TREND_WAIT_MS = 2 * 60 * 60_000;

const waitForTrends = (now: Date): WeekJobOutcome => ({ status: "queued", reason: "Waiting for the client's trends.", available_at: new Date(now.getTime() + 60_000).toISOString(), deferred: true });

/**
 * A plan reads the client's newest finished Trends week (evidence.ts
 * latestTrendEvidence). The weekly collection is queued on the client's feed
 * weekday just before the plans (trend-refresh-enqueue at 07:10 UTC, the
 * plans at 07:15; 20261110230000_trends_before_plans.sql), so on that day a
 * plan waits while its collection is queued or running, for at most two
 * hours from when it began. After that, or once it ends either way, the plan
 * goes on with the newest finished week. A read that fails holds nothing.
 */
async function trendsPending(admin: Db, clientId: string, now: Date): Promise<boolean> {
  const since = now.getTime() - TREND_WAIT_MS;
  const recent = (r: { created_at?: string | null }) => !!r.created_at && Date.parse(r.created_at) > since;
  const sinceIso = new Date(since).toISOString();
  const [jobs, weeks] = await Promise.all([
    admin.from("scheduled_jobs").select("kind, status, created_at").eq("client_id", clientId).eq("kind", "trend_refresh").in("status", ["queued", "running"]).gte("created_at", sinceIso),
    admin.from("trend_weeks").select("status, created_at").eq("client_id", clientId).eq("status", "running").gte("created_at", sinceIso),
  ]);
  if (jobs.error || weeks.error) {
    console.warn("[calendar] the client's trend collection could not be checked:", (jobs.error ?? weeks.error)?.message);
    return false;
  }
  // deno-lint-ignore no-explicit-any
  const open = (jobs.data ?? []).some((r: any) => r.kind === "trend_refresh" && (r.status === "queued" || r.status === "running") && recent(r));
  // deno-lint-ignore no-explicit-any
  return open || (weeks.data ?? []).some((r: any) => r.status === "running" && recent(r));
}

/** The moments a plan kept (calendar_plans.moments), as the planner's evidence M1, M2. */
const planMoments = (plan: { moments?: { kept?: unknown } | null }) => momentEvidence(Array.isArray(plan.moments?.kept) ? plan.moments!.kept as JudgedMoment[] : []);

const busyElsewhere = (now: Date): WeekJobOutcome => ({ status: "queued", reason: "Another run is working on this week.", available_at: new Date(now.getTime() + 2 * 60_000).toISOString(), deferred: true });

/**
 * Waits before a week's plan or revision is tried again: 10 minutes, an
 * hour, six hours, then once a day. Nothing ends in failure while the week
 * can still be used; a week that is over closes quietly.
 */
const RETRY_WAITS_MINUTES = [10, 60, 360, 1440];

export function retryWait(attempts: number): number {
  return RETRY_WAITS_MINUTES[Math.min(Math.max(1, attempts), RETRY_WAITS_MINUTES.length) - 1] * 60_000;
}

const retryLater = (job: WeekJob, reason: string, now: Date): WeekJobOutcome =>
  ({ status: "queued", reason, available_at: new Date(now.getTime() + retryWait(job.attempts)).toISOString() });

/** A run that stopped without finishing (wall clock, memory) leaves its claim behind. */
const leftByStoppedRun = (plan: { claimed_at?: string | null }, now: Date) =>
  !!plan.claimed_at && Date.parse(plan.claimed_at) < now.getTime() - CLAIM_MS;

/** Release a claim a stopped run left, unless a new run took it meanwhile or a person stopped the plan. */
async function releaseStoppedRun(admin: Db, plan: { id: string; claimed_at: string }, patch: Record<string, unknown> = {}): Promise<void> {
  await admin.from("calendar_plans").update({ claimed_at: null, updated_at: new Date().toISOString(), ...patch }).eq("id", plan.id).neq("status", "canceled").eq("claimed_at", plan.claimed_at);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The client's content strategy for the planner's prompts. Like the
 * competitive picture, a strategy that cannot be read leaves the prompt as it
 * was without one, rather than holding the week.
 */
const clientStrategy = (admin: Db, clientId: string) => strategyPromptBlock(admin, clientId).catch((e: unknown) => {
  console.warn("[calendar] the content strategy was left out:", message(e));
  return "";
});

/** How far back an upload of filmed footage still says the client films. */
const FILMING_DAYS = 60;

/**
 * Whether the client films its own footage: it uploaded a clip for a post
 * (design-request's "footage" action) in the last 60 days. Without that, the
 * planner leaves out ideas that need someone on camera.
 */
async function clientCanFilm(admin: Db, clientId: string, now: Date): Promise<boolean> {
  const { count, error } = await admin.from("design_requests").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).not("footage_path", "is", null).gte("created_at", new Date(now.getTime() - FILMING_DAYS * DAY).toISOString());
  if (error) throw new Error(`Could not check the client's footage: ${error.message}`);
  return !!count;
}

export async function runWeekPlan(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const week = String(job.occurrence ?? "").slice(0, 10);
  let planId: string | null = null;
  let claimed = false;
  try {
    const { data: plan, error: planError } = await admin.from("calendar_plans").select("*").eq("client_id", job.client_id).eq("week_start", week).maybeSingle();
    if (planError) throw new Error(`Could not read the plan: ${planError.message}`);
    if (!plan) return { status: "skipped", reason: "The plan this job was for no longer exists." };
    if (plan.status === "canceled") return STOPPED;
    if (plan.status === "ready") return { status: "done", result: { plan_id: plan.id, already: true } };
    if (plan.status === "expired") return { status: "skipped", reason: "The week is over." };
    planId = plan.id;

    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const tz = String(client.timezone || "UTC");
    const tomorrow = addDays(todayIn(tz, now), 1);
    const firstDate = tomorrow > week ? tomorrow : week;
    // A week with no day left to post on closes quietly.
    if (firstDate > addDays(week, 6)) {
      await must(admin.from("calendar_plans").update({ status: "expired", claimed_at: null, updated_at: now.toISOString() }).eq("id", plan.id).neq("status", "canceled"), "Could not close the week");
      return { status: "skipped", reason: "The week is over." };
    }
    if (leftByStoppedRun(plan, now)) {
      await releaseStoppedRun(admin, plan, { status: "queued" });
      return retryLater(job, "The last run stopped before finishing.", now);
    }
    if (await voicePending(admin, job.client_id)) return waitForVoice(now);
    if (await momentsPending(admin, job, plan, week, now)) return waitForMoments(now);
    if (await trendsPending(admin, job.client_id, now)) return waitForTrends(now);
    if (!(await claimPlan(admin, plan.id, now))) return (await planStopped(admin, plan.id)) ? STOPPED : busyElsewhere(now);
    claimed = true;

    const writtenSoFar = async () => {
      const { count, error } = await admin.from("calendar_posts").select("id", { count: "exact", head: true }).eq("plan_id", plan.id);
      if (error) throw new Error(`Could not read the week's posts: ${error.message}`);
      return count ?? 0;
    };
    /** The plan made ready, unless a person stopped it meanwhile (false then). */
    const markReady = async (extra: Record<string, unknown> = {}) => {
      const { data, error } = await admin.from("calendar_plans")
        .update({ status: "ready", ready_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null, claimed_at: null, ...extra })
        .eq("id", plan.id).neq("status", "canceled").select("id");
      if (error) throw new Error(`Could not finish the plan: ${error.message}`);
      return !!data?.length;
    };

    // A run cut off after writing the posts: finish the plan, don't write them twice.
    // QA 22 Nov 2026: the plan keeps the copy rules its posts were checked under
    // (stored before the posts are written, below). A plan written before that
    // was stored is stamped here; finished with none, replan.ts read it as
    // written before the rules and the app rewrote its posts.
    const written = await writtenSoFar();
    if (written) {
      const rules = (plan.evidence as { rules?: unknown } | null)?.rules ? {} : { evidence: { ...((plan.evidence as Record<string, unknown> | null) ?? {}), rules: COPY_RULE } };
      if (!(await markReady(rules))) return STOPPED;
      return { status: "done", result: { plan_id: plan.id, posts: written, finished: true } };
    }
    const { data: started, error: startError } = await admin.from("calendar_plans").update({ status: "planning", error: null, updated_at: now.toISOString() })
      .eq("id", plan.id).neq("status", "canceled").select("id");
    if (startError) throw new Error(`Could not start the plan: ${startError.message}`);
    if (!started?.length) return STOPPED;

    const gathered = await gatherEvidence(admin, client, now, { week });
    const rhythm = { applied: gathered.rhythm, learned: gathered.learnedRhythm, sources: gathered.rhythmSources, stories: gathered.stories };
    // The dated moments the client's data checked: the only moments a seasonal post can rest on.
    const items = [...gathered.evidence, ...planMoments(plan)];
    // rules: the version of the copy rules the plan is written under (copyChecks.ts COPY_RULE).
    const evidence: Record<string, unknown> = { items, avoid: gathered.avoid, thin: gathered.thin, sources: gathered.sources, first_date: firstDate, rules: COPY_RULE };
    // A client that posts less than once a week has weeks with nothing to post on any platform.
    if (!gathered.rhythm.length && gathered.learnedRhythm.length) {
      if (!(await markReady({ rhythm, evidence }))) return STOPPED;
      return { status: "done", result: { plan_id: plan.id, posts: 0, quiet_week: true } };
    }

    const voice = await loadClientVoice(admin, client.id);
    // A platform that had too few posts for a voice of its own has 5 now: the profile is built again early, for the plans after this one.
    if (voiceReady(voice.social, gathered.own).length) await queueVoiceRebuild(admin, client.id, now);
    const { data: weekPosts, error: nearError } = await admin.from("calendar_posts").select("post_date, platform, format, copy, plan_id")
      .eq("client_id", client.id).gte("post_date", addDays(week, -21)).lte("post_date", addDays(week, 27)).order("post_date");
    if (nearError) throw new Error(`Could not read the posts around the week: ${nearError.message}`);
    const inWeek = (d: string) => d >= week && d <= addDays(week, 6);
    // Stories never count toward the feed rhythm: they are left out of the posts people added.
    const existing = (weekPosts ?? []).filter((p: any) => inWeek(p.post_date) && !p.plan_id && !isStoryPost(p)).map((p: any) => ({ date: p.post_date, platform: p.platform, copy: p.copy || "" }));
    const recent = (weekPosts ?? []).filter((p: any) => !inWeek(p.post_date) && p.copy).map((p: any) => ({ date: p.post_date, platform: p.platform, copy: p.copy }));
    const ctx = {
      brand: String(client.name),
      voiceBlock: voicePromptBlock(voice, { platforms: gathered.rhythm.map((r) => r.platform), examples: gathered.examples }),
      pillars: (Array.isArray(client.content_pillars) ? client.content_pillars : []).map((p: any) => ({ name: String(p?.name ?? p ?? ""), description: p?.description ? String(p.description).slice(0, 240) : undefined })).filter((p: any) => p.name),
      market: list(client.geo),
      languages: list(client.language),
      monday: week,
      firstDate,
      rhythm: gathered.rhythm,
      evidence: items,
      avoid: gathered.avoid,
      competitiveBrief: await competitiveBrief(admin, client.id).catch(() => ""),
      existing,
      recent,
      thin: gathered.thin,
      canFilm: await clientCanFilm(admin, client.id, now),
      hashtags: gathered.hashtags,
      strategy: await clientStrategy(admin, client.id),
    };
    // Display names the client's Sprout account lists with decorations are written plainly in what is saved.
    const { names } = await accountsFacts(admin, client.id);
    // Every post is checked before it is saved: against the outside posts of the week, and against what is the client's own.
    const check: CopyCheck = { outside: gathered.outside, own: ownFacts(client, gathered, voice, { handles: await ownHandles(admin, client.id) }, { pillars: ctx.pillars.length > 0, strategy: !!ctx.strategy }) };
    const tokens = { input: 0, output: 0 };
    /** One model call and what its reply came to: the posts that passed, the seasonal posts dropped and the posts the checks refused. */
    const ask = async (context: typeof ctx, noTest = false) => {
      const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 16000, messages: [{ role: "user", content: weekPrompt(context) }] } });
      const u = usage(result.raw);
      tokens.input += u.input; tokens.output += u.output;
      const seasonal: DroppedPost[] = [];
      const refused: RefusedPost[] = [];
      return { posts: parseWeekPlan(result.text, context, { dropped: seasonal, refused, check, names, noTest }), seasonal, refused };
    };
    // No model call starts once a person stopped the plan.
    if (await planStopped(admin, plan.id)) return STOPPED;
    const first = await ask(ctx);
    let posts = first.posts;
    let dropped = first.seasonal;
    /** The posts the checks refused that no post replaced. */
    let droppedCopy: RefusedPost[] = [];
    // At most two calls. A reply with nothing usable is asked again as it was. A reply with refused posts is asked once
    // more for them: the posts that passed count as already on the calendar, and the outside posts they borrowed from are left out.
    if (!first.posts.length && !first.refused.length) {
      if (await planStopped(admin, plan.id)) return STOPPED;
      const again = await ask(ctx);
      posts = again.posts;
      dropped = again.seasonal;
      droppedCopy = again.refused;
    } else if (first.refused.length) {
      if (await planStopped(admin, plan.id)) return STOPPED;
      const named = new Set(first.refused.flatMap((r) => r.ids));
      const again = await ask({
        ...ctx,
        existing: [...ctx.existing, ...first.posts.map((p) => ({ date: p.post_date, platform: p.platform, copy: p.copy }))],
        evidence: ctx.evidence.filter((e) => !named.has(e.id)),
      }, first.posts.some((p) => p.reasons[0]?.test === true));
      posts = [...first.posts, ...again.posts];
      dropped = [...first.seasonal, ...again.seasonal];
      // Refused again: dropped. A second reply with nothing in it replaced nothing.
      droppedCopy = again.posts.length || again.refused.length ? again.refused : first.refused;
    }
    // Stopped during the model call: the reply is dropped.
    if (await planStopped(admin, plan.id)) return STOPPED;
    if (!posts.length) throw new Error("The planner's reply had no usable posts.");
    // Posts the copy checks refused twice, for staff to see on the plan.
    if (droppedCopy.length) evidence.dropped_copy = droppedCopy.map(({ date, platform, copy, why }) => ({ date, platform, copy, why }));
    // Seasonal posts the planner wrote without a checked moment, for staff to see on the plan.
    if (dropped.length) evidence.dropped_seasonal = dropped;
    const finishing = { model: COPY_MODEL, input_tokens: tokens.input, output_tokens: tokens.output, rhythm, evidence };
    // Checked again right before writing: a run that outlived its claim may have written them meanwhile.
    if (await writtenSoFar()) {
      if (!(await markReady(finishing))) return STOPPED;
      return { status: "done", result: { plan_id: plan.id, finished: true } };
    }
    // The week's Stories are added in code, with no model call: the client's own rate, or one with each Instagram post (storyPlan).
    // A plan stopped after the check above takes none of them (calendar_posts_plan_open).
    const stories = storyPlan(gathered.stories, String(client.name ?? ""), posts);
    const rows = withStories(posts, stories.count, stories.reason).map((p) => ({ ...p, client_id: client.id, plan_id: plan.id, created_by: plan.requested_by ?? null }));
    // What the posts were written under is kept before they are: a run that stops between the two finishes with it.
    await must(admin.from("calendar_plans").update({ ...finishing, updated_at: new Date().toISOString() }).eq("id", plan.id).neq("status", "canceled"), "Could not keep the week's evidence");
    await must(admin.from("calendar_posts").insert(rows), "Could not add the week's posts");
    if (!(await markReady(finishing))) return STOPPED;
    return { status: "done", result: { plan_id: plan.id, posts: rows.length, input_tokens: tokens.input, output_tokens: tokens.output } };
  } catch (e) {
    // A plan a person stopped stays stopped, whatever went wrong after the stop.
    if (planId && (await planStopped(admin, planId).catch(() => false))) return STOPPED;
    // Whatever went wrong (a provider error, a reply that couldn't be read), the week is tried again later.
    const reason = message(e);
    if (planId && claimed) {
      await Promise.resolve(admin.from("calendar_plans").update({ status: "queued", error: reason, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", planId).neq("status", "canceled"))
        .catch((err: unknown) => console.warn("[calendar] could not release the week:", message(err)));
    }
    return retryLater(job, reason, now);
  }
}

/** Queue the client's voice profile now, once a day at most. A queue that does not take it is left for the next plan. */
async function queueVoiceRebuild(admin: Db, clientId: string, now: Date): Promise<void> {
  const { error } = await admin.from("scheduled_jobs").upsert({
    kind: "voice_profile", client_id: clientId, dedupe_key: `voice_profile:${clientId}:${now.toISOString().slice(0, 10)}`, priority: 39, available_at: now.toISOString(),
  }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) console.warn("[calendar] could not queue the voice profile:", error.message);
}

// ── Revise a week ───────────────────────────────────────────────────────────

/**
 * The ids of posts someone worked on: edited copy, moved, designed or
 * scheduled. Asked of calendar_post_worked() post by post: a report post's
 * key is JSON text, which an in() filter on the key does not survive.
 */
export async function workedOn(admin: Db, clientId: string, posts: Array<{ id: string; post_key: string; platform: string; copy: string | null; touched_at: string | null }>): Promise<Set<string>> {
  const ids = await Promise.all(posts.map(async (p) => {
    const { data, error } = await admin.rpc("calendar_post_worked", { p_client: clientId, p_key: p.post_key, p_platform: p.platform, p_copy: p.copy ?? "", p_touched: p.touched_at });
    if (error) throw new Error(`Could not tell whether a post was worked on: ${error.message}`);
    return data === true ? p.id : null;
  }));
  return new Set(ids.filter((id): id is string => !!id));
}

/**
 * The posts a person's own revision rewrote (calendar_plans.revisions). A
 * revision nobody asked for (the rewrite client notes ask for) keeps them,
 * as it keeps every post someone worked on.
 */
export function revisedByPerson(revisions: unknown): Set<string> {
  const out = new Set<string>();
  for (const r of (Array.isArray(revisions) ? revisions : []) as Array<{ by?: unknown; replaced?: unknown }>) {
    if (!r?.by || !Array.isArray(r.replaced)) continue;
    for (const p of r.replaced as Array<{ id?: unknown }>) if (p?.id) out.add(String(p.id));
  }
  return out;
}

export async function runWeekRevise(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const week = String(job.occurrence ?? "").slice(0, 10);
  let planId: string | null = null;
  let claimed = false;
  try {
    const { data: plan, error: planError } = await admin.from("calendar_plans").select("*").eq("client_id", job.client_id).eq("week_start", week).maybeSingle();
    if (planError) throw new Error(`Could not read the plan: ${planError.message}`);
    const pending = plan?.pending_revision as { note: string; by: string | null; at: string; scope: "untouched" | "empty" | "replan" } | null;
    if (plan?.status === "canceled") return STOPPED;
    if (!plan || !pending) return { status: "skipped", reason: "No revision is waiting for this week." };
    planId = plan.id;

    const finish = (entry: Record<string, unknown>) => must(admin.from("calendar_plans").update({
      pending_revision: null, claimed_at: null, updated_at: new Date().toISOString(),
      revisions: [...(Array.isArray(plan.revisions) ? plan.revisions : []), { note: pending.note, by: pending.by, at: pending.at, scope: pending.scope, done_at: new Date().toISOString(), ...entry }],
      // A replan brings the plan under the current copy rules, so it is not asked for again (replan.ts planRules).
      ...(pending.scope === "replan" ? { evidence: { ...((plan.evidence ?? {}) as Record<string, unknown>), rules: COPY_RULE } } : {}),
    }).eq("id", plan.id).neq("status", "canceled"), "Could not record the revision");

    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const today = todayIn(String(client.timezone || "UTC"), now);
    // A week that is over has nothing left to rewrite: the revision closes quietly.
    if (today > addDays(week, 6)) {
      await finish({ expired: true, rewritten: 0 });
      return { status: "skipped", reason: "The week is over." };
    }
    if (leftByStoppedRun(plan, now)) {
      await releaseStoppedRun(admin, plan);
      return retryLater(job, "The last run stopped before finishing.", now);
    }
    if (await voicePending(admin, job.client_id)) return waitForVoice(now);
    if (!(await claimPlan(admin, plan.id, now))) return (await planStopped(admin, plan.id)) ? STOPPED : busyElsewhere(now);
    claimed = true;

    const { data: rows, error: rowsError } = await admin.from("calendar_posts").select("id, post_key, post_date, platform, format, pillar, copy, hashtags, cta, visual_direction, reasons, touched_at, plan_id, story_of")
      .eq("client_id", client.id).gte("post_date", week).lte("post_date", addDays(week, 6)).order("post_date");
    if (rowsError) throw new Error(`Could not read the week's posts: ${rowsError.message}`);
    const all = (rows ?? []) as any[];
    const planPosts = all.filter((p) => p.plan_id === plan.id && p.post_date >= today);
    const worked = await workedOn(admin, client.id, planPosts);
    if (!pending.by) for (const id of revisedByPerson(plan.revisions)) worked.add(id);
    const kept = planPosts.filter((p) => worked.has(p.id)).map((p) => p.id);
    // A replan writes again only the posts with a reason to be (replan.ts): written from an outside post, with time codes, or before the client's accounts changed.
    const ownDroppedAt = pending.scope === "replan" ? (await accountsFacts(admin, client.id)).ownDroppedAt : null;
    const inScope = (p: any) => pending.scope === "empty" ? !String(p.copy || "").trim() : pending.scope === "replan" ? replanWhy(p, plan, { ownDroppedAt }) !== null : true;
    // A Story is never rewritten as a feed post: it follows its post's new copy (below).
    const targets = planPosts.filter((p) => !worked.has(p.id) && !isStoryPost(p) && inScope(p));
    if (!targets.length) {
      await finish({ rewritten: 0, kept });
      return { status: "done", result: { plan_id: plan.id, rewritten: 0 } };
    }

    const voice = await loadClientVoice(admin, client.id);
    const { names } = await accountsFacts(admin, client.id);
    // A rewrite from a note works on the posts as they stand; posts written fresh (empty, replan) are written from the week's evidence.
    const fresh = pending.scope !== "untouched";
    const gathered = fresh ? await gatherEvidence(admin, client, now, { week }) : null;
    const reviseEvidence = gathered ? [...gathered.evidence, ...planMoments(plan)] : [];
    // Why a post is planned, by its subject only: a rewrite's prompt never names who posted an outside post.
    const reasonWords = (r: unknown) => (Array.isArray(r) && r[0] ? reasonForPlanner(r[0] as Reason) : "");
    const asRevisePost = (p: any): RevisePost => ({
      id: p.id, date: p.post_date, platform: p.platform, format: p.format, pillar: p.pillar,
      // A post written again shows neither its earlier copy nor its earlier reason: both may come from an outside post.
      copy: pending.scope === "replan" ? "" : p.copy || "", reason: fresh ? "" : reasonWords(p.reasons),
    });
    // The copy checks (copyChecks.ts): fresh posts against the week's outside posts, a rewrite against the outside posts its posts cite.
    const outside = gathered ? gathered.outside : [...new Map(targets.flatMap((p) => outsideFromReasons(p.reasons)).map((o) => [`${o.id}|${o.text}`, o])).values()];
    const voiceBlock = voicePromptBlock(voice, { platforms: [...new Set(targets.map((p) => p.platform))], ...(gathered ? { examples: gathered.examples } : {}) });
    const pillars = (Array.isArray(client.content_pillars) ? client.content_pillars : []).map((p: any) => ({ name: String(p?.name ?? p ?? ""), description: p?.description ? String(p.description).slice(0, 240) : undefined })).filter((p: any) => p.name);
    const strategy = await clientStrategy(admin, client.id);
    const own = ownFacts(client, gathered, voice, { handles: await ownHandles(admin, client.id) }, { pillars: pillars.length > 0, strategy: !!strategy });
    const nobody: OwnFacts = { hosts: [], handles: [], text: "", hasNotes: false };
    const asOwn = (texts: string[]) => {
      own.hosts = [...new Set([...own.hosts, ...texts.flatMap((t) => foreignLinks(t, nobody))])];
      own.handles = [...new Set([...own.handles, ...texts.flatMap((t) => foreignHandles(t, nobody))])];
    };
    // A rewrite from a note does not read the client's posts again, so a link or a handle its posts already carry counts as theirs.
    if (!fresh) asOwn(targets.map((p) => `${p.copy || ""}\n${p.cta || ""}`));
    // A person's note is the person's instruction: a link or a handle they wrote in it is the client's own for this revision.
    if (pending.by) asOwn([String(pending.note || "")]);
    const check: CopyCheck = { outside, own };
    const tokens = { input: 0, output: 0 };
    /** One model call for these posts, and what its reply came to: the posts that passed the checks, the ones refused, and whether it held any post at all. */
    const ask = async (posts: any[], evidence: EvidenceItem[], others: Array<{ date: string; platform: string; copy: string }>) => {
      const prompt = revisePrompt({
        brand: String(client.name), voiceBlock, note: pending.note, scope: pending.scope, posts: posts.map(asRevisePost),
        pillars, languages: list(client.language), evidence, others, strategy,
      });
      const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 12000, messages: [{ role: "user", content: prompt }] } });
      const u = usage(result.raw);
      tokens.input += u.input; tokens.output += u.output;
      const refused: RefusedPost[] = [];
      return { revised: parseRevision(result.text, posts.map((p) => p.id), evidence, fresh, { names, check, refused }), refused };
    };
    // The week's other posts, whose topics are not to be repeated. A Story of a post being rewritten is not one of them:
    // it carries that post's earlier copy, and takes the new one below.
    const targetKeys = new Set(targets.map((t) => t.post_key));
    const others = all.filter((p) => !targets.some((t) => t.id === p.id) && p.copy && !(isStoryPost(p) && p.story_of && targetKeys.has(p.story_of)))
      .map((p) => ({ date: p.post_date, platform: p.platform, copy: p.copy }));
    // No model call starts, and nothing is rewritten, once a person removed the plan.
    if (await planStopped(admin, plan.id)) return STOPPED;
    const first = await ask(targets, reviseEvidence, others);
    if (await planStopped(admin, plan.id)) return STOPPED;
    // A reply that held no post at all is tried again later. One whose posts were all refused finishes: the posts keep their copy.
    if (!first.revised.length && !first.refused.length) throw new Error("The rewrite's reply had no usable posts.");
    let revised = first.revised;
    let refused = first.refused;
    // Posts written fresh get one more call for the ones refused, without the outside posts they borrowed from. Refused twice, a post keeps the copy it had.
    if (fresh && first.refused.length) {
      const again = new Set(first.refused.map((r) => r.id));
      const named = new Set(first.refused.flatMap((r) => r.ids));
      const written = first.revised.map((r) => { const was = targets.find((p) => p.id === r.id)!; return { date: was.post_date, platform: was.platform, copy: r.copy }; });
      const second = await ask(targets.filter((p) => again.has(p.id)), reviseEvidence.filter((e) => !named.has(e.id)), [...others, ...written]);
      if (await planStopped(admin, plan.id)) return STOPPED;
      revised = [...first.revised, ...second.revised];
      const rewrittenNow = new Set<string | undefined>(second.revised.map((r) => r.id));
      // A second reply that left a post out says nothing new about it: its first refusal stands.
      refused = [...second.refused, ...first.refused.filter((r) => !rewrittenNow.has(r.id) && !second.refused.some((x) => x.id === r.id))];
    }

    // QA 22 Nov 2026: asked again right before writing. A person who pressed
    // Design or scheduled a post during the model call changed nothing the
    // update below is guarded on, and the design or the Sprout post was left
    // with copy the calendar no longer showed.
    const workedSince = await workedOn(admin, client.id, planPosts.filter((p) => !worked.has(p.id)));
    for (const id of workedSince) if (targets.some((t) => t.id === id)) kept.push(id);

    const replaced: Array<Record<string, unknown>> = [];
    /** The new copy of each post rewritten, by its key. */
    const rewrote = new Map<string, string>();
    for (const r of revised) {
      if (workedSince.has(String(r.id))) continue;
      const was = targets.find((p) => p.id === r.id)!;
      const patch: Record<string, unknown> = { copy: r.copy, hashtags: r.hashtags, cta: r.cta, visual_direction: r.visual_direction, ...(r.pillar ? { pillar: r.pillar } : {}), ...(r.reason ? { reasons: [r.reason] } : {}) };
      // Only if nobody changed the copy or moved the post since it was read, and it is still the plan's.
      const { data: updated, error: updateError } = await admin.from("calendar_posts").update(patch).eq("id", r.id).eq("copy", was.copy ?? "").is("touched_at", null).eq("plan_id", plan.id).select("id");
      if (updateError) throw new Error(`Could not rewrite a post: ${updateError.message}`);
      if (updated?.length) {
        replaced.push({ id: was.id, copy: was.copy, hashtags: was.hashtags, cta: was.cta, pillar: was.pillar, visual_direction: was.visual_direction, reasons: was.reasons });
        rewrote.set(was.post_key, r.copy);
      }
    }
    // A planned Story takes its post's new copy, the message its frame is written from, only when nobody worked on the Story.
    for (const st of planPosts.filter((p) => isStoryPost(p) && p.story_of && rewrote.has(p.story_of) && !worked.has(p.id) && !workedSince.has(p.id))) {
      const { data: updated, error: updateError } = await admin.from("calendar_posts").update({ copy: rewrote.get(st.story_of) }).eq("id", st.id).eq("copy", st.copy ?? "").is("touched_at", null).eq("plan_id", plan.id).select("id");
      if (updateError) throw new Error(`Could not rewrite a Story: ${updateError.message}`);
      if (updated?.length) replaced.push({ id: st.id, copy: st.copy, hashtags: st.hashtags, cta: st.cta, pillar: st.pillar, visual_direction: st.visual_direction, reasons: st.reasons });
    }
    await finish({
      rewritten: replaced.length, kept, replaced, input_tokens: tokens.input, output_tokens: tokens.output,
      // The posts the copy checks refused, which keep the copy they had.
      ...(refused.length ? { refused: refused.map((r) => ({ id: r.id, why: r.why, kind: r.kind })) } : {}),
    });

    // A person's note teaches the memory; the daily run's own note does not.
    if (pending.by && pending.scope === "untouched") {
      await learnFromSignal(admin, client.id, { kind: "revise_note", note: pending.note }).catch((e) => console.warn("[calendar] memory:", e instanceof Error ? e.message : e));
    }
    return { status: "done", result: { plan_id: plan.id, rewritten: replaced.length } };
  } catch (e) {
    // A plan a person removed stays removed.
    if (planId && (await planStopped(admin, planId).catch(() => false))) return STOPPED;
    // The revision stays waiting and is tried again later, while the week has days to come.
    const reason = message(e);
    if (planId && claimed) {
      await Promise.resolve(admin.from("calendar_plans").update({ claimed_at: null }).eq("id", planId).neq("status", "canceled"))
        .catch((err: unknown) => console.warn("[calendar] could not release the week:", message(err)));
    }
    return retryLater(job, reason, now);
  }
}

// ── Voice profile ───────────────────────────────────────────────────────────

/** Past this many active preferences, the monthly voice job merges the list so it stays short and current. */
export const MEMORY_LIMIT = 8;

/**
 * Merge the client's preferences when the list has grown past MEMORY_LIMIT.
 * A failed merge is logged and changes nothing; it never fails the voice job.
 */
async function keepMemoryShort(admin: Db, clientId: string): Promise<{ before: number; after: number } | null> {
  try {
    if ((await activePreferences(admin, clientId)).length <= MEMORY_LIMIT) return null;
    return await consolidateMemory(admin, clientId);
  } catch (e) {
    console.warn("[calendar] memory merge:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** How long after a voice profile is built the client's lifecycle looks at it: long enough for the job to be recorded as finished. */
export const VOICE_LOOK_MS = 60_000;

export async function runVoiceProfile(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  if (job.attempts > job.max_attempts) return { status: "failed", reason: `The voice profile stopped before finishing ${job.attempts - 1} times.` };
  try {
    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const { posts, sprout, names } = await ownPosts(admin, client, await feedSnapshots(admin, client.id), now);
    const voice = await buildVoiceProfile(admin, client.id, posts, now, { names });
    const memory = await keepMemoryShort(admin, client.id);
    // A new voice: the client's lifecycle looks at the upcoming calendar (lifecycle step calendar_recheck). The look is a
    // minute away, so this job is recorded as finished when it runs. Asked of the database directly: lifecycle/run.ts imports this file.
    try {
      const { error: lookError } = await admin.rpc("lifecycle_enqueue", { p_client: job.client_id, p_priority: 30, p_at: new Date(Date.now() + VOICE_LOOK_MS).toISOString() });
      if (lookError) console.warn("[calendar] could not queue the look after the voice profile:", lookError.message);
    } catch (e) {
      console.warn("[calendar] could not queue the look after the voice profile:", e instanceof Error ? e.message : String(e));
    }
    return { status: "done", result: { posts: voice.post_count, platforms: Object.keys(voice.platforms), sprout, ...(memory ? { memory } : {}) } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (job.attempts >= job.max_attempts) return { status: "failed", reason };
    return { status: "queued", reason, available_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() };
  }
}
