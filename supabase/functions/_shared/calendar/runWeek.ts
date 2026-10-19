// supabase/functions/_shared/calendar/runWeek.ts
//
// The weekly calendar's jobs (Lital, 19 Oct 2026), run by run-scheduled-jobs:
//   week_plan      write one week's plan, once, from the freshest evidence
//   week_revise    rewrite a week's posts nobody worked on, from a note
//   voice_profile  learn how the client writes from its published posts
// Each job is one bounded model call. A plan that already has posts (a run
// cut off after writing them) is finished rather than written twice. Every
// active client can be planned: the posting rhythm always resolves
// (evidence.ts resolveRhythm), so no plan waits for a setting. Nothing ends
// in failure while its week can still be used: a plan or revision that
// doesn't finish is tried again with growing waits (retryWait), and a week
// that is over closes quietly.

import { anthropicMessages } from "../anthropic.ts";
import { collectOwnedCompetitive } from "../competitive/ownedSource.ts";
import { competitiveBrief } from "../competitive/brief.ts";
import {
  bestExamples, clientCompanyId, compactFeedRow, competitorPosts, feedHistories, isBoosted, isClientPost, medianRates, numberEvidence, platformName,
  resolveRhythm, scoreCompetitorPosts, scoreOwnPosts, MIN_COMPETITOR_WEEKS, OWN_DAYS,
  type CompetitorPost, type EvidenceItem, type FeedRow, type OwnPost, type RhythmLine, type RhythmSources,
} from "./evidence.ts";
import { parseRevision, parseWeekPlan, revisePrompt, weekPrompt, type Reason, type RevisePost } from "./weekPlan.ts";
import { wordReason } from "./reasonText.ts";
import { activePreferences, buildVoiceProfile, consolidateMemory, COPY_MODEL, learnFromSignal, loadClientVoice } from "../voice/load.ts";
import { voicePromptBlock } from "../voice/voice.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface WeekJob {
  id: string;
  kind: string;
  client_id: string;
  occurrence: string | null;
  attempts: number;
  max_attempts: number;
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
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((t) => typeof t === "string").join(": ") : "")).filter(Boolean) : []);
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
  sources: { sprout: string; feed_weeks: number; report: string | null; topics: number };
}

/** The client's own posts for the last 90 days: Sprout where profiles are assigned, RivalIQ's copy for other platforms. */
async function ownPosts(admin: Db, client: Record<string, unknown>, snapshots: Array<{ payload: any }>, now: Date): Promise<{ posts: OwnPost[]; sprout: string }> {
  const end = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - OWN_DAYS * DAY).toISOString().slice(0, 10);
  let posts: OwnPost[] = [];
  let sprout = "not_connected";
  const covered = new Set<string>();
  try {
    const owned = await collectOwnedCompetitive(admin, client, { start, end }, { fields: ["is_boosted"] });
    sprout = owned.coverage;
    for (const p of owned.profiles ?? []) covered.add(platformName(p.network));
    posts = (owned.posts ?? []).map((p: any) => ({
      id: String(p.postId), platform: platformName(p.channel), format: String(p.type || "unknown"), publishedAt: String(p.publishedAt),
      text: String(p.message || ""), link: p.postLink ?? null, impressions: p.ownedImpressions ?? null, engagement: Number(p.engagementTotal) || 0,
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
      posts.push({ id, platform, format: String(p.type || "unknown"), publishedAt: String(p.publishedAt), text: String(p.message || ""), link: p.postLink ?? null, impressions: null, engagement: Number(p.engagementTotal) || 0, boosted: isBoosted(p.facebookLikelyBoosted) });
    }
  }
  return { posts, sprout };
}

/** The client's weekly competitor feeds, newest first (14 weeks covers the 90 days of own posts). */
async function feedSnapshots(admin: Db, clientId: string): Promise<Array<{ payload: any }>> {
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
async function competitorSet(admin: Db, clientId: string): Promise<Array<{ name: string; rivaliq_company_id: string | null }>> {
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
async function trackedRates(admin: Db): Promise<Record<string, number>> {
  const histories = feedHistories(await feedRows(admin));
  return medianRates([...histories.values()]);
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
  const { posts: own, sprout } = await ownPosts(admin, client, snapshots, now);

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

  const { data: alerts } = newestStart
    ? await admin.from("competitive_alerts").select("topic, summary, companies, post_urls, confidence")
      .eq("client_id", client.id).neq("status", "dismissed").gte("window_start", newestStart).order("confidence", { ascending: false }).limit(8)
    : { data: [] };

  const { data: report, error: reportError } = await admin.from("reports").select("id, created_at, report_data").eq("client_id", client.id).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (reportError) throw new Error(`Could not read the latest report: ${reportError.message}`);
  const rd = Array.isArray(report?.report_data) ? report.report_data[0] : report?.report_data;
  const ai = rd?.ai_analysis ?? {};
  const perf = ai.sprout_performance_analysis ?? {};
  const findings = [...strings(perf.key_insights), ...strings(perf.pillar_alignment?.recommendations), ...strings(ai.competitive_takeaways)];
  const trends = [...strings(ai.tiktok_trends_analysis?.opportunities_for_client), ...strings(ai.instagram_trends_analysis?.opportunities_for_client)];

  const scored = scoreOwnPosts(own, now);
  const evidence = numberEvidence({ ownTop: scored.top, competitors, topics: alerts ?? [], trends, findings });
  const [history, set] = await Promise.all([feedRows(admin, client.id), competitorSet(admin, client.id)]);
  const rhythmInput = {
    own, primaryPlatforms: client.primary_platforms, setting: client.posting_rhythm, monday: week, now, timeZone: tz,
    competitors: competitorPosts(feedHistories(history, { [client.id]: String(client.name ?? "") }).get(client.id), set),
    allTracked: null as Record<string, number> | null,
  };
  let resolved = resolveRhythm(rhythmInput);
  if (resolved.needsAllTracked) resolved = resolveRhythm({ ...rhythmInput, allTracked: await trackedRates(admin) });
  const thin = [
    ...Object.entries(scored.platforms).filter(([, v]) => v.thin).map(([k, v]) => `${k}: ${v.posts} post${v.posts === 1 ? "" : "s"} in the last 90 days, so its numbers are an early signal.`),
    ...(recent.length && recent.length < 1 + MIN_COMPETITOR_WEEKS ? [`Competitor history: ${recent.length} week${recent.length === 1 ? "" : "s"} so far, so competitor numbers are an early signal.`] : []),
  ];
  const fmt = (s: typeof scored.low[number]) => `${s.post.platform} ${s.post.format} from ${s.post.publishedAt.slice(0, 10)} got ${s.multiple}x the usual ${s.metric}: ${s.post.text.replace(/\s+/g, " ").slice(0, 140)}`;
  return {
    own, learnedRhythm: resolved.learned, rhythm: resolved.applied, rhythmSources: resolved.sources, evidence, avoid: scored.low.map(fmt), thin,
    examples: bestExamples(scored.top),
    sources: { sprout, feed_weeks: recent.length, report: report?.id ?? null, topics: (alerts ?? []).length },
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
 * revises, and a claim older than CLAIM_MS belonged to a run that died.
 */
async function claimPlan(admin: Db, planId: string, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - CLAIM_MS).toISOString();
  const { data, error } = await admin.from("calendar_plans").update({ claimed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", planId).or(`claimed_at.is.null,claimed_at.lt."${stale}"`).select("id");
  if (error) throw new Error(`Could not claim the week: ${error.message}`);
  return !!data?.length;
}

/** The client's voice profile is being learned: plans and revisions wait for it. */
async function voicePending(admin: Db, clientId: string): Promise<boolean> {
  const { count, error } = await admin.from("scheduled_jobs").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("kind", "voice_profile").in("status", ["queued", "running"]);
  if (error) throw new Error(`Could not check the voice profile: ${error.message}`);
  return !!count;
}

const waitForVoice = (now: Date): WeekJobOutcome => ({ status: "queued", reason: "Waiting for the client's voice profile.", available_at: new Date(now.getTime() + 60_000).toISOString(), deferred: true });

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

/** Release a claim a stopped run left, unless a new run took it meanwhile. */
async function releaseStoppedRun(admin: Db, plan: { id: string; claimed_at: string }, patch: Record<string, unknown> = {}): Promise<void> {
  await admin.from("calendar_plans").update({ claimed_at: null, updated_at: new Date().toISOString(), ...patch }).eq("id", plan.id).eq("claimed_at", plan.claimed_at);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
      await must(admin.from("calendar_plans").update({ status: "expired", claimed_at: null, updated_at: now.toISOString() }).eq("id", plan.id), "Could not close the week");
      return { status: "skipped", reason: "The week is over." };
    }
    if (leftByStoppedRun(plan, now)) {
      await releaseStoppedRun(admin, plan, { status: "queued" });
      return retryLater(job, "The last run stopped before finishing.", now);
    }
    if (await voicePending(admin, job.client_id)) return waitForVoice(now);
    if (!(await claimPlan(admin, plan.id, now))) return busyElsewhere(now);
    claimed = true;

    const writtenSoFar = async () => {
      const { count, error } = await admin.from("calendar_posts").select("id", { count: "exact", head: true }).eq("plan_id", plan.id);
      if (error) throw new Error(`Could not read the week's posts: ${error.message}`);
      return count ?? 0;
    };
    const markReady = (extra: Record<string, unknown> = {}) => must(admin.from("calendar_plans")
      .update({ status: "ready", ready_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null, claimed_at: null, ...extra }).eq("id", plan.id), "Could not finish the plan");

    // A run cut off after writing the posts: finish the plan, don't write them twice.
    const written = await writtenSoFar();
    if (written) {
      await markReady();
      return { status: "done", result: { plan_id: plan.id, posts: written, finished: true } };
    }
    await must(admin.from("calendar_plans").update({ status: "planning", error: null, updated_at: now.toISOString() }).eq("id", plan.id), "Could not start the plan");

    const gathered = await gatherEvidence(admin, client, now, { week });
    const rhythm = { applied: gathered.rhythm, learned: gathered.learnedRhythm, sources: gathered.rhythmSources };
    const evidence = { items: gathered.evidence, avoid: gathered.avoid, thin: gathered.thin, sources: gathered.sources, first_date: firstDate };
    // A client that posts less than once a week has weeks with nothing to post on any platform.
    if (!gathered.rhythm.length && gathered.learnedRhythm.length) {
      await markReady({ rhythm, evidence });
      return { status: "done", result: { plan_id: plan.id, posts: 0, quiet_week: true } };
    }

    const voice = await loadClientVoice(admin, client.id);
    const { data: weekPosts, error: nearError } = await admin.from("calendar_posts").select("post_date, platform, copy, plan_id")
      .eq("client_id", client.id).gte("post_date", addDays(week, -21)).lte("post_date", addDays(week, 27)).order("post_date");
    if (nearError) throw new Error(`Could not read the posts around the week: ${nearError.message}`);
    const inWeek = (d: string) => d >= week && d <= addDays(week, 6);
    const existing = (weekPosts ?? []).filter((p: any) => inWeek(p.post_date) && !p.plan_id).map((p: any) => ({ date: p.post_date, platform: p.platform, copy: p.copy || "" }));
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
      evidence: gathered.evidence,
      avoid: gathered.avoid,
      competitiveBrief: await competitiveBrief(admin, client.id).catch(() => ""),
      existing,
      recent,
      thin: gathered.thin,
      canFilm: await clientCanFilm(admin, client.id, now),
    };
    let posts: ReturnType<typeof parseWeekPlan> = [];
    const tokens = { input: 0, output: 0 };
    for (let attempt = 0; attempt < 2 && !posts.length; attempt++) {
      const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 16000, messages: [{ role: "user", content: weekPrompt(ctx) }] } });
      const u = usage(result.raw);
      tokens.input += u.input; tokens.output += u.output;
      posts = parseWeekPlan(result.text, ctx);
    }
    if (!posts.length) throw new Error("The planner's reply had no usable posts.");
    const finishing = { model: COPY_MODEL, input_tokens: tokens.input, output_tokens: tokens.output, rhythm, evidence };
    // Checked again right before writing: a run that outlived its claim may have written them meanwhile.
    if (await writtenSoFar()) {
      await markReady(finishing);
      return { status: "done", result: { plan_id: plan.id, finished: true } };
    }
    const rows = posts.map((p) => ({ ...p, client_id: client.id, plan_id: plan.id, created_by: plan.requested_by ?? null }));
    await must(admin.from("calendar_posts").insert(rows), "Could not add the week's posts");
    await markReady(finishing);
    return { status: "done", result: { plan_id: plan.id, posts: rows.length, input_tokens: tokens.input, output_tokens: tokens.output } };
  } catch (e) {
    // Whatever went wrong (a provider error, a reply that couldn't be read), the week is tried again later.
    const reason = message(e);
    if (planId && claimed) {
      await Promise.resolve(admin.from("calendar_plans").update({ status: "queued", error: reason, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", planId))
        .catch((err: unknown) => console.warn("[calendar] could not release the week:", message(err)));
    }
    return retryLater(job, reason, now);
  }
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

export async function runWeekRevise(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const week = String(job.occurrence ?? "").slice(0, 10);
  let planId: string | null = null;
  let claimed = false;
  try {
    const { data: plan, error: planError } = await admin.from("calendar_plans").select("*").eq("client_id", job.client_id).eq("week_start", week).maybeSingle();
    if (planError) throw new Error(`Could not read the plan: ${planError.message}`);
    const pending = plan?.pending_revision as { note: string; by: string | null; at: string; scope: "untouched" | "empty" } | null;
    if (!plan || !pending) return { status: "skipped", reason: "No revision is waiting for this week." };
    planId = plan.id;

    const finish = (entry: Record<string, unknown>) => must(admin.from("calendar_plans").update({
      pending_revision: null, claimed_at: null, updated_at: new Date().toISOString(),
      revisions: [...(Array.isArray(plan.revisions) ? plan.revisions : []), { note: pending.note, by: pending.by, at: pending.at, scope: pending.scope, done_at: new Date().toISOString(), ...entry }],
    }).eq("id", plan.id), "Could not record the revision");

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
    if (!(await claimPlan(admin, plan.id, now))) return busyElsewhere(now);
    claimed = true;

    const { data: rows, error: rowsError } = await admin.from("calendar_posts").select("id, post_key, post_date, platform, format, pillar, copy, hashtags, cta, visual_direction, reasons, touched_at, plan_id")
      .eq("client_id", client.id).gte("post_date", week).lte("post_date", addDays(week, 6)).order("post_date");
    if (rowsError) throw new Error(`Could not read the week's posts: ${rowsError.message}`);
    const all = (rows ?? []) as any[];
    const planPosts = all.filter((p) => p.plan_id === plan.id && p.post_date >= today);
    const worked = await workedOn(admin, client.id, planPosts);
    const kept = planPosts.filter((p) => worked.has(p.id)).map((p) => p.id);
    const targets = planPosts.filter((p) => !worked.has(p.id) && (pending.scope === "empty" ? !String(p.copy || "").trim() : true));
    if (!targets.length) {
      await finish({ rewritten: 0, kept });
      return { status: "done", result: { plan_id: plan.id, rewritten: 0 } };
    }

    const voice = await loadClientVoice(admin, client.id);
    const gathered = pending.scope === "empty" ? await gatherEvidence(admin, client, now, { week }) : null;
    const reasonWords = (r: unknown) => (Array.isArray(r) && r[0] ? wordReason(r[0] as Reason) : "");
    const revisePosts: RevisePost[] = targets.map((p) => ({ id: p.id, date: p.post_date, platform: p.platform, format: p.format, pillar: p.pillar, copy: p.copy || "", reason: pending.scope === "empty" ? "" : reasonWords(p.reasons) }));
    const prompt = revisePrompt({
      brand: String(client.name),
      voiceBlock: voicePromptBlock(voice, { platforms: [...new Set(targets.map((p) => p.platform))], ...(gathered ? { examples: gathered.examples } : {}) }),
      note: pending.note,
      scope: pending.scope,
      posts: revisePosts,
      pillars: (Array.isArray(client.content_pillars) ? client.content_pillars : []).map((p: any) => ({ name: String(p?.name ?? p ?? ""), description: p?.description ? String(p.description).slice(0, 240) : undefined })).filter((p: any) => p.name),
      languages: list(client.language),
      evidence: gathered?.evidence ?? [],
      others: all.filter((p) => !targets.some((t) => t.id === p.id) && p.copy).map((p) => ({ date: p.post_date, platform: p.platform, copy: p.copy })),
    });
    const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 12000, messages: [{ role: "user", content: prompt }] } });
    const revised = parseRevision(result.text, targets.map((p) => p.id), gathered?.evidence ?? [], pending.scope === "empty");
    if (!revised.length) throw new Error("The rewrite's reply had no usable posts.");

    const replaced: Array<Record<string, unknown>> = [];
    for (const r of revised) {
      const was = targets.find((p) => p.id === r.id)!;
      const patch: Record<string, unknown> = { copy: r.copy, hashtags: r.hashtags, cta: r.cta, visual_direction: r.visual_direction, ...(r.pillar ? { pillar: r.pillar } : {}), ...(r.reason ? { reasons: [r.reason] } : {}) };
      // Only if nobody changed the copy or moved the post since it was read.
      const { data: updated, error: updateError } = await admin.from("calendar_posts").update(patch).eq("id", r.id).eq("copy", was.copy ?? "").is("touched_at", null).select("id");
      if (updateError) throw new Error(`Could not rewrite a post: ${updateError.message}`);
      if (updated?.length) replaced.push({ id: was.id, copy: was.copy, hashtags: was.hashtags, cta: was.cta, pillar: was.pillar, visual_direction: was.visual_direction, reasons: was.reasons });
    }
    const u = usage(result.raw);
    await finish({ rewritten: replaced.length, kept, replaced, input_tokens: u.input, output_tokens: u.output });

    // A person's note teaches the memory; the daily run's own note does not.
    if (pending.by && pending.scope === "untouched") {
      await learnFromSignal(admin, client.id, { kind: "revise_note", note: pending.note }).catch((e) => console.warn("[calendar] memory:", e instanceof Error ? e.message : e));
    }
    return { status: "done", result: { plan_id: plan.id, rewritten: replaced.length } };
  } catch (e) {
    // The revision stays waiting and is tried again later, while the week has days to come.
    const reason = message(e);
    if (planId && claimed) {
      await Promise.resolve(admin.from("calendar_plans").update({ claimed_at: null }).eq("id", planId))
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

export async function runVoiceProfile(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  if (job.attempts > job.max_attempts) return { status: "failed", reason: `The voice profile stopped before finishing ${job.attempts - 1} times.` };
  try {
    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const { posts, sprout } = await ownPosts(admin, client, await feedSnapshots(admin, client.id), now);
    const voice = await buildVoiceProfile(admin, client.id, posts, now);
    const memory = await keepMemoryShort(admin, client.id);
    return { status: "done", result: { posts: voice.post_count, platforms: Object.keys(voice.platforms), sprout, ...(memory ? { memory } : {}) } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (job.attempts >= job.max_attempts) return { status: "failed", reason };
    return { status: "queued", reason, available_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() };
  }
}
