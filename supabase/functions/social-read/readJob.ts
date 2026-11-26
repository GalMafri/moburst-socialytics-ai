// supabase/functions/social-read/readJob.ts
//
// One public profile read, as one social_read job of the scheduled-jobs
// worker (plan of 25 Nov 2026, section 4). The job never holds the worker:
// it starts an Apify run, asks to be called again a few minutes later, and
// looks at the run then (the start-then-look pattern of
// strategy/publicRead.ts).
//
//   1. The profile's own record (one cheap profile run) gives its name,
//      links and followers, and decides whether it is confirmed (confirm.ts).
//      An unconfirmed profile is not read: the read is recorded as
//      not_confirmed, with the reason, and the job ends.
//   2. The posts run reads the profile's posts since the window's first
//      day: 90 days on the first read, 14 days after that, so each post is
//      read in its first week and again once its engagement has settled.
//   3. Posts, their counts and the profile's followers are stored.
//
// A run that fails is started again, at most RUN_RETRIES times; after that
// the read is recorded as failed and never as "no posts". Without an Apify
// token, or with one Apify refuses, the read is skipped with that reason. A
// database error is thrown, so the worker tries the job again and the daily
// check sees a job that keeps failing.
//
// Every Apify call goes through the paying desk (apify/client.ts uses
// paid.fetch) with the job's client, feature competitors.read, the schedule
// as the actor and the job as the execution; the run's cost is recorded by
// the cost webhook, and the read keeps the dollars Apify reported for staff.

import { type ApifyClient, ApifyTokenMissing, ApifyTokenRefused, isFinalRunStatus } from "../_shared/apify/client.ts";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";
import { type Confirmation, confirmProfile } from "./confirm.ts";
import { ON_SITE_CONFIDENCE } from "./profiles.ts";
import { isReadPlatform, type ProfileRecord, READERS, type ReadPost, type SocialReader } from "./readers/index.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const SOCIAL_READ_FEATURE = "competitors.read";
export const FIRST_READ_DAYS = 90;
export const WEEKLY_READ_DAYS = 14;
/** Posts asked for per profile: at most 150 in 90 days (more than any brand in the sets posts), 60 in 14 days. */
export const FIRST_READ_MAX_POSTS = 150;
export const WEEKLY_READ_MAX_POSTS = 60;
export const LOOK_AGAIN_MINUTES = 3;
/** A run still going after this long is taken as failed. */
export const GIVE_UP_MINUTES = 60;
export const RUN_RETRIES = 2;
const DAY = 86_400_000;
const TEXT_CHARS = 2000;

export interface RunRecord {
  stage: "profile" | "posts";
  actor: string;
  run_id: string;
  status: string;
  usd: number | null;
}

/** What the job carries between looks (scheduled_jobs.payload.state). */
export interface ReadState {
  read_id: string;
  stage: "profile" | "posts";
  run_id: string;
  run_started_at: string;
  tries: number;
  window: { start: string; end: string; max: number };
  runs: RunRecord[];
  record?: ProfileRecord | null;
}

export interface ReadPayload {
  profile_id: string;
  state?: ReadState | null;
}

export interface ReadDeps {
  now(): Date;
  /** The Apify client for this job (its cost context set), or a thrown ApifyTokenMissing. */
  apify(job: ScheduledJob): ApifyClient;
}

interface ProfileRow {
  id: string;
  client_id: string;
  competitor_id: string | null;
  platform: string;
  handle: string;
  url: string;
  handle_source: string;
  active: boolean;
  confirmed: boolean | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const later = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The read's window: 90 days when the profile has never been read in full, 14 after. */
export function readWindow(now: Date, readBefore: boolean): ReadState["window"] {
  const days = readBefore ? WEEKLY_READ_DAYS : FIRST_READ_DAYS;
  return { start: day(new Date(now.getTime() - days * DAY)), end: day(now), max: readBefore ? WEEKLY_READ_MAX_POSTS : FIRST_READ_MAX_POSTS };
}

/** A post's engagement: likes, comments and shares; unknown when likes are hidden. */
export function engagementOf(p: Pick<ReadPost, "likes" | "comments" | "shares">): number | null {
  if (p.likes === null) return null;
  return p.likes + (p.comments ?? 0) + (p.shares ?? 0);
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`Could not ${what}: ${r.error.message}`);
  return r.data;
};

export async function runSocialRead(db: Db, job: ScheduledJob, deps: ReadDeps): Promise<JobOutcome> {
  const payload = (job.payload ?? {}) as Partial<ReadPayload>;
  const now = deps.now();
  if (!payload.profile_id) return { status: "failed", reason: "The job names no profile." };
  const profile = must(await db.from("social_profiles").select("id, client_id, competitor_id, platform, handle, url, handle_source, active, confirmed").eq("id", payload.profile_id).maybeSingle(), "read the profile") as ProfileRow | null;
  const state = payload.state ?? null;
  if (!profile || !profile.active || !isReadPlatform(profile.platform)) {
    if (state) await finishRead(db, state.read_id, { status: "skipped", reason: "profile_inactive", runs: state.runs }, now);
    return { status: "skipped", reason: profile ? "The profile is no longer read." : "The profile is gone.", payload: { profile_id: payload.profile_id, state: null } };
  }
  const reader = READERS[profile.platform];

  let apify: ApifyClient;
  try {
    apify = deps.apify(job);
  } catch (e) {
    return await noApify(db, profile, state, e, now);
  }

  try {
    if (!state) return await start(db, job, profile, reader, apify, now);
    return await look(db, job, profile, reader, apify, state, now);
  } catch (e) {
    if (e instanceof ApifyTokenMissing || e instanceof ApifyTokenRefused) return await noApify(db, profile, state, e, now);
    throw e;
  }
}

async function noApify(db: Db, profile: ProfileRow, state: ReadState | null, e: unknown, now: Date): Promise<JobOutcome> {
  const reason = e instanceof ApifyTokenRefused ? "apify_refused" : "no_apify_token";
  console.warn(`[social-read] ${profile.platform} ${profile.handle} not read: ${reason}`, e instanceof Error ? e.message : String(e));
  if (state) await finishRead(db, state.read_id, { status: "skipped", reason, runs: state.runs }, now);
  return { status: "skipped", reason, payload: { profile_id: profile.id, state: null } };
}

async function start(db: Db, job: ScheduledJob, profile: ProfileRow, reader: SocialReader, apify: ApifyClient, now: Date): Promise<JobOutcome> {
  const before = must(await db.from("social_reads").select("id").eq("profile_id", profile.id).eq("status", "done").limit(1), "read the profile's earlier reads") as unknown[];
  const window = readWindow(now, (before ?? []).length > 0);
  const read = must(await db.from("social_reads").insert({
    profile_id: profile.id, client_id: profile.client_id, job_id: job.id, status: "running", window_start: window.start, window_end: window.end, started_at: now.toISOString(),
  }).select("id").single(), "record the read") as { id: string };
  const run = await apify.startRun(reader.profileActor.id, reader.profileInput({ handle: profile.handle, url: profile.url }), { timeoutSecs: reader.profileActor.timeoutSecs, memoryMbytes: reader.profileActor.memoryMbytes });
  const state: ReadState = {
    read_id: read.id, stage: "profile", run_id: run.id, run_started_at: now.toISOString(), tries: 0, window,
    runs: [{ stage: "profile", actor: reader.profileActor.name, run_id: run.id, status: run.status, usd: null }],
  };
  await saveRuns(db, state);
  return waitAgain(profile, state, now);
}

function waitAgain(profile: ProfileRow, state: ReadState, now: Date): JobOutcome {
  return {
    status: "queued", reason: `Reading ${profile.platform} ${profile.handle}: ${state.stage} run under way.`, available_at: later(now, LOOK_AGAIN_MINUTES),
    deferred: true, payload: { profile_id: profile.id, state },
  };
}

async function look(db: Db, job: ScheduledJob, profile: ProfileRow, reader: SocialReader, apify: ApifyClient, state: ReadState, now: Date): Promise<JobOutcome> {
  const run = await apify.getRun(state.run_id);
  const late = now.getTime() - Date.parse(state.run_started_at) > GIVE_UP_MINUTES * 60_000;
  if (!isFinalRunStatus(run.status) && !late) return waitAgain(profile, state, now);
  const status = isFinalRunStatus(run.status) ? run.status : "TIMED-OUT";
  const runs = state.runs.map((r) => (r.run_id === state.run_id ? { ...r, status, usd: num(run.usageTotalUsd) } : r));
  const items = status === "SUCCEEDED" ? await apify.datasetItems(run.defaultDatasetId, { maxItems: state.stage === "profile" ? 50 : 5000 }) : null;

  if (state.stage === "profile") {
    const record = items ? reader.profile(items, { handle: profile.handle, url: profile.url }) : null;
    // A run that failed, or answered without the profile (blocked), is a read that did not happen: started again, then
    // failed. A profile still missing from a run that succeeded after the retries is not there (profile_not_found).
    if (!items || (!record && profile.confirmed !== true && state.tries < RUN_RETRIES)) return await again(db, profile, reader, apify, { ...state, runs }, now, status);
    const confirmation = confirmProfile({
      source: profile.handle_source, foundOnSite: await foundOnSite(db, profile), brand: await brandOf(db, profile),
      handle: profile.handle, record,
    });
    await recordProfile(db, profile, record, confirmation, state.read_id, now);
    if (!confirmation.confirmed) {
      await finishRead(db, state.read_id, { status: "not_confirmed", reason: confirmation.reason, runs, followers: record?.followers ?? null }, now);
      must(await db.from("social_profiles").update({ last_read_status: "not_confirmed", updated_at: now.toISOString() }).eq("id", profile.id), "record the check on the profile");
      return { status: "done", reason: `Not read: ${confirmation.reason}.`, result: { read_id: state.read_id, confirmed: false, reason: confirmation.reason }, payload: { profile_id: profile.id, state: null } };
    }
    const postsRun = await apify.startRun(reader.postsActor.id, reader.postsInput({ handle: profile.handle, url: profile.url }, state.window.start, state.window.max), { timeoutSecs: reader.postsActor.timeoutSecs, memoryMbytes: reader.postsActor.memoryMbytes });
    const next: ReadState = {
      ...state, stage: "posts", run_id: postsRun.id, run_started_at: now.toISOString(), tries: 0, record,
      runs: [...runs, { stage: "posts", actor: reader.postsActor.name, run_id: postsRun.id, status: postsRun.status, usd: null }],
    };
    await saveRuns(db, next);
    return waitAgain(profile, next, now);
  }

  if (!items) return await again(db, profile, reader, apify, { ...state, runs }, now, status);
  const posts = reader.posts(items, { handle: profile.handle, url: profile.url }).filter((p) => p.publishedAt.slice(0, 10) >= state.window.start);
  await storePosts(db, profile, state.read_id, posts, now);
  const followers = state.record?.followers ?? posts.map((p) => p.followers).find((f) => f !== null) ?? null;
  if (followers !== null) await snapshot(db, profile.id, followers, state.read_id, now);
  await finishRead(db, state.read_id, { status: "done", runs, posts: posts.length, followers }, now);
  must(await db.from("social_profiles").update({
    last_read_at: now.toISOString(), last_read_status: "done", ...(followers !== null ? { followers } : {}), updated_at: now.toISOString(),
  }).eq("id", profile.id), "record the read on the profile");
  return {
    status: "done", reason: `Read ${posts.length} posts.`, result: { read_id: state.read_id, posts: posts.length, followers, usd: totalUsd(runs) },
    payload: { profile_id: profile.id, state: null },
  };
}

/** A run that did not give its answer: started again while tries remain, else the read failed. */
async function again(db: Db, profile: ProfileRow, reader: SocialReader, apify: ApifyClient, state: ReadState, now: Date, status: string): Promise<JobOutcome> {
  if (state.tries < RUN_RETRIES) {
    const actor = state.stage === "profile" ? reader.profileActor : reader.postsActor;
    const input = state.stage === "profile"
      ? reader.profileInput({ handle: profile.handle, url: profile.url })
      : reader.postsInput({ handle: profile.handle, url: profile.url }, state.window.start, state.window.max);
    const run = await apify.startRun(actor.id, input, { timeoutSecs: actor.timeoutSecs, memoryMbytes: actor.memoryMbytes });
    const next: ReadState = {
      ...state, run_id: run.id, run_started_at: now.toISOString(), tries: state.tries + 1,
      runs: [...state.runs, { stage: state.stage, actor: actor.name, run_id: run.id, status: run.status, usd: null }],
    };
    await saveRuns(db, next);
    return waitAgain(profile, next, now);
  }
  const reason = `${state.stage}_run_${status.toLowerCase()}`;
  await finishRead(db, state.read_id, { status: "failed", reason, runs: state.runs }, now);
  must(await db.from("social_profiles").update({ last_read_status: "failed", updated_at: now.toISOString() }).eq("id", profile.id), "record the failed read on the profile");
  console.warn(`[social-read] ${profile.platform} ${profile.handle} read failed: ${reason}`);
  return { status: "done", reason: `Read failed: ${reason}.`, result: { read_id: state.read_id, failed: reason }, payload: { profile_id: profile.id, state: null } };
}

const totalUsd = (runs: RunRecord[]) => {
  const known = runs.map((r) => r.usd).filter((u): u is number => u !== null);
  return known.length ? Math.round(known.reduce((s, u) => s + u, 0) * 10_000) / 10_000 : null;
};

async function saveRuns(db: Db, state: ReadState) {
  must(await db.from("social_reads").update({ runs: state.runs }).eq("id", state.read_id), "record the read's runs");
}

async function finishRead(db: Db, readId: string, o: { status: string; reason?: string; runs: RunRecord[]; posts?: number; followers?: number | null }, now: Date) {
  must(await db.from("social_reads").update({
    status: o.status, reason: o.reason ?? null, runs: o.runs, posts: o.posts ?? null, followers: o.followers ?? null, usd: totalUsd(o.runs), finished_at: now.toISOString(),
  }).eq("id", readId), "finish the read");
}

/** The brand the profile should belong to: the competitor's name and site, or the client's. */
async function brandOf(db: Db, profile: ProfileRow): Promise<{ name: string; website: string | null }> {
  const row = profile.competitor_id
    ? must(await db.from("competitors").select("name, website_url").eq("id", profile.competitor_id).maybeSingle(), "read the competitor")
    : must(await db.from("clients").select("name, website_url").eq("id", profile.client_id).maybeSingle(), "read the client");
  return { name: String((row as { name?: string } | null)?.name ?? ""), website: (row as { website_url?: string | null } | null)?.website_url ?? null };
}

/** The brand's website links the profile: the handle was found on it (competitor), or came from the homepage's links (client). */
async function foundOnSite(db: Db, profile: ProfileRow): Promise<boolean> {
  if (!profile.competitor_id) return profile.handle_source === "website";
  if (profile.handle_source !== "auto") return false;
  const rows = must(await db.from("competitor_handles").select("handle, detection_confidence").eq("competitor_id", profile.competitor_id).eq("platform", profile.platform), "read the competitor's handles") as Array<{ handle: string | null; detection_confidence: number | string | null }> | null;
  return (rows ?? []).some((r) => String(r.handle ?? "").replace(/^@/, "").toLowerCase() === profile.handle.toLowerCase() && Number(r.detection_confidence ?? 0) >= ON_SITE_CONFIDENCE);
}

async function recordProfile(db: Db, profile: ProfileRow, record: ProfileRecord | null, c: Confirmation, readId: string, now: Date) {
  const at = now.toISOString();
  must(await db.from("social_profiles").update({
    checked_at: at, confirmed: c.confirmed, confirmed_reason: c.reason, ...(profile.confirmed !== c.confirmed ? { confirmed_at: at } : {}),
    ...(record?.name ? { display_name: record.name } : {}), ...(record?.followers != null ? { followers: record.followers } : {}), updated_at: at,
  }).eq("id", profile.id), "record the profile's check");
  if (record?.followers != null) await snapshot(db, profile.id, record.followers, readId, now);
}

async function snapshot(db: Db, profileId: string, followers: number, readId: string, now: Date) {
  must(await db.from("social_profile_snapshots").upsert({ profile_id: profileId, day: day(now), followers, read_id: readId }, { onConflict: "profile_id,day" }), "record the followers");
}

const CHUNK = 200;

/** The posts and this read's counts; a post read before keeps its row and gains a counts row. */
export async function storePosts(db: Db, profile: ProfileRow, readId: string, posts: ReadPost[], now: Date) {
  const at = now.toISOString();
  const unique = [...new Map(posts.map((p) => [p.key, p])).values()];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const rows = chunk.map((p) => ({
      profile_id: profile.id, platform: profile.platform, post_key: p.key, published_at: p.publishedAt, url: p.url, text: p.text.slice(0, TEXT_CHARS),
      format: p.format, hashtags: p.hashtags.slice(0, 30), paid: p.paid, media_url: p.mediaUrl, last_read_at: at,
    }));
    const saved = must(await db.from("social_posts").upsert(rows, { onConflict: "profile_id,post_key" }).select("id, post_key"), "store the posts") as Array<{ id: string; post_key: string }>;
    const ids = new Map((saved ?? []).map((r) => [r.post_key, r.id]));
    const metrics = chunk.filter((p) => ids.has(p.key)).map((p) => ({
      post_id: ids.get(p.key), read_id: readId, read_at: at, likes: p.likes, comments: p.comments, shares: p.shares, views: p.views, engagement: engagementOf(p),
    }));
    if (metrics.length) must(await db.from("social_post_metrics").upsert(metrics, { onConflict: "post_id,read_id" }), "store the posts' counts");
  }
}
