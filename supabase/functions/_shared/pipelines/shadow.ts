// Starting in-app pipeline runs from the two places that start n8n today:
// the scheduled dispatch (social and competitive reports) and the competitor
// feed refresh (the LinkedIn source).
//
// A shadow start never changes the real run: it is called after n8n has the
// request (or, for the LinkedIn source, after n8n answered), it never throws,
// and asking twice for the same real run makes one shadow run.

import type { ResolvedEngine } from "./engine.ts";
import { makePayloadStore, startPipelineRun } from "./store.ts";
import type { PipelineDefinition, RunMode } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** One report's in-app run: the shadow next to an n8n run, or the run that makes the report. */
export interface ReportPipelineStart {
  mode: RunMode;
  kind: "social" | "competitive";
  pipeline: PipelineDefinition;
  clientId: string;
  reportId: string;
  range: { start: string; end: string };
  setId?: string | null;
  /** The request n8n gets for this report, so both engines are given the same input. */
  request: Record<string, unknown>;
}

/**
 * Queues a report's in-app run. Throws when it could not be queued (the
 * dispatch decides what that means). A social run carries its report's
 * attempt (created_at): the social writer writes only that attempt, as the
 * competitive writer writes only the request's attempt_started_at.
 */
export async function startReportPipeline(db: Db, a: ReportPipelineStart): Promise<{ run_id: string; started: boolean }> {
  let attempt: Record<string, unknown> = {};
  if (a.kind === "social") {
    const { data, error } = await db.from("reports").select("created_at").eq("id", a.reportId).maybeSingle();
    if (error) throw new Error(`The report could not be read: ${error.message}`);
    if (!data?.created_at) throw new Error("The report is gone.");
    attempt = { attempt_started_at: data.created_at };
  }
  return await startPipelineRun(db, {
    mode: a.mode,
    pipeline: a.pipeline,
    clientId: a.clientId,
    realTable: a.kind === "competitive" ? "competitive_reports" : "reports",
    realId: a.reportId,
    input: { range: a.range, ...(a.setId ? { set_id: a.setId } : {}), ...attempt, request: a.request },
    dedupe: `${a.mode}:${a.kind}:${a.reportId}`,
  });
}

export interface LinkedInRun {
  clientId: string;
  sources: Array<{ company_id: string; name: string; profile_url: string }>;
  period: { start: string; end: string };
  /** What the n8n workflow answered, kept so the shadow can be compared with it. */
  real: unknown;
  now?: () => Date;
}

/**
 * The LinkedIn source's shadow, after the n8n workflow answered for real.
 * Does nothing unless the switch says shadow for this client. Never throws.
 */
export async function shadowLinkedInSource(db: Db, engine: ResolvedEngine, a: LinkedInRun): Promise<string | null> {
  if (engine.engine !== "shadow" || !engine.pipeline || !a.sources.length) return null;
  try {
    const at = (a.now ?? (() => new Date()))();
    const { run_id, started } = await startPipelineRun(db, {
      mode: "shadow",
      pipeline: engine.pipeline,
      clientId: a.clientId,
      realTable: "rivaliq_snapshots",
      realId: null,
      // The feed snapshot this refresh saves: the client's newest 'feed' snapshot for this window.
      realRef: { client_id: a.clientId, endpoint: "feed", window: a.period, requested_at: at.toISOString() },
      input: { sources: a.sources, period: a.period },
      dedupe: `shadow:linkedin_source:${a.clientId}:${a.period.start}:${a.period.end}:${at.toISOString().slice(0, 16)}`,
    });
    if (started) await makePayloadStore(db, run_id).put("real.output", a.real);
    return run_id;
  } catch (e) {
    console.warn("[pipelines] LinkedIn source shadow was not started:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
