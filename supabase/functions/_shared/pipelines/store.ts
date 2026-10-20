// The in-app pipelines' storage over supabase-js: runs, the step log, the
// payload store, shadow results, and the read-only database a step reads
// through. Tables: supabase/migrations/20261020110000_inhouse_groundwork.sql.
//
// A shadow run writes only to report_pipeline_runs, report_pipeline_steps,
// the shadow_* tables and the pipeline-payloads bucket (with its index).
// Nothing a screen reads is among them. A step never gets a writable client:
// it writes through ctx.output and ctx.payloads, which this file builds.

import type { RunStore, StepLog, StepServices } from "./runner.ts";
import type { OutputWriter, PayloadStore, PipelineDefinition, PipelineRun, RealTable, ReportKind, RunMode } from "./types.ts";
import { COMPETITIVE_WRITERS } from "./writers.ts";

export const PAYLOAD_BUCKET = "pipeline-payloads";
/** How long in-between data is kept. */
export const PAYLOAD_TTL_DAYS = 30;
/** Expired payloads removed per sweep. */
export const PAYLOAD_EXPIRY_BATCH = 500;

const DAY = 86_400_000;

// deno-lint-ignore no-explicit-any
type Db = any;
type Result<T> = { data: T; error: { message: string } | null };
async function must<T>(p: PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

/** The tables a shadow run writes, and the only ones. */
export const SHADOW_WRITABLE_TABLES: readonly string[] = [
  "report_pipeline_runs", "report_pipeline_steps", "pipeline_payloads",
  "shadow_social_reports", "shadow_competitive_reports", "shadow_linkedin_sources",
];

/** The shadow table that holds each kind's result. */
export const SHADOW_TABLE: Record<ReportKind, string> = {
  social: "shadow_social_reports",
  competitive: "shadow_competitive_reports",
  linkedin_source: "shadow_linkedin_sources",
};

export class PipelineWriteRefused extends Error {
  constructor(what: string) {
    super(`A pipeline step writes only through ctx.output and ctx.payloads, not ${what}.`);
    this.name = "PipelineWriteRefused";
  }
}

/** A database a step can read and never write: from(table).select(...) only. */
export function readOnlyDb(db: Db) {
  const refuse = (what: string) => () => { throw new PipelineWriteRefused(what); };
  return {
    from(table: string) {
      return {
        select: (...args: unknown[]) => db.from(table).select(...args),
        insert: refuse(`an insert into ${table}`),
        update: refuse(`an update of ${table}`),
        upsert: refuse(`an upsert into ${table}`),
        delete: refuse(`a delete from ${table}`),
      };
    },
    rpc: refuse("a database function"),
    storage: { from: refuse("storage") },
  };
}

// ── Runs and the step log ───────────────────────────────────────────────────

export function makeRunStore(db: Db): RunStore {
  return {
    async get(runId) {
      return (await must(db.from("report_pipeline_runs").select("*").eq("id", runId).maybeSingle())) as PipelineRun | null;
    },
    async touch(runId, patch) {
      await must(db.from("report_pipeline_runs").update({
        step: patch.step, heartbeat_at: patch.at, ...(patch.steps_done !== undefined ? { steps_done: patch.steps_done } : {}),
      }).eq("id", runId).eq("status", "running"));
    },
    async finish(runId, status, outcome, at) {
      await must(db.from("report_pipeline_runs").update({ status, outcome, finished_at: at, heartbeat_at: at })
        .eq("id", runId).eq("status", "running"));
    },
  };
}

export function makeStepLog(db: Db): StepLog {
  return {
    async start(row) {
      const r = (await must(db.from("report_pipeline_steps").insert(row).select("id").single())) as { id: string | number };
      return r.id;
    },
    async end(id, row) {
      await must(db.from("report_pipeline_steps").update(row).eq("id", id));
    },
  };
}

// ── Payload store ───────────────────────────────────────────────────────────

const KEY = /^[a-z0-9][a-z0-9_.-]{0,119}$/i;

/** Large in-between data for one run, in the private pipeline-payloads bucket, indexed for expiry. */
export function makePayloadStore(db: Db, runId: string, opts: { now?: () => Date; ttlDays?: number } = {}): PayloadStore {
  const now = opts.now ?? (() => new Date());
  const path = (key: string) => `runs/${runId}/${key}.json`;
  const check = (key: string) => { if (!KEY.test(key)) throw new Error(`Payload key ${JSON.stringify(key)} is not a plain name.`); };
  return {
    async put(key, value) {
      check(key);
      const body = JSON.stringify(value ?? null);
      const bytes = new TextEncoder().encode(body);
      const { error } = await db.storage.from(PAYLOAD_BUCKET).upload(path(key), bytes, { contentType: "application/json", upsert: true });
      if (error) throw new Error(`The payload ${key} could not be stored: ${error.message}`);
      const at = now();
      await must(db.from("pipeline_payloads").upsert({
        run_id: runId, key, storage_path: path(key), bytes: bytes.byteLength,
        created_at: at.toISOString(), expires_at: new Date(at.getTime() + (opts.ttlDays ?? PAYLOAD_TTL_DAYS) * DAY).toISOString(),
      }, { onConflict: "run_id,key" }));
      return { key, bytes: bytes.byteLength };
    },
    async get<T>(key: string) {
      check(key);
      const row = (await must(db.from("pipeline_payloads").select("storage_path").eq("run_id", runId).eq("key", key).maybeSingle())) as { storage_path: string } | null;
      if (!row) return null;
      const { data, error } = await db.storage.from(PAYLOAD_BUCKET).download(row.storage_path);
      if (error || !data) return null;
      return JSON.parse(new TextDecoder().decode(await data.arrayBuffer())) as T;
    },
  };
}

/**
 * Removes expired payloads: the stored files first (through the Storage API,
 * which is the only way to delete them), then their index rows. Run by the
 * daily sweep.
 */
export async function expirePayloads(db: Db, now: Date, limit = PAYLOAD_EXPIRY_BATCH): Promise<number> {
  const rows = (await must(db.from("pipeline_payloads").select("storage_path").lt("expires_at", now.toISOString()).limit(limit))) as Array<{ storage_path: string }> | null;
  const paths = (rows ?? []).map((r) => r.storage_path);
  if (!paths.length) return 0;
  const { error } = await db.storage.from(PAYLOAD_BUCKET).remove(paths);
  if (error) throw new Error(`Expired payloads could not be removed: ${error.message}`);
  await must(db.from("pipeline_payloads").delete().in("storage_path", paths));
  return paths.length;
}

// ── Outputs ─────────────────────────────────────────────────────────────────

/** Every target of a shadow run lands in shadow storage: the report in the kind's shadow table, anything else in the payload store. */
export function makeShadowOutput(db: Db, run: PipelineRun, payloads: PayloadStore): OutputWriter {
  const input = (run.input ?? {}) as { range?: { start?: string; end?: string }; set_id?: string; period?: { start?: string; end?: string }; sources?: unknown };
  return {
    async write(target, data) {
      if (target !== "report") {
        await payloads.put(`output.${target}`, data);
        return;
      }
      const at = new Date().toISOString();
      if (run.kind === "linkedin_source") {
        await must(db.from(SHADOW_TABLE.linkedin_source).upsert({
          run_id: run.id, client_id: run.client_id, real_ref: run.real_ref,
          period_start: input.period?.start ?? null, period_end: input.period?.end ?? null,
          sources: input.sources ?? [], result: data, updated_at: at,
        }, { onConflict: "run_id" }));
        return;
      }
      await must(db.from(SHADOW_TABLE[run.kind]).upsert({
        run_id: run.id, client_id: run.client_id, real_report_id: run.real_id,
        date_range_start: input.range?.start ?? null, date_range_end: input.range?.end ?? null,
        ...(run.kind === "competitive" ? { set_id: input.set_id ?? null } : {}),
        report_data: data, updated_at: at,
      }, { onConflict: "run_id" }));
    },
  };
}

/**
 * Writes one target of a real report. The registry refuses app mode for a
 * kind with no "report" writer. A writer writes only while the report is
 * still running (the dispatch may have taken it away and started another),
 * as n8n's callbacks are fenced today.
 *
 *   competitive      the report and its RivalIQ snapshots, through the
 *                    writer update-competitive-report uses (writers.ts).
 *   linkedin_source  the answer, kept with the run: the feed refresh that
 *                    runs it in-process (inline.ts) uses it, as it used the
 *                    n8n workflow's answer, and saves the feed itself.
 *   social           none yet.
 */
export type RealWriter = (db: Db, run: PipelineRun, data: Record<string, unknown>) => Promise<void>;
export const REAL_WRITERS: Record<ReportKind, Record<string, RealWriter>> = {
  social: {},
  competitive: COMPETITIVE_WRITERS,
  linkedin_source: {
    report: async (db, run, data) => { await makePayloadStore(db, run.id).put("result", data); },
  },
};

export function makeAppOutput(db: Db, run: PipelineRun, writers: Record<ReportKind, Record<string, RealWriter>> = REAL_WRITERS): OutputWriter {
  return {
    async write(target, data) {
      const writer = writers[run.kind]?.[target];
      if (!writer) throw new Error(`No writer for the ${run.kind} ${target} is registered, so the in-app pipeline cannot write the real report.`);
      await writer(db, run, data);
    },
  };
}

/** What a step of a run is given: shadow storage or the real writers, and a read-only database. */
export function makeStepServices(db: Db, env: (name: string) => string | undefined) {
  return (run: PipelineRun, _def: PipelineDefinition): StepServices => {
    const payloads = makePayloadStore(db, run.id);
    return {
      payloads,
      output: run.mode === "shadow" ? makeShadowOutput(db, run, payloads) : makeAppOutput(db, run),
      db: readOnlyDb(db),
      env,
    };
  };
}

// ── Starting a run ──────────────────────────────────────────────────────────

export interface StartRun {
  mode: RunMode;
  pipeline: PipelineDefinition;
  clientId: string;
  realTable: RealTable | null;
  realId: string | null;
  realRef?: Record<string, unknown> | null;
  input: Record<string, unknown>;
  /** One run per key: asking again returns the run already made. */
  dedupe: string;
}

/**
 * Makes the row of a run a caller takes in-process (inline.ts): no job is
 * queued for it, its caller runs the steps. Mode app only.
 */
export async function createInlineRun(db: Db, row: Record<string, unknown>): Promise<PipelineRun> {
  if (row.mode !== "app") throw new Error("Only an app run is taken in-process.");
  return (await must(db.from("report_pipeline_runs").insert(row).select("*").single())) as PipelineRun;
}

/** Makes the run and its first job in one transaction (report_pipeline_start). */
export async function startPipelineRun(db: Db, a: StartRun): Promise<{ run_id: string; started: boolean }> {
  if (!a.pipeline.modes.includes(a.mode)) throw new Error(`Pipeline ${a.pipeline.name} does not run in ${a.mode} mode.`);
  const r = (await must(db.rpc("report_pipeline_start", {
    p_kind: a.pipeline.kind, p_mode: a.mode, p_pipeline: a.pipeline.name, p_app_capable: a.pipeline.appCapable,
    p_client: a.clientId, p_real_table: a.realTable, p_real_id: a.realId, p_real_ref: a.realRef ?? null,
    p_input: a.input, p_first_step: a.pipeline.first, p_dedupe: a.dedupe,
  }))) as { run_id: string; started: boolean } | null;
  if (!r?.run_id) throw new Error("The pipeline run was not made.");
  return r;
}

/** The in-app run that makes a report, as the dispatch watches it. */
export interface AppRunView {
  status: PipelineRun["status"];
  heartbeat_at: string;
  outcome: string | null;
}

export async function appRunView(db: Db, reportId: string): Promise<AppRunView | null> {
  return (await must(db.from("report_pipeline_runs").select("status, heartbeat_at, outcome").eq("real_id", reportId).eq("mode", "app")
    .order("started_at", { ascending: false }).limit(1).maybeSingle())) as AppRunView | null;
}

// ── Comparing ───────────────────────────────────────────────────────────────

/**
 * A shadow run's result and the real result it shadows, for compareResults
 * (compare.ts). For a report, the real report's report_data; for the LinkedIn
 * source, what the n8n workflow answered (kept with the run).
 */
export async function loadShadowPair(db: Db, runId: string): Promise<{ run: PipelineRun; real: unknown; shadow: unknown } | null> {
  const run = (await must(db.from("report_pipeline_runs").select("*").eq("id", runId).maybeSingle())) as PipelineRun | null;
  if (!run) return null;
  if (run.kind === "linkedin_source") {
    const shadow = (await must(db.from(SHADOW_TABLE.linkedin_source).select("result").eq("run_id", run.id).maybeSingle())) as { result: unknown } | null;
    return { run, real: await makePayloadStore(db, run.id).get("real.output"), shadow: shadow?.result ?? null };
  }
  const shadow = (await must(db.from(SHADOW_TABLE[run.kind]).select("report_data").eq("run_id", run.id).maybeSingle())) as { report_data: unknown } | null;
  const real = run.real_table && run.real_id
    ? (await must(db.from(run.real_table).select("report_data").eq("id", run.real_id).maybeSingle())) as { report_data: unknown } | null
    : null;
  return { run, real: real?.report_data ?? null, shadow: shadow?.report_data ?? null };
}
