// trends_v1: one client's industry trends for one week (spec:
// docs/superpowers/specs/2026-10-28-trends-redesign-design.md, sections 2 to
// 5). App mode only; it has no n8n twin. A weekly trend_refresh job starts it
// on the client's feed weekday, linked to that week's trend_weeks row.
//
//   start          the client's profile, terms and exclusions; each watched
//                  platform's searches for the last 7 days
//   scrape_*       one step per platform; a source that takes one search a
//                  run comes back to its own step for each search. Every
//                  answer is kept 90 days, so a replay reads it again. A
//                  source that fails twice is marked failed and the week goes on.
//   rules          the cuts in code: duplicates, outside the week, another
//                  language, own or competitor posts, past 60 per platform
//   filter         Claude (Sonnet) keeps or drops every candidate with a reason;
//                  a bad answer is asked once more, then the week keeps nothing
//   themes         Claude (Opus) groups the kept posts into 3 to 6 themes
//   save           every post looked at, kept or dropped with its reason, the
//                  themes, each platform's status and the measured cost

import { runActorStep, type ApifyFactory } from "../apifyStep.ts";
import { claudeBatchStep } from "../claude.ts";
import { ANTHROPIC_API_KEY, APIFY_API_TOKEN } from "../secrets.ts";
import { keptAnswer, replayOf } from "../social/replay.ts";
import { SOURCE_KEEP_DAYS } from "../store.ts";
import { StepRestart, type PipelineDefinition, type Step, type StepContext, type StepResult } from "../types.ts";
import { competitorSet } from "../../calendar/runWeek.ts";
import { activeTerms } from "../../trends/profile.ts";
import { searchesFor, TREND_SOURCES } from "../../trends/sources.ts";
import { ruleFilter, tripwire } from "../../trends/rules.ts";
import { filterRequest, parseFilter, pickKept, TREND_FILTER_MODEL, type FilterProfile } from "../../trends/filter.ts";
import { parseThemes, themesRequest, themesWanted, TREND_THEMES_MODEL } from "../../trends/themes.ts";
import { TREND_PLATFORMS, type DropReason, type KeptPost, type RuleDrop, type Term, type Theme, type TrendPlatform, type TrendPost } from "../../trends/types.ts";

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

interface Plan {
  client: { name: string; language: string; languages: string[]; region?: string };
  own: { handles: string[]; names: string[] };
  competitorHandles: string[];
  window: { start: string; end: string };
  platforms: TrendPlatform[];
  searches: Partial<Record<TrendPlatform, string[]>>;
  profile: FilterProfile;
  exclusions: Term[];
  competitors: string[];
}

interface TrendState {
  [key: string]: unknown;
  scrape?: Partial<Record<TrendPlatform, { i: number; rows: number; ok: number; failed: number }>>;
  platforms?: Partial<Record<TrendPlatform, { status: PlatformStatus; searched: number; rows: number }>>;
  apifyUsd?: number;
  claude?: Record<string, { input_tokens: number; output_tokens: number }>;
  filterTries?: number;
  themesTries?: number;
  filter?: "ok" | "failed" | "skipped";
  themes?: "ok" | "failed" | "skipped";
}

type Judged = { post: TrendPost | KeptPost; reason: DropReason | "below_cut" };

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

/** The client's country for the sources that take one: the first two-letter code of its market (UK is GB). */
function regionOf(geo: unknown): string | undefined {
  for (const part of String(geo ?? "").split(/[,\s]+/)) {
    const code = part.trim().toUpperCase();
    if (code === "UK") return "GB";
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return undefined;
}

function withTokens(st: TrendState, model: string, usage: Any): TrendState {
  if (!usage) return st;
  const was = st.claude?.[model] ?? { input_tokens: 0, output_tokens: 0 };
  return { ...st, claude: { ...(st.claude ?? {}), [model]: { input_tokens: was.input_tokens + (Number(usage.input_tokens) || 0), output_tokens: was.output_tokens + (Number(usage.output_tokens) || 0) } } };
}

export function trendsPipeline(deps: TrendsDeps = {}): PipelineDefinition {
  const scrapeStep = (platform: TrendPlatform, next: string) => async (ctx: StepContext): Promise<StepResult> => {
    const plan = await need<Plan>(ctx, "plan");
    const st = stateOf(ctx);
    const searches = plan.searches[platform] ?? [];
    const runs = plan.platforms.includes(platform)
      ? TREND_SOURCES[platform].inputs(searches, { region: plan.client.region, language: plan.client.language, windowStart: plan.window.start.slice(0, 10), windowEnd: plan.window.end.slice(0, 10) })
      : [];
    if (!runs.length) {
      const status: PlatformStatus = plan.platforms.includes(platform) ? "no_searches" : "not_watched";
      return { type: "next", step: next, state: { ...st, platforms: { ...(st.platforms ?? {}), [platform]: { status, searched: 0, rows: 0 } } }, detail: { platform, status } };
    }
    const prog = { ...(st.scrape?.[platform] ?? { i: 0, rows: 0, ok: 0, failed: 0 }) };
    const run = runs[prog.i];
    const key = `source.${platform}.${prog.i}`;
    let usd = 0;
    let detail: Record<string, unknown> = { platform, run: prog.i + 1, of: runs.length };
    // Everything that reads this run's answer is inside the try: whatever goes
    // wrong with one source marks that source failed, and the week goes on.
    try {
      let rows: unknown[] | null = null;
      if (replayOf(ctx)) {
        const failed = await keptAnswer(ctx, `${key}.failed`);
        if (failed) await ctx.payloads.put(`${key}.failed`, failed, KEEP);
        else {
          rows = (await keptAnswer<unknown[]>(ctx, key)) ?? [];
          await ctx.payloads.put(key, rows, KEEP);
        }
        detail = { ...detail, replayed: true };
      } else {
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
        const found = rows.map((r) => TREND_SOURCES[platform].normalize(r, run.search)).filter((p): p is TrendPost => p !== null);
        const sofar = (await ctx.payloads.get<TrendPost[]>(`posts.${platform}`)) ?? [];
        await ctx.payloads.put(`posts.${platform}`, [...sofar, ...found]);
        prog.rows += found.length;
        prog.ok += 1;
      } else {
        prog.failed += 1;
      }
    } catch (e) {
      if (ctx.attempt < SCRAPE_TRIES) throw e;
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await ctx.payloads.put(`${key}.failed`, { message }, KEEP).catch(() => undefined);
      prog.failed += 1;
      detail = { ...detail, failed: message };
    }
    prog.i += 1;
    const moved: TrendState = { ...st, apifyUsd: (st.apifyUsd ?? 0) + usd, scrape: { ...(st.scrape ?? {}), [platform]: prog } };
    if (prog.i < runs.length) return { type: "next", step: ctx.step, state: moved, detail };
    const status: PlatformStatus = prog.ok === 0 ? "failed" : prog.rows === 0 ? "empty" : "ok";
    return { type: "next", step: next, state: { ...moved, platforms: { ...(moved.platforms ?? {}), [platform]: { status, searched: runs.length, rows: prog.rows } } }, detail: { ...detail, status } };
  };

  const candidatesOf = (ctx: StepContext) => need<TrendPost[]>(ctx, "candidates");
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
    try {
      return await inner(ctx);
    } catch (e) {
      if (ctx.attempt < CLAUDE_TRIES) throw e;
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
      const [plan, kept] = await Promise.all([need<Plan>(ctx, "plan"), need<KeptPost[]>(ctx, "kept")]);
      const body = themesRequest(plan.profile, kept);
      return { apiKey: apiKey(ctx), body: again ? await repaired(ctx, body, "answer.themes") : body };
    },
    saveAs, keepDays: KEEP.keepDays, next: "read_themes", fetchImpl: deps.claudeFetch,
  }), themesGiveUp);

  const order = TREND_PLATFORMS.map((p) => `scrape_${p}`);
  const scrapeSteps = Object.fromEntries(TREND_PLATFORMS.map((p, i) => [`scrape_${p}`, scrapeStep(p, order[i + 1] ?? "rules")]));

  return {
    name: TRENDS_PIPELINE,
    kind: "trends",
    modes: ["app"],
    appCapable: true,
    secrets: [APIFY_API_TOKEN, ANTHROPIC_API_KEY],
    first: "start",
    steps: {
      async start(ctx) {
        // A replay reads the week again as it was: the same window, searches and profile.
        if (replayOf(ctx)) {
          const kept = await keptAnswer<Plan>(ctx, "plan");
          if (!kept) throw new Error("The replayed run kept no plan.");
          await ctx.payloads.put("plan", kept, KEEP);
          return { type: "next", step: order[0], state: {}, detail: { replayed: true, platforms: kept.platforms } };
        }
        const clientId = ctx.run.client_id;
        const { data: client, error } = await ctx.db.from("clients").select("id, name, geo, language").eq("id", clientId).maybeSingle();
        if (error || !client) throw new Error(`The client could not be read: ${error?.message ?? "not found"}`);
        const { data: profile } = await ctx.db.from("trend_profiles").select("audience, fit_rubric, platforms, search_overrides").eq("client_id", clientId).maybeSingle();
        if (!profile) throw new Error("The client has no trend profile yet.");
        const terms = await activeTerms(ctx.db, clientId);
        const competitors = await competitorSet(ctx.db, clientId).catch(() => []);
        const { data: ownRows } = await ctx.db.from("sprout_profiles").select("native_name, profile_name, is_active").eq("client_id", clientId);
        const { data: rivalRows } = await ctx.db.from("competitor_handles").select("handle, display_name, is_active").eq("client_id", clientId);
        const own = ((ownRows ?? []) as Any[]).filter((r) => r.is_active !== false);
        const rivals = ((rivalRows ?? []) as Any[]).filter((r) => r.is_active !== false);
        const competitorNames = [...new Set([...competitors.map((c) => c.name), ...rivals.map((r) => String(r.display_name ?? ""))].filter(Boolean))];
        const languages = languagesOf(client.language);
        const platforms = [...new Set(((profile.platforms ?? []) as Array<{ platform: string }>).map((p) => p.platform))].filter((p): p is TrendPlatform => (TREND_PLATFORMS as readonly string[]).includes(p));
        const end = ctx.now();
        const plan: Plan = {
          client: { name: String(client.name ?? ""), language: languages[0], languages, region: regionOf(client.geo) },
          own: { handles: own.map((r) => String(r.native_name ?? "")).filter(Boolean), names: own.map((r) => String(r.profile_name ?? "")).filter(Boolean) },
          competitorHandles: rivals.map((r) => String(r.handle ?? "")).filter(Boolean),
          window: { start: new Date(end.getTime() - WINDOW_DAYS * 86_400_000).toISOString(), end: end.toISOString() },
          platforms,
          searches: Object.fromEntries(platforms.map((p) => [p, searchesFor(p, terms, profile.search_overrides ?? {}, String(ctx.run.input?.week_start ?? end.toISOString().slice(0, 10)))])),
          profile: { audience: String(profile.audience), fit_rubric: String(profile.fit_rubric), topics: terms.topics, brand: String(client.name ?? ""), competitors: competitorNames },
          exclusions: terms.exclusions,
          competitors: competitorNames,
        };
        await ctx.payloads.put("plan", plan, KEEP);
        return { type: "next", step: order[0], state: {}, detail: { platforms, topics: terms.topics.length } };
      },

      ...scrapeSteps,

      async rules(ctx) {
        const plan = await need<Plan>(ctx, "plan");
        const all: TrendPost[] = [];
        for (const p of TREND_PLATFORMS) all.push(...((await ctx.payloads.get<TrendPost[]>(`posts.${p}`)) ?? []));
        const { candidates, dropped } = ruleFilter(all, {
          windowStart: plan.window.start, windowEnd: plan.window.end, languages: plan.client.languages,
          ownHandles: plan.own.handles, ownNames: [plan.client.name, ...plan.own.names], competitorHandles: plan.competitorHandles, competitorNames: plan.competitors,
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
        await ctx.payloads.put("themes", got.value);
        return { type: "next", step: "save", state: { ...counted, themes: "ok" }, detail: { themes: got.value.length } };
      },

      async save(ctx) {
        const st = stateOf(ctx);
        const plan = await need<Plan>(ctx, "plan");
        const ruleDropped = (await ctx.payloads.get<Array<{ post: TrendPost; reason: RuleDrop }>>("rule_dropped")) ?? [];
        const candidates = (await ctx.payloads.get<TrendPost[]>("candidates")) ?? [];
        const kept = (await ctx.payloads.get<KeptPost[]>("kept")) ?? [];
        const judged = (await ctx.payloads.get<Judged[]>("claude_dropped")) ?? [];
        const themes = (await ctx.payloads.get<Theme[]>("themes")) ?? [];

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

        const platforms: Record<string, Record<string, unknown>> = {};
        for (const p of TREND_PLATFORMS) {
          const s = st.platforms?.[p] ?? { status: "not_watched", searched: 0, rows: 0 };
          platforms[p] = { ...s, candidates: candidates.filter((c) => c.platform === p).length, kept: kept.filter((k) => k.platform === p).length };
        }
        const watchedOk = plan.platforms.every((p) => FINE.includes(st.platforms?.[p]?.status as PlatformStatus));
        const status = watchedOk && st.filter !== "failed" && st.themes !== "failed" ? "done" : "partial";
        // A replay scraped nothing: the week keeps the scraping cost of the run it replays.
        let apifyUsd = st.apifyUsd ?? 0;
        const replay = replayOf(ctx);
        if (replay) {
          const { data: source } = await ctx.db.from("report_pipeline_runs").select("real_id").eq("id", replay.from_run).maybeSingle();
          const { data: sourceWeek } = source?.real_id ? await ctx.db.from("trend_weeks").select("cost").eq("id", source.real_id).maybeSingle() : { data: null };
          apifyUsd = Number(sourceWeek?.cost?.apify_usd) || 0;
        }
        await ctx.output.write("week", {
          posts: rows, themes, status, platforms, filter_status: st.filter ?? "skipped",
          cost: { apify_usd: Math.round(apifyUsd * 10000) / 10000, claude: st.claude ?? {}, ...(replay ? { replayed_from: replay.from_run } : {}) },
          finished_at: ctx.now().toISOString(),
        });
        return { type: "done", detail: { status, kept: kept.length, themes: themes.length, posts: rows.length } };
      },
    },
  };
}
