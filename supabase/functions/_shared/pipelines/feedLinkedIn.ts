// Which engine collects the competitor feed's LinkedIn posts, by the
// LinkedIn source's switch (report_engines, kind linkedin_source):
//
//   n8n     the n8n workflow, exactly as before.
//   shadow  the n8n workflow, as before, for the feed; afterwards the
//           refresh queues the in-app run (shadow.ts shadowLinkedInSource),
//           which writes only shadow_linkedin_sources.
//   app     the in-app pipeline, run here in the refresh (inline.ts) within
//           the time the n8n call had (100 s); its answer passes the same
//           checks the n8n answer passes. n8n is the backup: once
//           APP_STOPS_BEFORE_N8N in-app runs for the client's window have
//           stopped, the window goes to n8n, the dispatch's rule for reports.
//
// A stopped in-app run throws, and the refresh fails quietly as it does when
// the n8n call fails: the scheduled refresh tries again in 10 minutes
// (run-scheduled-jobs/feed.ts) and the previous feed stays in place.

import { checkLinkedInAnswer, type LinkedInSource } from "../competitive/linkedinSource.ts";
import type { ResolvedEngine } from "./engine.ts";
import { runPipelineInline, type InlineDeps } from "./inline.ts";
import { createInlineRun, makeRunStore, makeStepLog, makeStepServices } from "./store.ts";
import { APP_STOPS_BEFORE_N8N } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
type Answer = { socialPosts: unknown[]; additional_metrics: Record<string, unknown>; [key: string]: unknown };

/** The time the in-app collection has in a refresh: what the n8n call was given. */
export const LINKEDIN_INLINE_BUDGET_MS = 100_000;

export interface FeedLinkedInArgs {
  clientId: string;
  sources: LinkedInSource[];
  period: { start: string; end: string };
  now?: () => Date;
  env?: (name: string) => string | undefined;
  /** Tests give their own; the refresh uses the database's. */
  inline?: Partial<InlineDeps>;
}

/** An in-app run still marked running after this long was cut off with its refresh: it counts as stopped. */
export const INLINE_RUN_CUT_OFF_MS = 5 * 60_000;

/** In-app runs of this client's window that stopped, or that their refresh was cut off in. */
export async function stoppedAppRuns(db: Db, clientId: string, period: { start: string; end: string }, now: Date = new Date()): Promise<number> {
  const { data, error } = await db.from("report_pipeline_runs").select("status, input, heartbeat_at")
    .eq("kind", "linkedin_source").eq("mode", "app").eq("client_id", clientId).in("status", ["stopped", "running"])
    .order("started_at", { ascending: false }).limit(50);
  if (error) throw new Error(`The in-app LinkedIn runs could not be read: ${error.message}`);
  type Row = { status: string; heartbeat_at?: string | null; input?: { period?: { start?: string; end?: string } } };
  const cutOff = (r: Row) => r.status === "running" && now.getTime() - Date.parse(String(r.heartbeat_at ?? "")) > INLINE_RUN_CUT_OFF_MS;
  return (data ?? []).filter((r: Row) => (r.status === "stopped" || cutOff(r)) && r.input?.period?.start === period.start && r.input?.period?.end === period.end).length;
}

/** The LinkedIn source's answer for a feed refresh, from the engine the switch picked. n8n() is the n8n workflow call. */
export async function feedLinkedInAnswer(db: Db, engine: ResolvedEngine, a: FeedLinkedInArgs, n8n: () => Promise<Answer>): Promise<Answer> {
  if (engine.engine !== "app" || !engine.pipeline) return await n8n();
  if (!a.sources.length) return { socialPosts: [], additional_metrics: {} };
  const now = a.now ?? (() => new Date());
  let stops = 0;
  try {
    stops = await stoppedAppRuns(db, a.clientId, a.period, now());
  } catch (e) {
    // The run history cannot be read: n8n, the backup, answers this refresh.
    console.warn(`[feed] ${a.clientId}: ${e instanceof Error ? e.message : String(e)}; n8n collects LinkedIn.`);
    return await n8n();
  }
  if (stops >= APP_STOPS_BEFORE_N8N) {
    console.warn(`[feed] ${a.clientId}: ${stops} in-app LinkedIn runs for ${a.period.start} to ${a.period.end} stopped; n8n collects this window.`);
    return await n8n();
  }
  // deno-lint-ignore no-explicit-any
  const env = a.env ?? ((name: string) => (globalThis as any).Deno?.env?.get(name));
  const at = now();
  const deps: InlineDeps = {
    now,
    createRun: (row) => createInlineRun(db, row),
    runs: makeRunStore(db),
    log: makeStepLog(db),
    services: makeStepServices(db, env),
    ...a.inline,
  };
  const { output } = await runPipelineInline(engine.pipeline, {
    clientId: a.clientId,
    realTable: "rivaliq_snapshots",
    realId: null,
    // The feed snapshot this refresh saves: the client's newest 'feed' snapshot for this window.
    realRef: { client_id: a.clientId, endpoint: "feed", window: a.period, requested_at: at.toISOString() },
    input: { sources: a.sources, period: a.period },
    dedupe: `app:linkedin_source:${a.clientId}:${a.period.start}:${a.period.end}:${at.toISOString()}:${crypto.randomUUID().slice(0, 8)}`,
  }, deps, LINKEDIN_INLINE_BUDGET_MS);
  return checkLinkedInAnswer(output, a.sources, a.period) as Answer;
}
