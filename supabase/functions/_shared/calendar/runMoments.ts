// supabase/functions/_shared/calendar/runMoments.ts
//
// The seasonal moments' jobs (Lital, 3 Nov 2026), run by run-scheduled-jobs.
// Design: docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 1.
//   moments_list     one web search call lists a country's (or the world's)
//                    dated moments for five weeks, shared by every client in
//                    that market; queued by week_moments when a week needs it
//   week_moments     the moments one client's week may use: code's filter,
//                    the client's evidence, one judge call, code's check;
//                    queued by week_plan, which waits for it, and kept on the
//                    plan (calendar_plans.moments)
//   moment_feedback  a person removed a planned seasonal post: the memory
//                    learns from it (moment_removed); queued by the delete
//                    trigger of 20261110140000_seasonal_relevance.sql
// Nothing here holds a week: a job that runs out of tries leaves the week to
// be planned with no moments.

import { anthropicMessages } from "../anthropic.ts";
import { clipText } from "../text/clip.ts";
import { collectOwnedCompetitive } from "../competitive/ownedSource.ts";
import { activeTerms } from "../trends/profile.ts";
import { strategyBlock } from "../strategy/prompt.ts";
import { learnFromSignal, loadClientVoice } from "../voice/load.ts";
import { clientCompanyId, isClientPost, platformName, type OwnPost } from "./evidence.ts";
import {
  belongsToSpace, blockedCategories, checkJudgement, clientCountries, competitorMentions, filterMoments, judgePrompt, momentHistory, momentsListPrompt,
  parseMomentsList, GLOBAL, JUDGE_SCHEMA, LIST_WEEKS, SENSITIVE_CATEGORIES, type DroppedMoment, type HistoryPost, type JudgeInput, type JudgeOwnPost, type Moment,
  type MomentHistory,
} from "./moments.ts";
import { CLIENT_COLUMNS, feedSnapshots, retryWait, type WeekJob, type WeekJobOutcome } from "./runWeek.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

/** The model that lists and judges moments (Lital, 3 Nov 2026: Sonnet 5.5). */
export const MOMENTS_MODEL = "claude-sonnet-5-5";
/** Searches one list may run. */
const MAX_SEARCHES = 8;
/** A paused web search turn is continued at most this many times. */
const MAX_TURNS = 4;
const DAY = 86400_000;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (v: unknown, n = 4000) => (typeof v === "string" ? clipText(v.replace(/\s+/g, " ").trim(), n) : "");

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

const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Tries left: the job goes back in the queue with growing waits; out of tries, it ends quietly as failed. */
const retry = (job: WeekJob, reason: string, now: Date): WeekJobOutcome => job.attempts >= job.max_attempts
  ? { status: "failed", reason }
  : { status: "queued", reason, available_at: new Date(now.getTime() + retryWait(job.attempts)).toISOString() };

const usageOf = (raw: Any) => ({ input: Number(raw?.usage?.input_tokens) || 0, output: Number(raw?.usage?.output_tokens) || 0, searches: Number(raw?.usage?.server_tool_use?.web_search_requests) || 0 });

/** The dedupe key of one country's list for one week. */
export const listKey = (country: string, week: string) => `moments_list:${country.toLowerCase()}:${week}`;

// ── moments_list ────────────────────────────────────────────────────────────

/**
 * One country's (or the world's) dated moments for the five weeks from the
 * job's Monday, by one web search call. Every moment code keeps has a source
 * link and a date in range; it is saved once per moment and date, and the
 * list is recorded even when it found none, so the week never waits for it
 * again.
 */
export async function runMomentsList(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const country = str(job.payload?.country, 10).toUpperCase();
  const week = String(job.occurrence ?? "").slice(0, 10);
  if (!country || !isDay(week)) return { status: "skipped", reason: "The job names no country or week." };
  try {
    const through = addDays(week, LIST_WEEKS * 7 - 1);
    const where = country === GLOBAL ? "the world" : countryName(country);
    const tool: Record<string, unknown> = { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES };
    if (country !== GLOBAL) tool.user_location = { type: "approximate", country };
    let messages: Array<{ role: string; content: unknown }> = [{ role: "user", content: momentsListPrompt(country, where, week, through) }];
    const used = { input: 0, output: 0, searches: 0 };
    let text = "";
    for (let turn = 0; ; turn++) {
      const result = await anthropicMessages({ apiKey: apiKey(), body: { model: MOMENTS_MODEL, max_tokens: 16000, output_config: { effort: "medium" }, tools: [tool], messages } });
      const u = usageOf(result.raw);
      used.input += u.input; used.output += u.output; used.searches += u.searches;
      if (result.stopReason === "refusal") throw new Error("The moments list was declined.");
      if (result.stopReason !== "pause_turn") { text = result.text; break; }
      // A long search pauses; the turn is sent back as it came so the search goes on.
      if (turn + 1 >= MAX_TURNS) throw new Error("The moments search did not finish.");
      messages = [...messages, { role: "assistant", content: (result.raw as Any)?.content ?? [] }];
    }
    const moments = parseMomentsList(text, { country, from: week, through });
    if (!moments.length && !/"moments"\s*:\s*\[/.test(text)) throw new Error("The moments list could not be read.");
    const at = now.toISOString();
    if (moments.length) {
      const { error } = await admin.from("moments").upsert(moments.map((m) => ({ ...m, listed_for: week, updated_at: at })), { onConflict: "key,date" });
      if (error) throw new Error(`Could not save the moments: ${error.message}`);
    }
    const { error: listError } = await admin.from("moment_lists").upsert({
      country, week_start: week, through, listed_at: at, found: moments.length, model: MOMENTS_MODEL,
      input_tokens: used.input, output_tokens: used.output, searches: used.searches,
    }, { onConflict: "country,week_start" });
    if (listError) throw new Error(`Could not record the list: ${listError.message}`);
    return { status: "done", result: { country, week, moments: moments.length, input_tokens: used.input, output_tokens: used.output, searches: used.searches } };
  } catch (e) {
    return retry(job, message(e), now);
  }
}

// ── week_moments ────────────────────────────────────────────────────────────

const waitForLists = (now: Date): WeekJobOutcome => ({ status: "queued", reason: "Waiting for this week's dated moments to be listed.", available_at: new Date(now.getTime() + 60_000).toISOString(), deferred: true });

/**
 * The lists the week needs that are not there yet: queued once each. True
 * while any of them is still to run; a list whose job ended without one
 * leaves its country out.
 */
async function listsPending(admin: Db, countries: string[], week: string, priority: number, now: Date): Promise<boolean> {
  const { data: lists, error } = await admin.from("moment_lists").select("country, week_start").eq("week_start", week).in("country", countries);
  if (error) throw new Error(`Could not read the moment lists: ${error.message}`);
  const have = new Set((lists ?? []).filter((l: Any) => String(l.week_start).slice(0, 10) === week).map((l: Any) => String(l.country)));
  const missing = countries.filter((c) => !have.has(c));
  if (!missing.length) return false;
  const keys = missing.map((c) => listKey(c, week));
  const { data: jobs, error: jobsError } = await admin.from("scheduled_jobs").select("dedupe_key, status").in("dedupe_key", keys);
  if (jobsError) throw new Error(`Could not read the moment lists' jobs: ${jobsError.message}`);
  const state = new Map(((jobs ?? []) as Any[]).filter((j) => keys.includes(j.dedupe_key)).map((j) => [String(j.dedupe_key), String(j.status)]));
  const toQueue = missing.filter((c) => !state.has(listKey(c, week)));
  if (toQueue.length) {
    const { error: queueError } = await admin.from("scheduled_jobs").upsert(toQueue.map((country) => ({
      kind: "moments_list", client_id: null, occurrence: `${week}T00:00:00Z`, dedupe_key: listKey(country, week), payload: { country }, priority, available_at: now.toISOString(),
    })), { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (!queueError) return true;
    // A queue that won't take the list leaves those countries out rather than holding the week.
    console.warn("[moments] could not queue a list:", queueError.message);
  }
  return missing.some((c) => ["queued", "running"].includes(state.get(listKey(c, week)) ?? ""));
}

/** The moments stored for a set of countries on the days of a week. */
async function storedMoments(admin: Db, countries: string[], week: string): Promise<Moment[]> {
  const { data, error } = await admin.from("moments").select("key, name, date, last_year_date, country, category, link, hashtags, aliases, terms")
    .in("country", countries).gte("date", week).lte("date", addDays(week, 6));
  if (error) throw new Error(`Could not read the moments: ${error.message}`);
  return ((data ?? []) as Any[]).map((m) => ({
    key: String(m.key), name: String(m.name), date: String(m.date).slice(0, 10), last_year_date: m.last_year_date ? String(m.last_year_date).slice(0, 10) : null,
    country: String(m.country), category: m.category, link: String(m.link ?? ""),
    hashtags: Array.isArray(m.hashtags) ? m.hashtags.map(String) : [], aliases: Array.isArray(m.aliases) ? m.aliases.map(String) : [], terms: Array.isArray(m.terms) ? m.terms.map(String) : [],
  }));
}

/**
 * The filter for posts with a seasonal reason, as JSON text: given an array,
 * supabase-js writes a Postgres array literal ({...}), which a jsonb column
 * refuses ("invalid input syntax for type json"); every week_moments job
 * failed on it on 3 Nov 2026.
 */
export const SEASONAL_REASON = JSON.stringify([{ type: "seasonal" }]);

/**
 * What the client's removals say (decision 2): the moment keys it removed,
 * and the categories two removals blocked, unless a planned seasonal post of
 * that category stayed on the calendar through its week.
 */
async function removalsOf(admin: Db, clientId: string, today: string): Promise<{ removedKeys: Set<string>; blocked: Set<string> }> {
  const { data: removals, error } = await admin.from("moment_removals").select("moment_key, category").eq("client_id", clientId);
  if (error) throw new Error(`Could not read the client's removed moments: ${error.message}`);
  const { data: posts, error: postsError } = await admin.from("calendar_posts").select("post_date, reasons, plan_id")
    .eq("client_id", clientId).not("plan_id", "is", null).lt("post_date", mondayOf(today)).contains("reasons", SEASONAL_REASON);
  if (postsError) throw new Error(`Could not read the client's seasonal posts: ${postsError.message}`);
  const kept = ((posts ?? []) as Any[])
    .filter((p) => p.plan_id && String(p.post_date) < mondayOf(today))
    .map((p) => ({ category: (Array.isArray(p.reasons?.[0]?.evidence) ? p.reasons[0].evidence : []).find((e: Any) => e?.kind === "moment")?.category ?? null }))
    .filter((k) => k.category);
  const rows = (removals ?? []) as Array<{ moment_key: string | null; category: string | null }>;
  return { removedKeys: new Set(rows.map((r) => r.moment_key).filter((k): k is string => !!k)), blocked: blockedCategories(rows, kept) };
}

/** The client's own posts around last year's dates of the moments: one Sprout read for the whole span. */
async function lastYearPosts(admin: Db, client: Any, moments: Moment[]): Promise<{ posts: OwnPost[]; sprout: string }> {
  const dates = moments.map((m) => m.last_year_date).filter((d): d is string => !!d).sort();
  if (!dates.length) return { posts: [], sprout: "not_needed" };
  try {
    const owned = await collectOwnedCompetitive(admin, client, { start: addDays(dates[0], -7), end: addDays(dates[dates.length - 1], 7) }, { fields: ["is_boosted"] });
    const posts = ((owned.posts ?? []) as Any[]).map((p) => ({
      id: String(p.postId), platform: platformName(p.channel), format: String(p.type || "unknown"), publishedAt: String(p.publishedAt),
      text: String(p.message || ""), link: p.postLink ?? null, impressions: p.ownedImpressions ?? null, engagement: Number(p.engagementTotal) || 0, boosted: p.boosted === true,
    }));
    return { posts, sprout: owned.coverage };
  } catch (e) {
    console.warn("[moments] last year's posts could not be read:", message(e));
    return { posts: [], sprout: "failed" };
  }
}

const pillarsOf = (raw: unknown) => (Array.isArray(raw) ? raw : []).map((p: Any) => ({ name: str(p?.name ?? p, 120), description: p?.description ? str(p.description, 240) : undefined })).filter((p) => p.name);

/** The brief: what the team wrote, and the brand identity's own words. */
function briefOf(client: Any): string {
  const identity = client.brand_identity && typeof client.brand_identity === "object"
    ? Object.entries(client.brand_identity as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `${k.replace(/_/g, " ")}: ${str(v, 400)}`)
    : [];
  return [str(client.brief_text, 3000), ...identity].filter(Boolean).join("\n");
}

/** The strategy's sections: for the judge, audience, positioning and what to avoid; for the brand's own words, everything but what to avoid. */
async function strategyOf(admin: Db, clientId: string): Promise<{ forJudge: string; ownWords: string }> {
  const { data: s, error } = await admin.from("content_strategies").select("sections, written_at").eq("client_id", clientId).maybeSingle();
  if (error || !s?.written_at) return { forJudge: "", ownWords: "" };
  const { data: edits } = await admin.from("content_strategy_edits").select("section_key, text").eq("client_id", clientId);
  const mine = new Map(((edits ?? []) as Any[]).filter((e) => str(e.text)).map((e) => [String(e.section_key), String(e.text)]));
  const sections = { ...(s.sections ?? {}) } as Record<string, string>;
  for (const [k, v] of mine) sections[k] = v;
  const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(sections[k] ?? "")]));
  return {
    forJudge: strategyBlock({ sections: pick(["audience", "positioning", "avoid"]), platforms: [], pillars: [] }, []),
    ownWords: Object.entries(sections).filter(([k]) => k !== "avoid").map(([, v]) => String(v ?? "")).join("\n"),
  };
}

/** The trend profile's audience and fit rubric, and the topics it excludes. */
async function trendProfileOf(admin: Db, clientId: string): Promise<{ audience: string; fitRubric: string; exclusions: string[] }> {
  const { data: p } = await admin.from("trend_profiles").select("audience, fit_rubric").eq("client_id", clientId).maybeSingle();
  const terms = await activeTerms(admin, clientId).catch(() => ({ exclusions: [] as Array<{ term: string }> }));
  return { audience: str(p?.audience, 1200), fitRubric: str(p?.fit_rubric, 1500), exclusions: terms.exclusions.map((t) => t.term).slice(0, 20) };
}

/** Competitor posts in the client's stored feeds, as text by company. */
async function competitorTexts(admin: Db, client: Any): Promise<Array<{ company: string; text: string }>> {
  const out: Array<{ company: string; text: string }> = [];
  for (const s of await feedSnapshots(admin, client.id)) {
    const own = clientCompanyId(s.payload, String(client.name ?? ""));
    for (const p of (s.payload?.socialPosts ?? []) as Any[]) {
      if (isClientPost(p, own, String(client.name ?? "")) || !p?.companyName) continue;
      out.push({ company: String(p.companyName), text: String(p.message || "") });
    }
  }
  return out;
}

/** What a week's plan keeps of its moments (calendar_plans.moments). */
export interface PlanMoments {
  judged_at: string;
  countries: string[];
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  sprout: string;
  kept: ReturnType<typeof checkJudgement>["kept"];
  dropped: DroppedMoment[];
}

export async function runWeekMoments(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const week = String(job.occurrence ?? "").slice(0, 10);
  try {
    const { data: plan, error: planError } = await admin.from("calendar_plans").select("id, status, week_start").eq("client_id", job.client_id).eq("week_start", week).maybeSingle();
    if (planError) throw new Error(`Could not read the plan: ${planError.message}`);
    if (!plan) return { status: "skipped", reason: "The plan this job was for no longer exists." };
    if (plan.status === "ready" || plan.status === "expired") return { status: "skipped", reason: "The week is already planned." };
    if (plan.status === "canceled") return { status: "skipped", reason: "A person stopped this week's plan." };
    const { data: client, error } = await admin.from("clients").select(`${CLIENT_COLUMNS}, location, brief_text`).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const today = todayIn(String(client.timezone || "UTC"), now);
    const tomorrow = addDays(today, 1);
    const firstDate = tomorrow > week ? tomorrow : week;
    if (firstDate > addDays(week, 6)) return { status: "skipped", reason: "The week is over." };

    const countries = [...clientCountries(client), GLOBAL];
    if (await listsPending(admin, countries, week, Math.max(0, Number(job.priority ?? 40) - 1), now)) return waitForLists(now);

    const save = async (value: PlanMoments) => {
      const { error: saveError } = await admin.from("calendar_plans").update({ moments: value, updated_at: new Date().toISOString() }).eq("id", plan.id);
      if (saveError) throw new Error(`Could not keep the week's moments: ${saveError.message}`);
    };
    const base = { judged_at: now.toISOString(), countries, model: null as string | null, input_tokens: 0, output_tokens: 0, sprout: "not_needed" };

    // 1. Code's filter: countries, the week, removals, blocked categories. No model call.
    const removals = await removalsOf(admin, client.id, today);
    const step1 = filterMoments(await storedMoments(admin, countries, week), { countries: countries.filter((c) => c !== GLOBAL), monday: week, firstDate, ...removals });
    if (!step1.kept.length) {
      await save({ ...base, kept: [], dropped: step1.dropped });
      return { status: "done", result: { kept: 0, dropped: step1.dropped.length, judged: false } };
    }

    // A sensitive moment stays only on the client's own evidence: its own words, or its own post on it last year.
    const { posts: lastYear, sprout } = await lastYearPosts(admin, client, step1.kept);
    const strategy = await strategyOf(admin, client.id);
    const pillars = pillarsOf(client.content_pillars);
    const brief = briefOf(client);
    const ownWords = [pillars.map((p) => `${p.name} ${p.description ?? ""}`).join("\n"), brief, strategy.ownWords].join("\n");
    const histories = new Map<string, MomentHistory | null>(step1.kept.map((m) => [m.key, momentHistory(m, lastYear)]));
    const sensitiveDropped: DroppedMoment[] = [];
    const candidates = step1.kept.filter((m) => {
      if (!SENSITIVE_CATEGORIES.has(m.category) || belongsToSpace(m, ownWords, histories.get(m.key) ?? null)) return true;
      sensitiveDropped.push({ key: m.key, name: m.name, date: m.date, category: m.category, why: "sensitive" });
      return false;
    });
    if (!candidates.length) {
      await save({ ...base, sprout, kept: [], dropped: [...step1.dropped, ...sensitiveDropped] });
      return { status: "done", result: { kept: 0, dropped: step1.dropped.length + sensitiveDropped.length, judged: false } };
    }

    // 2. The evidence for each moment left.
    const [competitors, profile, voice] = await Promise.all([competitorTexts(admin, client), trendProfileOf(admin, client.id), loadClientVoice(admin, client.id, now)]);
    let ref = 0;
    const input: JudgeInput = {
      brand: String(client.name ?? ""),
      pillars,
      brief,
      strategy: strategy.forJudge,
      trendAudience: profile.audience,
      fitRubric: profile.fitRubric,
      exclusions: profile.exclusions,
      voice: [voice.social?.overall?.summary, ...Object.entries(voice.social?.platforms ?? {}).map(([k, v]) => `${k}: ${v.summary}`), voice.briefTone ? `Tone: ${voice.briefTone}` : ""].filter(Boolean).join("\n"),
      preferences: voice.preferences.map((p) => p.pattern_description),
      moments: candidates.map((m) => ({
        moment: m,
        sensitive: SENSITIVE_CATEGORIES.has(m.category),
        own: (histories.get(m.key)?.matched ?? []).slice(0, 3).map((h): JudgeOwnPost => ({
          ref: `O${++ref}`, id: h.id, platform: h.platform, format: h.format, date: h.date, multiple: h.multiple, metric: h.metric,
          text: lastYear.find((p) => p.id === h.id)?.text ?? "",
        })),
        competitors: competitorMentions(m, competitors),
      })),
    };

    // 3. The judge, 4. code's check. An answer that can't be read is asked for once more.
    const used = { input: 0, output: 0 };
    let checked: ReturnType<typeof checkJudgement> | null = null;
    const best = new Map<string, HistoryPost | null>(candidates.map((m) => [m.key, histories.get(m.key)?.best ?? null]));
    for (let attempt = 0; attempt < 2 && !checked; attempt++) {
      const result = await anthropicMessages({ apiKey: apiKey(), body: {
        model: MOMENTS_MODEL, max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
        messages: [{ role: "user", content: judgePrompt(input) }],
      } });
      const u = usageOf(result.raw);
      used.input += u.input; used.output += u.output;
      if (result.stopReason === "refusal" || !/"moments"\s*:\s*\[/.test(result.text)) continue;
      checked = checkJudgement(result.text, input, best);
    }
    if (!checked) throw new Error("The moments' judgement could not be read.");
    await save({ ...base, model: MOMENTS_MODEL, input_tokens: used.input, output_tokens: used.output, sprout, kept: checked.kept, dropped: [...step1.dropped, ...sensitiveDropped, ...checked.dropped] });
    return { status: "done", result: { kept: checked.kept.length, dropped: step1.dropped.length + sensitiveDropped.length + checked.dropped.length, judged: true, input_tokens: used.input, output_tokens: used.output } };
  } catch (e) {
    return retry(job, message(e), now);
  }
}

// ── moment_feedback ─────────────────────────────────────────────────────────

/** A person removed a planned seasonal post: the memory learns what kinds of moment the client skips. */
export async function runMomentFeedback(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const id = str(job.payload?.removal_id, 80);
  if (!id) return { status: "skipped", reason: "The job names no removal." };
  try {
    const { data: removal, error } = await admin.from("moment_removals").select("id, client_id, moment_name, category, post_date").eq("id", id).maybeSingle();
    if (error) throw new Error(`Could not read the removal: ${error.message}`);
    if (!removal) return { status: "skipped", reason: "The removal no longer exists." };
    if (!str(removal.moment_name)) return { status: "done", result: { ops: 0 } };
    const learned = await learnFromSignal(admin, removal.client_id, { kind: "moment_removed", moment: str(removal.moment_name, 200), category: removal.category ?? null, date: removal.post_date ? String(removal.post_date).slice(0, 10) : null });
    return { status: "done", result: learned };
  } catch (e) {
    return retry(job, message(e), now);
  }
}
