// Which engine collects the competitor feed's LinkedIn posts, by the
// LinkedIn source's switch (report_engines, kind linkedin_source):
//
//   n8n     the n8n workflow, exactly as before (a row set by hand).
//   shadow  the n8n workflow, as before, for the feed; afterwards the
//           refresh queues the in-app run (shadow.ts shadowLinkedInSource),
//           which writes only shadow_linkedin_sources.
//   app     the in-app pipeline, run here in the refresh (inline.ts) within
//           the time the n8n call had (100 s); its answer passes the same
//           checks the n8n answer passes. n8n is never called.
//
// On app, a run that stops throws, and so does an app with no pipeline to
// run (the Apify token is not set, or the switch could not be read). The
// refresh then saves the feed without LinkedIn posts and says so
// (refreshFeed.ts), and the feed job runs it again in 10 minutes while its
// attempts last (run-scheduled-jobs/feed.ts). Each try runs at most one
// in-app run, so the job's attempts bound what a window costs.

import { checkLinkedInAnswer, type LinkedInSource } from "../competitive/linkedinSource.ts";
import type { ResolvedEngine } from "./engine.ts";
import { runPipelineInline, type InlineDeps } from "./inline.ts";
import { createInlineRun, makeRunStore, makeStepLog, makeStepServices } from "./store.ts";

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

/**
 * The LinkedIn source's answer for a feed refresh, from the engine the
 * switch picked. n8n() is the n8n workflow call, made only for a switch set
 * to n8n or shadow. On app it throws when LinkedIn could not be collected.
 */
export async function feedLinkedInAnswer(db: Db, engine: ResolvedEngine, a: FeedLinkedInArgs, n8n: () => Promise<Answer>): Promise<Answer> {
  if (engine.engine !== "app") return await n8n();
  if (!a.sources.length) return { socialPosts: [], additional_metrics: {} };
  if (!engine.pipeline) throw new Error(engine.refused ?? "No in-app LinkedIn pipeline can run.");
  const now = a.now ?? (() => new Date());
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
