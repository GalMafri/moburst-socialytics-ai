/**
 * Socialytics' wiring of the cost checks (cost/audit.ts): its stores, its
 * keys, its Apify actor list, and, for past Apify runs, who each run was for.
 *
 * Used by the cost-reconcile function (cron, or x-socialytics-secret by hand)
 * and by POST /v1/admin/cost-check in the api function (an admin key).
 *
 * Who a past run was for (mode=history), by actor:
 *   trends actors          the client whose trends week (trend_weeks, created_at
 *                          to finished_at) was running when the run started;
 *   LinkedIn company posts the client whose report (reports.created_at, taken
 *                          to run for at most REPORT_MS) was running.
 * A run that falls in several clients' windows, or none, stays unattributed
 * rather than guessed.
 *
 * Already counted (both modes): the one-off backfill of 23 Nov 2026 loaded
 * each trends week's Apify dollars from trend_weeks.cost.apify_usd, without
 * run ids (cost_events keys "backfill:trend_weeks:<week id>:apify"). A trends
 * actor run that started inside such a week's window is part of that figure,
 * so the audit treats it as recorded and never writes it again.
 */
import type { ApifyRunItem, Attribution, CheckDeps } from "../cost/audit.ts";
import { unattributedPctFrom } from "../cost/audit.ts";
import { thresholdFrom } from "../cost/reconcile.ts";
import { auditStore, type Db } from "../cost/store.ts";
import { normActor } from "../cost/apify.ts";
import { APIFY_ACTORS, TOOL } from "./config.ts";
import { billingCredentials, ownKey, paid } from "./index.ts";

const env = (name: string): string | undefined => (typeof Deno !== "undefined" ? Deno.env.get(name) : undefined);

/** The trends actors (trends/sources.ts), by id and name. */
const TRENDS_ACTORS = new Set(
  APIFY_ACTORS.owned.filter((a) => a.note?.startsWith("trends:")).flatMap((a) => [a.id, a.name].filter((x): x is string => !!x).map(normActor)),
);
const LINKEDIN_POSTS_ACTORS = new Set(
  APIFY_ACTORS.owned.filter((a) => a.name === "harvestapi/linkedin-company-posts").flatMap((a) => [a.id, a.name].filter((x): x is string => !!x).map(normActor)),
);

/** A unit of work that was running between start and end (ms), for a client. */
export interface WorkWindow {
  id: string;
  clientId: string;
  start: number;
  end: number;
  /** For trends weeks: whether the 23 Nov backfill already loaded its Apify dollars. */
  backfilled?: boolean;
}

/** A trends week with no finished_at is taken to have run for at most this long. */
const OPEN_WEEK_MS = 3 * 60 * 60_000;
/** A report is taken to run for at most this long after it was created. */
const REPORT_MS = 3 * 60 * 60_000;
/** Slack around a window, for clocks and queueing. */
const SLACK_MS = 5 * 60_000;

const isTrends = (run: ApifyRunItem) => TRENDS_ACTORS.has(normActor(run.actId));
const isLinkedInPosts = (run: ApifyRunItem) => LINKEDIN_POSTS_ACTORS.has(normActor(run.actId));
const inside = (t: number, w: WorkWindow) => w.start - SLACK_MS <= t && t <= w.end + SLACK_MS;

/** The one client whose window holds the run, or nothing when none or several do. */
function onlyClient(run: ApifyRunItem, windows: WorkWindow[], feature: string): Attribution[] | null {
  const t = Date.parse(run.startedAt);
  const live = windows.filter((w) => inside(t, w));
  const clients = new Set(live.map((w) => w.clientId));
  if (clients.size !== 1) return null;
  const mine = live.filter((w) => w.clientId === live[0].clientId);
  return [{ clientId: live[0].clientId, executionId: mine.length === 1 ? mine[0].id : null, share: 1, feature }];
}

/** Who each run was for. Runs with no single answer stay unattributed. */
export function attributeRuns(runs: ApifyRunItem[], weeks: WorkWindow[], reports: WorkWindow[]): Map<string, Attribution[]> {
  const out = new Map<string, Attribution[]>();
  for (const run of runs) {
    const parts = isTrends(run) ? onlyClient(run, weeks, "trends.week") : isLinkedInPosts(run) ? onlyClient(run, reports, "report.linkedin_posts") : null;
    if (parts) out.set(run.id, parts);
  }
  return out;
}

/** The trends runs the 23 Nov backfill already counted: those that started inside a backfilled week. */
export function coveredRuns(runs: ApifyRunItem[], weeks: WorkWindow[]): Set<string> {
  const backfilled = weeks.filter((w) => w.backfilled);
  const out = new Set<string>();
  for (const run of runs) {
    if (!isTrends(run)) continue;
    const t = Date.parse(run.startedAt);
    if (backfilled.some((w) => inside(t, w))) out.add(run.id);
  }
  return out;
}

async function pages(db: Db, table: string, columns: string, from: string, to: string, push: (row: any) => void): Promise<void> {
  for (let page = 0; page < 100; page++) {
    const { data, error } = await db.from(table).select(columns).gte("created_at", from).lte("created_at", to).order("created_at").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    for (const row of data ?? []) push(row);
    if (!data || data.length < 1000) return;
  }
}

/** The trends weeks that may have been running between from and to (ms), marked when the backfill loaded them. */
export async function loadWeeks(db: Db, from: number, to: number): Promise<WorkWindow[]> {
  const out: WorkWindow[] = [];
  await pages(db, "trend_weeks", "id, client_id, created_at, finished_at", new Date(from - OPEN_WEEK_MS - SLACK_MS).toISOString(), new Date(to + SLACK_MS).toISOString(), (w) => {
    const start = Date.parse(w.created_at);
    if (!w.client_id || !Number.isFinite(start)) return;
    out.push({ id: w.id, clientId: w.client_id, start, end: w.finished_at ? Date.parse(w.finished_at) : start + OPEN_WEEK_MS });
  });
  if (!out.length) return out;
  const backfilled = new Set<string>();
  for (let i = 0; i < out.length; i += 200) {
    const keys = out.slice(i, i + 200).map((w) => `backfill:trend_weeks:${w.id}:apify`);
    const { data, error } = await db.from("cost_events").select("idempotency_key").in("idempotency_key", keys);
    if (error) throw new Error(`cost_events read failed: ${error.message}`);
    for (const r of data ?? []) backfilled.add(String(r.idempotency_key).split(":")[2]);
  }
  return out.map((w) => ({ ...w, backfilled: backfilled.has(w.id) }));
}

/** The reports that may have been running between from and to (ms). */
export async function loadReports(db: Db, from: number, to: number): Promise<WorkWindow[]> {
  const out: WorkWindow[] = [];
  await pages(db, "reports", "id, client_id, created_at", new Date(from - REPORT_MS - SLACK_MS).toISOString(), new Date(to + SLACK_MS).toISOString(), (r) => {
    const start = Date.parse(r.created_at);
    if (!r.client_id || !Number.isFinite(start)) return;
    out.push({ id: r.id, clientId: r.client_id, start, end: start + REPORT_MS });
  });
  return out;
}

const span = (runs: ApifyRunItem[]): [number, number] | null => {
  const times = runs.map((r) => Date.parse(r.startedAt)).filter(Number.isFinite);
  return times.length ? [Math.min(...times), Math.max(...times)] : null;
};

/** The checks as Socialytics runs them, over a service-role client. */
export function socialyticsCheckDeps(db: Db): CheckDeps {
  return {
    tool: TOOL,
    store: auditStore(db),
    record: (ctx, provider, usage, opts) => paid.record(ctx, provider, usage, opts),
    fetch: (u, init) => fetch(u, init),
    env,
    credentials: billingCredentials,
    ownKey,
    actors: APIFY_ACTORS,
    threshold: thresholdFrom(env),
    unattributedPct: unattributedPctFrom(env),
    now: () => new Date(),
    covered: async (runs) => {
      const trends = runs.filter(isTrends);
      const s = span(trends);
      return s ? coveredRuns(trends, await loadWeeks(db, s[0], s[1])) : new Set();
    },
    attribute: async (runs) => {
      const s = span(runs);
      if (!s) return new Map();
      const [weeks, reports] = await Promise.all([
        runs.some(isTrends) ? loadWeeks(db, s[0], s[1]) : Promise.resolve([]),
        runs.some(isLinkedInPosts) ? loadReports(db, s[0], s[1]) : Promise.resolve([]),
      ]);
      return attributeRuns(runs, weeks, reports);
    },
  };
}
