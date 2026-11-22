// trends_v1: one client's industry trends for one week (spec:
// docs/superpowers/specs/2026-10-28-trends-redesign-design.md, sections 2 to
// 5). App mode only; it has no n8n twin. A weekly trend_refresh job starts it
// on the client's feed weekday, linked to that week's trend_weeks row.
//
//   start          the client's profile, terms and exclusions; each watched
//                  platform's searches for the last 7 days; which platforms
//                  kept fewer than 5 posts in each of their last two weeks
//   rewrite_searches  Claude (Sonnet) rewrites a short platform's searches
//                  from the profile, one platform at a time, before any
//                  scrape (read_rewrite reads the answer; rewrite_again asks
//                  once more). The new searches are kept in the profile for
//                  the weeks to come. An answer that cannot be had or used
//                  leaves the platform's searches as they were.
//   scrape_*       one step per platform; a source that takes one search a
//                  run comes back to its own step for each search. Every
//                  answer is kept 90 days, so a replay reads it again. A
//                  source that fails twice is marked failed and the week goes on.
//   rules          the cuts in code: duplicates, outside the week, another
//                  language, own or competitor posts, past 60 per platform
//   filter         Claude (Sonnet) keeps or drops every candidate with a reason;
//                  a bad answer is asked once more, then the week keeps nothing
//   themes         Claude (Opus) groups the kept posts into 3 to 6 themes
//   save           (a week in which every watched platform failed is not saved:
//                  the run stops and the week is collected again)
//                  every post looked at, kept or dropped with its reason, the
//                  themes, each platform's status and the measured cost
//
// A failed source collected again. A week is complete only when every source
// it needs has answered; a week saved with a failed source is partial, and
// run-scheduled-jobs/trends.ts starts a run for it again (a bounded number of
// times, spaced out, never after the week is over). That run names the run
// the week was last saved from (input.replay.from_run) and the sources to ask
// (input.recollect.platforms), and differs from any other run in four steps:
//   start     the earlier run's plan, with the window's end moved to now so
//             the late source's newest posts count, and the exclusions as
//             they are now, so a theme a person dismissed since stays out
//   scrape_*  a named source: the real source (paid). Any other: the answer
//             the earlier run kept, so nothing that answered is paid for twice.
//             The sources read from kept answers go first and the named ones
//             last, so nothing is paid for before every kept answer was read
//   rules     no named source brought posts: the run ends here, before any
//             model call, and the week's posts and themes stay. A source that
//             answered with nothing is recorded as answered (output "sources")
//   save      the week written again from every source (a post is matched by
//             its link, so none is stored twice; themes made again once). A
//             week whose posts could not be judged again is not written: it
//             stays as it was saved
// Every try adds what it cost to the week's cost, once, however it ends, and
// records for each source that failed again the kind of fault and how many
// tries in a row it has been (platforms.<p>.fault): a request or an account
// the source refuses twice running is not asked again that week.
//
// What a replay may read is decided once, at start, search by search (the
// plan's `kept`): each search of each source the run does not ask either
// answered in the earlier run (its answer is kept), or failed there (a
// recorded fact about that run: the search brought nothing, and it is read as
// that, so the source's other searches and the week's other posts are kept),
// or has nothing kept at all, and then the run stops at start, before any
// paid call. The scrape steps read by that decision and never make their own.
//
// A payload that is kept and could not be read (a download that failed) is
// neither missing nor empty: the payload store throws PayloadUnread for it
// (store.ts), and no step here turns that into anything else. It never marks
// a source failed, never makes a model step give up into a saved week, and
// never stands for an empty list: the step is tried again by the runner. A
// list a step reads with a default (`?? []`) is one that may truly not have
// been kept; one the run's own state says was kept must be there.
//
// A theme a person dismissed is a recorded decision. Whenever a week is
// written again (a replay, a source collected again), the themes step is told
// the week's dismissed titles, a theme the model writes under one of them
// anyway is left out, and the dismissed rows themselves stay (the writer).

import { runActorStep, type ApifyFactory } from "../apifyStep.ts";
import { claudeBatchStep } from "../claude.ts";
import { ANTHROPIC_API_KEY, APIFY_API_TOKEN } from "../secrets.ts";
import { keptAnswer, replayOf } from "../social/replay.ts";
import { PayloadUnread, SOURCE_KEEP_DAYS } from "../store.ts";
import { StepRestart, StepStop, type PipelineDefinition, type PipelineRun, type Step, type StepContext, type StepResult } from "../types.ts";
import { competitorSet } from "../../calendar/runWeek.ts";
import { coverageShort, finishedWeeks, lastKept, parseRewrite, removedFor, removedSearches, rewriteRequest, TREND_REWRITE_MODEL, weeksAfter, withoutRemoved, type RewriteProfile } from "../../trends/coverage.ts";
import { failedSources, sourceFaultKind, type SourceFaultKind } from "../../trends/faults.ts";
import { activeTerms } from "../../trends/profile.ts";
import { fillAfter, MAX_SEARCHES, personSearches, searchesFor, TREND_SOURCES } from "../../trends/sources.ts";
import { ruleFilter, tripwire } from "../../trends/rules.ts";
import { filterRequest, parseFilter, pickKept, TREND_FILTER_MODEL, type FilterProfile } from "../../trends/filter.ts";
import { parseThemes, themesRequest, themesWanted, THEMES_MIN_KEPT, TREND_THEMES_MODEL, withoutDismissed } from "../../trends/themes.ts";
import { TREND_PLATFORMS, UNCOUNTED_PLATFORMS, type DropReason, type KeptPost, type RuleDrop, type Term, type Theme, type TrendPlatform, type TrendPost } from "../../trends/types.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const TRENDS_PIPELINE = "trends_v1";
/** A source run that fails this many times is marked failed, and the week goes on. */
export const SCRAPE_TRIES = 2;
/** A Claude step that cannot get an answer in this many tries gives up, and the week is saved without it (the runner stops a run at 5). */
export const CLAUDE_TRIES = 4;
const WINDOW_DAYS = 7;
const KEEP = { keepDays: SOURCE_KEEP_DAYS };

export interface TrendsDeps {
  apify?: ApifyFactory;
  /** For the Message Batches API calls. */
  claudeFetch?: Fetch;
}

type PlatformStatus = "ok" | "empty" | "failed" | "not_watched" | "no_searches";
/** A watched platform in one of these states is no gap in the week. */
const FINE: readonly PlatformStatus[] = ["ok", "empty", "no_searches"];

/** A platform short of kept posts in its last two weeks, whose searches the week rewrites. */
interface Shortfall {
  /** The searches that came up short. */
  last: string[];
  /** What it kept in those two weeks, newest first. */
  kept: number[];
  /** What a person added: searched first, never replaced. */
  person: string[];
  /** What a person removed: never searched. */
  removed: string[];
}

interface Plan {
  client: { name: string; language: string; languages: string[]; region?: string };
  own: { handles: string[]; names: string[] };
  competitorHandles: string[];
  window: { start: string; end: string };
  /** The Monday of the week collected; a replay keeps the week it replays. */
  weekStart?: string;
  platforms: TrendPlatform[];
  searches: Partial<Record<TrendPlatform, string[]>>;
  profile: FilterProfile;
  exclusions: Term[];
  competitors: string[];
  /** When the profile the searches come from was written: a rewrite is kept only while it stands. */
  profileWrittenAt?: string;
  /** When its hashtags were last refreshed: an Instagram rewrite is kept only while they stand. */
  profileHashtagsAt?: string;
  short?: Partial<Record<TrendPlatform, Shortfall>>;
  /** The searches the coverage rewrite gave each platform this week, in place of the profile's own terms. */
  rewritten?: Partial<Record<TrendPlatform, string[]>>;
  /** A replay's reading list, decided at start: what the earlier run holds for each search it reads from kept answers, by `<platform>.<search>` from 0. */
  kept?: Record<string, KeptSearch>;
}

/** What an earlier run holds for one search of one source: its answer, or the fact that the search failed there (with what it said). */
export type KeptSearch = { state: "answered" } | { state: "failed"; message: string };

interface TrendState {
  [key: string]: unknown;
  scrape?: Partial<Record<TrendPlatform, { i: number; rows: number; ok: number; failed: number; stalled?: boolean }>>;
  platforms?: Partial<Record<TrendPlatform, { status: PlatformStatus; searched: number; rows: number }>>;
  apifyUsd?: number;
  claude?: Record<string, { input_tokens: number; output_tokens: number }>;
  /** What kind of fault each source that failed in this run failed with (its last failed answer). */
  faults?: Partial<Record<TrendPlatform, { kind: SourceFaultKind; status: number | null }>>;
  filterTries?: number;
  themesTries?: number;
  /** The platforms whose searches are still to be rewritten, the one being asked about first. */
  rewriteQueue?: TrendPlatform[];
  rewriteTries?: number;
  filter?: "ok" | "failed" | "skipped";
  themes?: "ok" | "failed" | "skipped";
}

type Judged = { post: TrendPost | KeptPost; reason: DropReason | "below_cut" };

/**
 * Links of the posts the client's earlier weeks kept from platforms with no
 * engagement counts (UNCOUNTED_PLATFORMS): a pin lasts, so one a week kept is
 * not offered again. Weeks before `weekStart` only, so a replay of a week
 * does not count its own posts. A failed read leaves nothing out.
 */
async function keptBefore(db: Any, clientId: string, weekStart: string): Promise<string[]> {
  const { data: weeks, error } = await db.from("trend_weeks").select("id").eq("client_id", clientId).lt("week_start", weekStart);
  if (error) {
    console.warn("[trends] the earlier weeks' pins were not read:", error.message);
    return [];
  }
  const ids = (weeks ?? []).map((w: { id: string }) => w.id);
  if (!ids.length) return [];
  const { data: posts, error: postsError } = await db.from("trend_posts").select("url").in("week_id", ids).eq("kept", true).in("platform", [...UNCOUNTED_PLATFORMS]);
  if (postsError) {
    console.warn("[trends] the earlier weeks' pins were not read:", postsError.message);
    return [];
  }
  return (posts ?? []).map((p: { url: string }) => String(p.url));
}

async function need<T = Any>(ctx: StepContext, key: string): Promise<T> {
  const value = await ctx.payloads.get<T>(key);
  if (value == null) throw new Error(`The run's ${key} is missing.`);
  return value;
}

const stateOf = (ctx: StepContext): TrendState => (ctx.state ?? {}) as TrendState;

/** The client's languages: clients.language holds one code or several, comma-joined ("en,he"). */
export function languagesOf(language: unknown): string[] {
  const codes = String(language ?? "").toLowerCase().split(/[,\s]+/).map((c) => c.trim()).filter((c) => /^[a-z]{2}$/.test(c));
  return codes.length ? [...new Set(codes)] : ["en"];
}

/**
 * Two-letter codes that name a region or nothing, never one country. QA 22 Nov
 * 2026: a client whose market is "Europe" (ClientSetup's "EU") had "EU" sent
 * to TikTok and YouTube as its country.
 */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "AP", "WW", "XX", "ZZ", "AA", "QO"]);

/** The client's country for the sources that take one: the first two-letter country code of its market (UK is GB). */
function regionOf(geo: unknown): string | undefined {
  for (const part of String(geo ?? "").split(/[,\s]+/)) {
    const code = part.trim().toUpperCase();
    if (code === "UK") return "GB";
    if (/^[A-Z]{2}$/.test(code) && !NOT_COUNTRIES.has(code)) return code;
  }
  return undefined;
}

function withTokens(st: TrendState, model: string, usage: Any): TrendState {
  if (!usage) return st;
  const was = st.claude?.[model] ?? { input_tokens: 0, output_tokens: 0 };
  return { ...st, claude: { ...(st.claude ?? {}), [model]: { input_tokens: was.input_tokens + (Number(usage.input_tokens) || 0), output_tokens: was.output_tokens + (Number(usage.output_tokens) || 0) } } };
}

/**
 * When a trend week ends: the Monday after its week_start (YYYY-MM-DD, a
 * Monday in Israel time) at midnight in Israel time. Null for a value that is
 * not a date.
 */
export function trendWeekEnd(weekStart: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const nextMonday = Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000;
  if (!Number.isFinite(nextMonday)) return null;
  // Israel's offset from UTC at that moment (its clock change is at 02:00, never at midnight).
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(nextMonday)).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(nextMonday - (local - nextMonday));
}

/** What a run that collects failed sources again carries in its input (input.recollect), beside the run it reads the rest from (input.replay). */
export interface Recollect {
  /** The sources asked again; every other source is read from the run in input.replay. */
  platforms: TrendPlatform[];
  /** Which try of the week this is, from 1. */
  try: number;
}

/** The run's recollect, or null for any other run. */
export function recollectOf(run: Pick<PipelineRun, "input">): Recollect | null {
  const r = ((run.input ?? {}) as { recollect?: { platforms?: unknown; try?: unknown } | null }).recollect;
  if (!r || !Array.isArray(r.platforms)) return null;
  const platforms = TREND_PLATFORMS.filter((p) => (r.platforms as unknown[]).includes(p));
  return platforms.length ? { platforms, try: Number(r.try) || 1 } : null;
}

/** What a week cost (trend_weeks.cost). */
interface WeekCost { apify_usd?: number; claude?: Record<string, { input_tokens?: number; output_tokens?: number }>; [key: string]: unknown }

/** What the week cost so far and what a run that collected a source again cost, as one: the scraping in dollars, the model's tokens per model. */
export function addCost(before: WeekCost | null | undefined, run: WeekCost | null | undefined, runId: string): WeekCost {
  const was = before ?? {};
  // The run's cost is already in: a save tried again must not add it twice.
  if (was.recollected_by === runId) return was;
  const now = run ?? {};
  const claude: Record<string, { input_tokens: number; output_tokens: number }> = {};
  for (const tokens of [was.claude ?? {}, now.claude ?? {}]) {
    for (const [model, t] of Object.entries(tokens)) {
      const sum = claude[model] ?? { input_tokens: 0, output_tokens: 0 };
      claude[model] = { input_tokens: sum.input_tokens + (Number(t?.input_tokens) || 0), output_tokens: sum.output_tokens + (Number(t?.output_tokens) || 0) };
    }
  }
  const { replayed_from: _replayed, ...rest } = was;
  return { ...rest, apify_usd: Math.round(((Number(was.apify_usd) || 0) + (Number(now.apify_usd) || 0)) * 10000) / 10000, claude, recollected_by: runId };
}

/**
 * The fault a week's row keeps for a source that failed (platforms.<p>.fault):
 * its kind, the HTTP status when there was one, and how many tries in a row
 * (runs that collected the source again) ended with that same kind. The
 * weekly collection itself counts none. Never the source's own words.
 */
export interface SourceFaultMark { kind: SourceFaultKind; status: number | null; tries: number; by: string }

/** The mark after this run: one more try of the same kind, the first of another, or none for a run that is no try. A step tried again keeps the mark it made. */
export function nextFault(before: Partial<SourceFaultMark> | null | undefined, now: { kind: SourceFaultKind; status: number | null } | undefined, isTry: boolean, runId: string): SourceFaultMark {
  if (before?.by === runId && before.kind) return before as SourceFaultMark;
  const fault = now ?? { kind: "transient" as const, status: null };
  const tries = isTry ? (before?.kind === fault.kind ? (Number(before.tries) || 0) + 1 : 1) : 0;
  return { kind: fault.kind, status: fault.status, tries, by: runId };
}

/** Each run a platform's source makes for the plan: one for every search, or one a search (sources.ts). None for a platform the plan does not watch. */
function sourceRuns(plan: Plan, platform: TrendPlatform) {
  if (!plan.platforms.includes(platform)) return [];
  return TREND_SOURCES[platform].inputs(plan.searches[platform] ?? [], {
    region: plan.client.region, language: plan.client.language, windowStart: plan.window.start.slice(0, 10), windowEnd: plan.window.end.slice(0, 10),
  });
}

/** The sources a run visits, in order: a run that collects failed sources again reads every kept answer first and asks the named sources last. */
function scrapeOrder(run: Pick<PipelineRun, "input">): TrendPlatform[] {
  const asked = recollectOf(run)?.platforms ?? [];
  return [...TREND_PLATFORMS.filter((p) => !asked.includes(p)), ...asked];
}
const scrapeStepOf = (platform: TrendPlatform) => `scrape_${platform}`;
/** The step after a source's last search: the next source's, or the rules. */
function afterScrape(run: Pick<PipelineRun, "input">, platform: TrendPlatform): string {
  const order = scrapeOrder(run);
  const next = order[order.indexOf(platform) + 1];
  return next ? scrapeStepOf(next) : "rules";
}

/**
 * A replay's reading list: for every search of every source the run does not
 * ask, what the earlier run holds. Read from that run's own records, in this
 * order:
 *   1. its kept payloads (pipeline_payloads): `source.<p>.<i>.failed` says the
 *      search failed, `source.<p>.<i>` is its answer;
 *   2. for a search with neither (the failed mark is written after the
 *      failure and its write is not waited on), that run's step log
 *      (report_pipeline_steps): a scrape step of that source whose detail has
 *      `failed` and that search's number (`run`, from 1) says it failed.
 * A search with no record at all has nothing kept: the run stops, before any
 * paid call, and the week stays as it was saved.
 */
async function keptSearches(ctx: StepContext, fromRun: string, plan: Plan, asked: TrendPlatform[]): Promise<Record<string, KeptSearch>> {
  const { data: keys, error } = await ctx.db.from("pipeline_payloads").select("key").eq("run_id", fromRun);
  if (error) throw new Error(`Could not read what the earlier run kept: ${error.message}`);
  const keptKeys = new Set(((keys ?? []) as Array<{ key: unknown }>).map((k) => String(k.key)));
  const out: Record<string, KeptSearch> = {};
  const unknown: Array<{ platform: TrendPlatform; i: number; of: number }> = [];
  for (const platform of TREND_PLATFORMS) {
    if (asked.includes(platform)) continue;
    const runs = sourceRuns(plan, platform);
    runs.forEach((_, i) => {
      const key = `source.${platform}.${i}`;
      if (keptKeys.has(`${key}.failed`)) out[`${platform}.${i}`] = { state: "failed", message: "" };
      else if (keptKeys.has(key)) out[`${platform}.${i}`] = { state: "answered" };
      else unknown.push({ platform, i, of: runs.length });
    });
  }
  if (!unknown.length) return out;
  const { data: steps, error: stepsError } = await ctx.db.from("report_pipeline_steps").select("step, detail").eq("run_id", fromRun);
  if (stepsError) throw new Error(`Could not read the earlier run's steps: ${stepsError.message}`);
  const missing: string[] = [];
  for (const u of unknown) {
    const logged = ((steps ?? []) as Array<{ step: unknown; detail: Record<string, unknown> | null }>).find((row) =>
      row.step === scrapeStepOf(u.platform) && typeof row.detail?.failed === "string" && Number(row.detail?.run) === u.i + 1);
    if (logged) out[`${u.platform}.${u.i}`] = { state: "failed", message: String(logged.detail!.failed) };
    else missing.push(`${u.platform} search ${u.i + 1} of ${u.of}`);
  }
  if (missing.length) throw new StepStop(`The earlier run kept no answer for ${missing.join(", ")}, so the week is not written again.`);
  return out;
}

/**
 * The week's status once the given sources no longer count as failed, its
 * posts and themes unchanged: done when no source is left failed and nothing
 * else kept the week partial (its filter answered, and it has themes or too
 * few kept posts to make any); else partial.
 */
async function statusWithout(ctx: StepContext, answered: TrendPlatform[]): Promise<"done" | "partial"> {
  const weekId = ctx.run.real_id;
  const { data: week, error } = await ctx.db.from("trend_weeks").select("platforms, filter_status").eq("id", weekId).maybeSingle();
  if (error || !week) throw new Error(`Could not read the week: ${error?.message ?? "not found"}`);
  const stillFailed = failedSources(week.platforms).filter((p) => !answered.includes(p));
  if (stillFailed.length || week.filter_status === "failed") return "partial";
  const { data: kept, error: keptError } = await ctx.db.from("trend_posts").select("id").eq("week_id", weekId).eq("kept", true).limit(THEMES_MIN_KEPT);
  if (keptError) throw new Error(`Could not read the week's kept posts: ${keptError.message}`);
  if ((kept ?? []).length < THEMES_MIN_KEPT) return "done";
  const { data: themes, error: themesError } = await ctx.db.from("trend_themes").select("id").eq("week_id", weekId).limit(1);
  if (themesError) throw new Error(`Could not read the week's themes: ${themesError.message}`);
  return (themes ?? []).length ? "done" : "partial";
}

/** A trends run is for its week: a wait for an account cannot pass the week's end. */
const trendRunHorizon = (run: Pick<PipelineRun, "input">): Date | null => trendWeekEnd(String((run.input as { week_start?: unknown } | null)?.week_start ?? ""));

export function trendsPipeline(deps: TrendsDeps = {}): PipelineDefinition {
  const scrapeStep = (platform: TrendPlatform) => async (ctx: StepContext): Promise<StepResult> => {
    const next = afterScrape(ctx.run, platform);
    const plan = await need<Plan>(ctx, "plan");
    const st = stateOf(ctx);
    const runs = sourceRuns(plan, platform);
    if (!runs.length) {
      const status: PlatformStatus = plan.platforms.includes(platform) ? "no_searches" : "not_watched";
      return { type: "next", step: next, state: { ...st, platforms: { ...(st.platforms ?? {}), [platform]: { status, searched: 0, rows: 0 } } }, detail: { platform, status } };
    }
    const prog = { ...(st.scrape?.[platform] ?? { i: 0, rows: 0, ok: 0, failed: 0 }) };
    // A source whose searches are all done is not gone through again (a run under way when the order of sources changed comes back to one).
    if (prog.i >= runs.length) return { type: "next", step: next, state: st, detail: { platform, already: true } };
    const run = runs[prog.i];
    const key = `source.${platform}.${prog.i}`;
    let usd = 0;
    let fault: { kind: SourceFaultKind; status: number | null } | null = null;
    let detail: Record<string, unknown> = { platform, run: prog.i + 1, of: runs.length };
    // Everything that reads this run's answer is inside the try: whatever goes
    // wrong with one source marks that source failed, and the week goes on.
    try {
      let rows: unknown[] | null = null;
      // A replay reads every answer the earlier run kept. A run that collects failed sources again
      // reads them too, except for the sources it names: those are asked for real.
      const replay = replayOf(ctx);
      if (replay && !recollectOf(ctx.run)?.platforms.includes(platform)) {
        // What to read was decided at start (plan.kept). A run started before that list was kept decides now, the same way.
        const list = plan.kept ?? await keptSearches(ctx, replay.from_run, plan, recollectOf(ctx.run)?.platforms ?? []);
        const held = list[`${platform}.${prog.i}`];
        if (!held) throw new StepStop(`The run has no record of what the earlier run kept for ${platform} search ${prog.i + 1} of ${runs.length}, so the week is not written again.`);
        if (held.state === "failed") {
          // The search failed in the earlier run: it is read as what it was, a search that brought nothing.
          const marker = await keptAnswer<{ message?: unknown }>(ctx, `${key}.failed`);
          const message = (typeof marker?.message === "string" && marker.message ? marker.message : held.message).slice(0, 300);
          await ctx.payloads.put(`${key}.failed`, { message }, KEEP);
          fault = sourceFaultKind(message);
          detail = { ...detail, replayed: true, failed: message };
        } else {
          // The answer is kept. A read that fails throws (PayloadUnread) and the step is tried again; only an answer
          // that is gone since start decided (the earlier run's payloads were removed) comes back as nothing.
          const kept = await keptAnswer<unknown[]>(ctx, key);
          if (!Array.isArray(kept)) throw new StepStop(`The answer the earlier run kept for ${platform} search ${prog.i + 1} of ${runs.length} is no longer kept, so the week is not written again.`);
          rows = kept;
          await ctx.payloads.put(key, rows, KEEP);
          detail = { ...detail, replayed: true };
        }
      } else {
        // QA 22 Nov 2026: a try the runner failed itself (a run that never
        // finished within the poll limit, or a step past its time) never reached
        // this step's catch, so a hung source was started again on every try
        // until the run stopped at 12 hours and the week was not saved. Past its
        // tries the search fails here like any other, and once one search of a
        // source has, the source's other searches are not asked this week.
        if (prog.stalled) throw new Error(`The ${platform} source did not finish an earlier search this week.`);
        if (ctx.attempt > SCRAPE_TRIES && (ctx.runnerFailed ?? 0) > 0) {
          prog.stalled = true;
          throw new Error(`The ${platform} source did not finish in ${SCRAPE_TRIES} tries.`);
        }
        const actor = await runActorStep(ctx, { actor: TREND_SOURCES[platform].actor, input: run.input, datasetKey: key, keepDays: SOURCE_KEEP_DAYS, apify: deps.apify });
        if (actor.type === "wait") return actor.result;
        // A run that took every search and brought back nothing at all may have
        // been turned away (20 Oct 2026, TikTok); it gets one more run before
        // "empty" stands. One narrow search with nothing new this week is normal.
        if (!actor.rows.length && run.search === "" && ctx.attempt < SCRAPE_TRIES) throw new StepRestart(`The ${platform} source brought back nothing (run ${actor.runId}).`);
        rows = actor.rows;
        usd = Number(actor.usageUsd) || 0;
        detail = { ...detail, apify_run_id: actor.runId, rows: rows.length };
      }
      if (rows) {
        const found = rows.map((r, i) => TREND_SOURCES[platform].normalize(r, run.search, i + 1)).filter((p): p is TrendPost => p !== null);
        const sofar = (await ctx.payloads.get<TrendPost[]>(`posts.${platform}`)) ?? [];
        await ctx.payloads.put(`posts.${platform}`, [...sofar, ...found]);
        prog.rows += found.length;
        prog.ok += 1;
      } else {
        prog.failed += 1;
      }
    } catch (e) {
      // A stop, and a payload that could not be read, are not this source failing: the first ends the run, the second is tried again.
      if (e instanceof StepStop || e instanceof PayloadUnread || (ctx.attempt < SCRAPE_TRIES && !prog.stalled)) throw e;
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      // The failed search is a fact a replay reads: here, and in this step's log (detail.failed with the search's number), which keptSearches falls back on.
      await ctx.payloads.put(`${key}.failed`, { message }, KEEP).catch(() => undefined);
      prog.failed += 1;
      fault = sourceFaultKind(message);
      detail = { ...detail, failed: message };
    }
    prog.i += 1;
    const moved: TrendState = {
      ...st, apifyUsd: (st.apifyUsd ?? 0) + usd, scrape: { ...(st.scrape ?? {}), [platform]: prog },
      ...(fault ? { faults: { ...(st.faults ?? {}), [platform]: fault } } : {}),
    };
    if (prog.i < runs.length) return { type: "next", step: ctx.step, state: moved, detail };
    const status: PlatformStatus = prog.ok === 0 ? "failed" : prog.rows === 0 ? "empty" : "ok";
    return { type: "next", step: next, state: { ...moved, platforms: { ...(moved.platforms ?? {}), [platform]: { status, searched: runs.length, rows: prog.rows } } }, detail: { ...detail, status } };
  };

  const candidatesOf = (ctx: StepContext) => need<TrendPost[]>(ctx, "candidates");

  /** The titles of the themes a person dismissed for the run's week: none on a week's first write. */
  const dismissedTitles = async (ctx: StepContext): Promise<string[]> => {
    const { data, error } = await ctx.db.from("trend_themes").select("title").eq("week_id", ctx.run.real_id).not("dismissed_at", "is", null);
    if (error) throw new Error(`Could not read the week's dismissed themes: ${error.message}`);
    return ((data ?? []) as Array<{ title: unknown }>).map((t) => String(t.title ?? "")).filter(Boolean);
  };

  /** What this run cost so far: the scraping in dollars and the model's tokens per model. */
  const runCost = (st: TrendState): WeekCost => ({ apify_usd: Math.round((st.apifyUsd ?? 0) * 10000) / 10000, claude: st.claude ?? {} });

  /**
   * What a run that collected failed sources again records when it ends
   * without writing the week: what the week has cost with this try in it, and
   * for each named source that failed again, the fault and how many tries in
   * a row it has been. `answered`: the named sources that answered with no posts.
   */
  const recordTry = async (ctx: StepContext, recollect: Recollect, answered: TrendPlatform[] = []): Promise<void> => {
    const st = stateOf(ctx);
    const { data: week, error } = await ctx.db.from("trend_weeks").select("cost, platforms").eq("id", ctx.run.real_id).maybeSingle();
    if (error || !week) throw new Error(`Could not read the week: ${error?.message ?? "not found"}`);
    const stored = (week.platforms ?? {}) as Record<string, { fault?: Partial<SourceFaultMark> } | undefined>;
    const platforms: Record<string, Record<string, unknown>> = {};
    for (const p of recollect.platforms) {
      const now = st.platforms?.[p];
      if (answered.includes(p)) platforms[p] = { status: now?.status, searched: now?.searched ?? 0, rows: now?.rows ?? 0, candidates: 0, kept: 0, fault: null };
      else if ((now?.status ?? "failed") === "failed") platforms[p] = { fault: nextFault(stored[p]?.fault, st.faults?.[p], true, ctx.run.id) };
    }
    await ctx.output.write("sources", {
      platforms, cost: addCost(week.cost as WeekCost, runCost(st), ctx.run.id),
      ...(answered.length ? { status: await statusWithout(ctx, answered), finished_at: ctx.now().toISOString() } : {}),
    });
  };
  const apiKey = (ctx: StepContext) => String(ctx.env(ANTHROPIC_API_KEY) ?? "");

  /** The second ask carries the first answer and its problems, so Claude fixes what was wrong. */
  const repaired = async (ctx: StepContext, body: Record<string, unknown>, first: string): Promise<Record<string, unknown>> => {
    const answer = await need<{ text: string }>(ctx, first);
    const problems = (await ctx.payloads.get<string>(`${first}.problems`)) ?? "The answer could not be read.";
    return { ...body, messages: [...(body.messages as unknown[]), { role: "assistant", content: answer.text }, {
      role: "user", content: `That answer has these problems: ${problems} Send the whole JSON object again with them fixed.`,
    }] };
  };

  /** A Claude step that cannot get an answer in CLAUDE_TRIES gives up into a saved week instead of stopping the run. */
  const orGiveUp = (inner: Step, giveUp: (ctx: StepContext, why: string) => Promise<StepResult>): Step => async (ctx) => {
    // QA 22 Nov 2026: tries the runner failed itself (a batch pending past the poll limit, a step past its time) count too.
    if (ctx.attempt > CLAUDE_TRIES && (ctx.runnerFailed ?? 0) > 0) return giveUp(ctx, `Claude did not answer in ${CLAUDE_TRIES} tries.`);
    try {
      return await inner(ctx);
    } catch (e) {
      // A payload that could not be read is no answer the model failed to give: the step is tried again, never given up on.
      if (e instanceof PayloadUnread || ctx.attempt < CLAUDE_TRIES) throw e;
      return giveUp(ctx, (e instanceof Error ? e.message : String(e)).slice(0, 300));
    }
  };
  const filterGiveUp = async (ctx: StepContext, why: string): Promise<StepResult> => {
    await ctx.payloads.put("kept", []);
    await ctx.payloads.put("claude_dropped", []);
    return { type: "next", step: "save", state: { ...stateOf(ctx), filter: "failed", themes: "skipped" }, detail: { gave_up: why } };
  };
  const themesGiveUp = async (ctx: StepContext, why: string): Promise<StepResult> => {
    await ctx.payloads.put("themes", []);
    return { type: "next", step: "save", state: { ...stateOf(ctx), themes: "failed" }, detail: { gave_up: why } };
  };

  const filterStep = (saveAs: string, again: boolean) => orGiveUp(claudeBatchStep({
    async build(ctx) {
      const [plan, candidates] = await Promise.all([need<Plan>(ctx, "plan"), candidatesOf(ctx)]);
      const body = filterRequest(plan.profile, plan.exclusions, candidates);
      return { apiKey: apiKey(ctx), body: again ? await repaired(ctx, body, "answer.filter") : body };
    },
    saveAs, keepDays: KEEP.keepDays, next: "read_filter", fetchImpl: deps.claudeFetch,
  }), filterGiveUp);

  const themesStep = (saveAs: string, again: boolean) => orGiveUp(claudeBatchStep({
    async build(ctx) {
      const [plan, kept, dismissed] = await Promise.all([need<Plan>(ctx, "plan"), need<KeptPost[]>(ctx, "kept"), dismissedTitles(ctx)]);
      const body = themesRequest(plan.profile, kept, dismissed);
      return { apiKey: apiKey(ctx), body: again ? await repaired(ctx, body, "answer.themes") : body };
    },
    saveAs, keepDays: KEEP.keepDays, next: "read_themes", fetchImpl: deps.claudeFetch,
  }), themesGiveUp);

  const order = TREND_PLATFORMS.map((p) => `scrape_${p}`);

  // The coverage rewrite: one request per platform, each answer under its own name.
  const rewriteKey = (platform: TrendPlatform, again: boolean) => `answer.rewrite${again ? "_again" : ""}.${platform}`;
  const rewriteProfile = (plan: Plan): RewriteProfile => ({ ...plan.profile, languages: plan.client.languages, region: plan.client.region, exclusions: plan.exclusions });
  /** On to the next platform to rewrite, or to the first scrape. */
  const nextRewrite = (st: TrendState, detail: Record<string, unknown>): StepResult => {
    const queue = (st.rewriteQueue ?? []).slice(1);
    return { type: "next", step: queue.length ? "rewrite_searches" : order[0], state: { ...st, rewriteQueue: queue, rewriteTries: 0 }, detail };
  };
  /** A rewrite that cannot be had leaves the platform's searches as they were, and the week goes on. */
  const rewriteGiveUp = (ctx: StepContext, why: string): Promise<StepResult> =>
    Promise.resolve(nextRewrite(stateOf(ctx), { platform: stateOf(ctx).rewriteQueue?.[0], kept_searches: true, gave_up: why }));
  const rewriteStep = (again: boolean): Step => (ctx) => {
    const platform = stateOf(ctx).rewriteQueue?.[0];
    if (!platform) return Promise.resolve(nextRewrite(stateOf(ctx), {}));
    return orGiveUp(claudeBatchStep({
      async build(ctx) {
        const plan = await need<Plan>(ctx, "plan");
        const short = plan.short?.[platform];
        if (!short) throw new Error(`The plan has no shortfall for ${platform}.`);
        const body = rewriteRequest(rewriteProfile(plan), platform, short.last, short.kept, { keep: short.person, avoid: short.removed });
        return { apiKey: apiKey(ctx), body: again ? await repaired(ctx, body, rewriteKey(platform, false)) : body };
      },
      saveAs: rewriteKey(platform, again), keepDays: KEEP.keepDays, next: "read_rewrite", fetchImpl: deps.claudeFetch,
    }), rewriteGiveUp)(ctx);
  };
  const scrapeSteps = Object.fromEntries(TREND_PLATFORMS.map((p) => [scrapeStepOf(p), scrapeStep(p)]));

  return {
    name: TRENDS_PIPELINE,
    kind: "trends",
    modes: ["app"],
    appCapable: true,
    secrets: [APIFY_API_TOKEN, ANTHROPIC_API_KEY],
    // A week that is over is closed by the weekly enqueue, never collected late.
    waitHorizon: trendRunHorizon,
    first: "start",
    steps: {
      async start(ctx) {
        const recollect = recollectOf(ctx.run);
        // Without the earlier run a whole new week would be planned, and every source paid for.
        if (recollect && !replayOf(ctx)) throw new StepStop("A run that collects a failed source again must name the run the week was saved from.");
        // A replay reads the week again as it was: the same window, searches and profile.
        if (replayOf(ctx)) {
          const kept = await keptAnswer<Plan>(ctx, "plan");
          if (!kept) throw new Error("The replayed run kept no plan.");
          // What the run may read from the earlier one is decided here, once, search by search, before any paid call:
          // a search with nothing kept stops the run now, and the week stays as it was saved.
          const list = await keptSearches(ctx, replayOf(ctx)!.from_run, kept, recollect?.platforms ?? []);
          if (!recollect) {
            await ctx.payloads.put("plan", { ...kept, kept: list }, KEEP);
            return { type: "next", step: order[0], state: {}, detail: { replayed: true, platforms: kept.platforms } };
          }
          // A failed source collected again: the window ends now, so its newest posts count, and what
          // people excluded since the week was saved (a dismissed theme becomes an exclusion) is read again.
          const { exclusions } = await activeTerms(ctx.db, ctx.run.client_id);
          await ctx.payloads.put("plan", { ...kept, kept: list, exclusions, window: { ...kept.window, end: ctx.now().toISOString() } }, KEEP);
          // Kept answers are read first, the named sources asked last.
          return { type: "next", step: scrapeStepOf(scrapeOrder(ctx.run)[0]), state: {}, detail: { recollect: recollect.platforms, try: recollect.try, platforms: kept.platforms } };
        }
        const clientId = ctx.run.client_id;
        const { data: client, error } = await ctx.db.from("clients").select("id, name, geo, language").eq("id", clientId).maybeSingle();
        if (error || !client) throw new Error(`The client could not be read: ${error?.message ?? "not found"}`);
        const { data: profile } = await ctx.db.from("trend_profiles").select("audience, fit_rubric, platforms, search_overrides, written_at, hashtags_at").eq("client_id", clientId).maybeSingle();
        if (!profile) throw new Error("The client has no trend profile yet.");
        const terms = await activeTerms(ctx.db, clientId);
        const removed = await removedSearches(ctx.db, clientId);
        const competitors = await competitorSet(ctx.db, clientId).catch(() => []);
        const { data: ownRows } = await ctx.db.from("sprout_profiles").select("native_name, profile_name, is_active").eq("client_id", clientId);
        const { data: rivalRows } = await ctx.db.from("competitor_handles").select("handle, display_name, is_active").eq("client_id", clientId);
        const own = ((ownRows ?? []) as Any[]).filter((r) => r.is_active !== false);
        const rivals = ((rivalRows ?? []) as Any[]).filter((r) => r.is_active !== false);
        const competitorNames = [...new Set([...competitors.map((c) => c.name), ...rivals.map((r) => String(r.display_name ?? ""))].filter(Boolean))];
        const languages = languagesOf(client.language);
        const platforms = [...new Set(((profile.platforms ?? []) as Array<{ platform: string }>).map((p) => p.platform))].filter((p): p is TrendPlatform => (TREND_PLATFORMS as readonly string[]).includes(p));
        const end = ctx.now();
        const weekStart = String(ctx.run.input?.week_start ?? end.toISOString().slice(0, 10));
        const overrides = withoutRemoved(profile.search_overrides ?? {}, removed);
        const searches: Plan["searches"] = Object.fromEntries(platforms.map((p) => [p, searchesFor(p, terms, overrides, weekStart)]));
        // Coverage: a platform short of kept posts in its last two weeks on this profile gets its searches rewritten.
        // Instagram searches by the profile's hashtags, so only weeks made after their last refresh count for it
        // (a new profile's hashtags_at is its written_at).
        const profileWrittenAt = String(profile.written_at ?? "");
        const profileHashtagsAt = String(profile.hashtags_at ?? "");
        const profileWeeks = await finishedWeeks(ctx.db, clientId, { before: weekStart, since: profileWrittenAt });
        const short: Partial<Record<TrendPlatform, Shortfall>> = {};
        for (const p of platforms) {
          const weeks = p === "instagram" ? weeksAfter(profileWeeks, profileHashtagsAt) : profileWeeks;
          const person = personSearches(p, terms);
          // A platform whose places are all a person's has nothing to rewrite.
          if (!coverageShort(weeks, p) || person.length >= MAX_SEARCHES) continue;
          short[p] = { last: searches[p] ?? [], kept: lastKept(weeks, p), person, removed: removedFor(p, removed) };
        }
        const rewrite = Object.keys(short) as TrendPlatform[];
        const plan: Plan = {
          client: { name: String(client.name ?? ""), language: languages[0], languages, region: regionOf(client.geo) },
          own: { handles: own.map((r) => String(r.native_name ?? "")).filter(Boolean), names: own.map((r) => String(r.profile_name ?? "")).filter(Boolean) },
          competitorHandles: rivals.map((r) => String(r.handle ?? "")).filter(Boolean),
          window: { start: new Date(end.getTime() - WINDOW_DAYS * 86_400_000).toISOString(), end: end.toISOString() },
          weekStart,
          platforms,
          searches,
          profile: { audience: String(profile.audience), fit_rubric: String(profile.fit_rubric), topics: terms.topics, brand: String(client.name ?? ""), competitors: competitorNames },
          exclusions: terms.exclusions,
          competitors: competitorNames,
          profileWrittenAt,
          profileHashtagsAt,
          ...(rewrite.length ? { short } : {}),
        };
        await ctx.payloads.put("plan", plan, KEEP);
        const detail = { platforms, topics: terms.topics.length, ...(rewrite.length ? { rewrite } : {}) };
        if (rewrite.length) return { type: "next", step: "rewrite_searches", state: { rewriteQueue: rewrite }, detail };
        return { type: "next", step: order[0], state: {}, detail };
      },

      rewrite_searches: rewriteStep(false),
      rewrite_again: rewriteStep(true),

      async read_rewrite(ctx) {
        const st = stateOf(ctx);
        const platform = st.rewriteQueue?.[0];
        if (!platform) return nextRewrite(st, {});
        const tries = st.rewriteTries ?? 0;
        const answer = await need<{ text: string; usage?: Any }>(ctx, rewriteKey(platform, tries > 0));
        const counted = withTokens(st, TREND_REWRITE_MODEL, answer.usage);
        const plan = await need<Plan>(ctx, "plan");
        const short = plan.short?.[platform];
        if (!short) return nextRewrite(counted, { platform, kept_searches: true });
        const got = parseRewrite(answer.text, { platform, brand: plan.profile.brand, competitors: plan.profile.competitors, last: short.last, keep: short.person, avoid: short.removed });
        if ("error" in got) {
          if (tries === 0) {
            await ctx.payloads.put(`${rewriteKey(platform, false)}.problems`, got.error.slice(0, 4000));
            return { type: "next", step: "rewrite_again", state: { ...counted, rewriteTries: 1 }, detail: { platform, problems: got.error.slice(0, 300) } };
          }
          return nextRewrite(counted, { platform, kept_searches: true, problems: got.error.slice(0, 300) });
        }
        // Kept in the profile for the weeks to come, and searched from this week's scrape on, after what a person added.
        await ctx.output.write("searches", { platform, searches: got.value, profile_written_at: plan.profileWrittenAt, profile_hashtags_at: plan.profileHashtagsAt });
        const searches = fillAfter(short.person, got.value);
        await ctx.payloads.put("plan", { ...plan, searches: { ...plan.searches, [platform]: searches }, rewritten: { ...(plan.rewritten ?? {}), [platform]: got.value } }, KEEP);
        return nextRewrite(counted, { platform, searches });
      },

      ...scrapeSteps,

      async rules(ctx) {
        const recollect = recollectOf(ctx.run);
        // A run that collected failed sources again goes on only when one of them brought posts:
        // then the week is judged again and its themes are made again, once.
        if (recollect) {
          const tally = stateOf(ctx).platforms ?? {};
          const statusOf = (p: TrendPlatform): PlatformStatus => tally[p]?.status ?? "failed";
          if (!recollect.platforms.some((p) => statusOf(p) === "ok")) {
            // No new post, so no model is asked and the week's posts and themes stay. A source that answered with nothing
            // is no longer a gap; one that failed again keeps its fault; and what the try cost is added to the week's.
            const answered = recollect.platforms.filter((p) => FINE.includes(statusOf(p)));
            await recordTry(ctx, recollect, answered);
            return { type: "done", detail: { recollect: answered.length ? "answered with no posts" : "no answer", try: recollect.try, platforms: Object.fromEntries(recollect.platforms.map((p) => [p, statusOf(p)])) } };
          }
        }
        const plan = await need<Plan>(ctx, "plan");
        const all: TrendPost[] = [];
        // A source that brought posts kept them; one that was not searched, or whose every search failed, kept none.
        for (const p of TREND_PLATFORMS) {
          all.push(...(stateOf(ctx).platforms?.[p]?.status === "ok" ? await need<TrendPost[]>(ctx, `posts.${p}`) : (await ctx.payloads.get<TrendPost[]>(`posts.${p}`)) ?? []));
        }
        const weekStart = plan.weekStart ?? String(ctx.run.input?.week_start ?? plan.window.end.slice(0, 10));
        const { candidates, dropped } = ruleFilter(all, {
          windowStart: plan.window.start, windowEnd: plan.window.end, languages: plan.client.languages,
          ownHandles: plan.own.handles, ownNames: [plan.client.name, ...plan.own.names], competitorHandles: plan.competitorHandles, competitorNames: plan.competitors,
          keptBefore: await keptBefore(ctx.db, ctx.run.client_id, weekStart),
        });
        await ctx.payloads.put("candidates", candidates);
        await ctx.payloads.put("rule_dropped", dropped);
        const detail = { posts: all.length, candidates: candidates.length };
        if (!candidates.length) return { type: "next", step: "save", state: { ...stateOf(ctx), filter: "skipped", themes: "skipped" }, detail };
        return { type: "next", step: "filter", detail };
      },

      filter: filterStep("answer.filter", false),
      filter_again: filterStep("answer.filter_again", true),

      async read_filter(ctx) {
        const st = stateOf(ctx);
        const tries = st.filterTries ?? 0;
        const answer = await need<{ text: string; usage?: Any }>(ctx, tries === 0 ? "answer.filter" : "answer.filter_again");
        const counted = withTokens(st, TREND_FILTER_MODEL, answer.usage);
        const got = parseFilter(answer.text, await candidatesOf(ctx));
        if ("error" in got) {
          if (tries === 0) {
            await ctx.payloads.put("answer.filter.problems", got.error.slice(0, 4000));
            return { type: "next", step: "filter_again", state: { ...counted, filterTries: 1 }, detail: { problems: got.error.slice(0, 300) } };
          }
          await ctx.payloads.put("kept", []);
          await ctx.payloads.put("claude_dropped", []);
          return { type: "next", step: "save", state: { ...counted, filter: "failed", themes: "skipped" }, detail: { problems: got.error.slice(0, 300) } };
        }
        const picked = pickKept(got.value.kept);
        const pickedUrls = new Set(picked.map((p) => p.url));
        const judged: Judged[] = [...got.value.dropped, ...got.value.kept.filter((p) => !pickedUrls.has(p.url)).map((post) => ({ post, reason: "below_cut" as const }))];
        await ctx.payloads.put("kept", picked);
        await ctx.payloads.put("claude_dropped", judged);
        const next = themesWanted(picked) ? "themes" : "save";
        return { type: "next", step: next, state: { ...counted, filter: "ok", ...(next === "save" ? { themes: "skipped" as const } : {}) }, detail: { kept: picked.length, dropped: judged.length } };
      },

      themes: themesStep("answer.themes", false),
      themes_again: themesStep("answer.themes_again", true),

      async read_themes(ctx) {
        const st = stateOf(ctx);
        const tries = st.themesTries ?? 0;
        const answer = await need<{ text: string; usage?: Any }>(ctx, tries === 0 ? "answer.themes" : "answer.themes_again");
        const counted = withTokens(st, TREND_THEMES_MODEL, answer.usage);
        const got = parseThemes(answer.text, await need<KeptPost[]>(ctx, "kept"));
        if ("error" in got) {
          if (tries === 0) {
            await ctx.payloads.put("answer.themes.problems", got.error.slice(0, 4000));
            return { type: "next", step: "themes_again", state: { ...counted, themesTries: 1 }, detail: { problems: got.error.slice(0, 300) } };
          }
          await ctx.payloads.put("themes", []);
          return { type: "next", step: "save", state: { ...counted, themes: "failed" }, detail: { problems: got.error.slice(0, 300) } };
        }
        // A theme the model wrote under a title a person dismissed for this week is left out.
        const themes = withoutDismissed(got.value, await dismissedTitles(ctx));
        await ctx.payloads.put("themes", themes);
        return { type: "next", step: "save", state: { ...counted, themes: "ok" }, detail: { themes: themes.length, ...(themes.length < got.value.length ? { dismissed_left_out: got.value.length - themes.length } : {}) } };
      },

      async save(ctx) {
        const st = stateOf(ctx);
        const recollect = recollectOf(ctx.run);
        // A source answered late, but the week's posts could not be judged again: the week on
        // screen is worth more than one written again with nothing in it, so it stays as saved.
        if (recollect && (st.filter === "failed" || st.themes === "failed")) {
          // What the try cost is recorded all the same.
          await recordTry(ctx, recollect);
          throw new StepStop("The week's posts could not be judged again after a source answered, so the week stays as it was saved.");
        }
        const plan = await need<Plan>(ctx, "plan");
        // The rules step always keeps its two lists. The filter's and the themes' are kept only when those steps ran:
        // a default stands for a step that was skipped, never for a list the run made and could not read back.
        const ruleDropped = await need<Array<{ post: TrendPost; reason: RuleDrop }>>(ctx, "rule_dropped");
        const candidates = await need<TrendPost[]>(ctx, "candidates");
        const kept = st.filter === "ok" || st.filter === "failed" ? await need<KeptPost[]>(ctx, "kept") : (await ctx.payloads.get<KeptPost[]>("kept")) ?? [];
        const judged = st.filter === "ok" || st.filter === "failed" ? await need<Judged[]>(ctx, "claude_dropped") : (await ctx.payloads.get<Judged[]>("claude_dropped")) ?? [];
        const themes = st.themes === "ok" || st.themes === "failed" ? await need<Theme[]>(ctx, "themes") : (await ctx.payloads.get<Theme[]>("themes")) ?? [];

        // One row per post: a post found twice is the same post, so a duplicate is not stored again.
        const rows: Any[] = [];
        const seen = new Set<string>();
        const add = (p: TrendPost, extra: Record<string, unknown>) => {
          if (seen.has(p.url)) return;
          seen.add(p.url);
          rows.push({ ...p, ...extra });
        };
        for (const p of kept) add(p, { kept: true, drop_reason: null, tripwire: tripwire(p.text) });
        for (const j of judged) add(j.post, { kept: false, drop_reason: j.reason });
        if (st.filter === "failed") for (const p of candidates) add(p, { kept: false, drop_reason: null });
        for (const d of ruleDropped) if (d.reason !== "duplicate") add(d.post, { kept: false, drop_reason: d.reason });

        // What the week has stored so far: read only by a run that collected failed sources again (its cost, and each source's fault).
        let before: { cost?: WeekCost; platforms?: Record<string, { fault?: Partial<SourceFaultMark> } | undefined> } | null = null;
        if (recollect) {
          const { data: week, error } = await ctx.db.from("trend_weeks").select("cost, platforms").eq("id", ctx.run.real_id).maybeSingle();
          if (error) throw new Error(`Could not read what the week holds so far: ${error.message}`);
          before = week;
        }
        const platforms: Record<string, Record<string, unknown>> = {};
        for (const p of TREND_PLATFORMS) {
          const s = st.platforms?.[p] ?? { status: "not_watched", searched: 0, rows: 0 };
          // A source that failed: the kind of fault, and how many tries in a row it has been. Only a run that asked the
          // source again is a try (none yet on the weekly collection); a source this run read from kept answers keeps
          // the mark the week has for it.
          const marked = before?.platforms?.[p]?.fault;
          const asked = !!recollect?.platforms.includes(p);
          const fault = recollect && !asked && marked ? marked : nextFault(marked, st.faults?.[p], asked, ctx.run.id);
          platforms[p] = {
            ...s, candidates: candidates.filter((c) => c.platform === p).length, kept: kept.filter((k) => k.platform === p).length,
            // The week ran on searches the coverage rewrite gave it: the next week waits for a second week on them.
            ...(plan.rewritten?.[p] ? { rewritten: true } : {}),
            ...(s.status === "failed" ? { fault } : {}),
          };
        }
        // A week in which every watched platform failed brought nothing back. It
        // is not saved as a week: the run stops at once (saving again cannot
        // help), the week stays running, and the stopped-run rule of the weekly
        // enqueue collects it again.
        if (plan.platforms.length && plan.platforms.every((p) => st.platforms?.[p]?.status === "failed")) {
          throw new StepStop(`Every watched platform failed (${plan.platforms.join(", ")}), so the week is not saved.`);
        }
        const watchedOk = plan.platforms.every((p) => FINE.includes(st.platforms?.[p]?.status as PlatformStatus));
        const status = watchedOk && st.filter !== "failed" && st.themes !== "failed" ? "done" : "partial";
        // A replay scraped nothing: the week keeps the scraping cost of the run it replays.
        let apifyUsd = st.apifyUsd ?? 0;
        const replay = recollect ? null : replayOf(ctx);
        if (replay) {
          const { data: source } = await ctx.db.from("report_pipeline_runs").select("real_id").eq("id", replay.from_run).maybeSingle();
          const { data: sourceWeek } = source?.real_id ? await ctx.db.from("trend_weeks").select("cost").eq("id", source.real_id).maybeSingle() : { data: null };
          apifyUsd = Number(sourceWeek?.cost?.apify_usd) || 0;
        }
        let cost: WeekCost = { apify_usd: Math.round(apifyUsd * 10000) / 10000, claude: st.claude ?? {}, ...(replay ? { replayed_from: replay.from_run } : {}) };
        // A failed source collected again: what this run cost is added to what the week had cost.
        if (recollect) cost = addCost(before?.cost, cost, ctx.run.id);
        await ctx.output.write("week", {
          posts: rows, themes, status, platforms, filter_status: st.filter ?? "skipped", cost,
          finished_at: ctx.now().toISOString(),
        });
        return { type: "done", detail: { status, kept: kept.length, themes: themes.length, posts: rows.length } };
      },
    },
  };
}
