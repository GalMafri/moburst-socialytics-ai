// Shapes shared by the in-app report pipelines: the engine switch, the step
// runner, the shadow storage and the pipelines themselves.
//
// Moving the report workflows from n8n into the app happens behind one switch
// per report kind and client (report_engines):
//   n8n     today's path, unchanged. n8n is the live engine and the backup.
//   shadow  n8n still runs for real, and the in-app pipeline runs next to it,
//           writing only to shadow storage, so the two can be compared.
//   app     only the in-app pipeline runs, and writes the real report.
// The tables are in supabase/migrations/20261020110000_inhouse_groundwork.sql.

/**
 * In-app runs of one report (or of one LinkedIn source window) that may stop
 * before n8n, the backup, makes it instead.
 */
export const APP_STOPS_BEFORE_N8N = 2;

/** The three report workflows that serve Socialytics today. */
export type ReportKind = "social" | "competitive" | "linkedin_source";
export const REPORT_KINDS: readonly ReportKind[] = ["social", "competitive", "linkedin_source"];

/** What a report_engines row asks for. */
export type Engine = "n8n" | "app" | "shadow";
export const ENGINES: readonly Engine[] = ["n8n", "app", "shadow"];

/** How an in-app pipeline run writes: shadow storage only, or the real report. */
export type RunMode = "shadow" | "app";

/** The real tables a run is linked to. A shadow run only points at them; it never writes them. */
export type RealTable = "reports" | "competitive_reports" | "rivaliq_snapshots";

/** A row of public.report_pipeline_runs. */
export interface PipelineRun {
  id: string;
  kind: ReportKind;
  pipeline: string;
  mode: RunMode;
  app_capable: boolean;
  client_id: string;
  real_table: RealTable | null;
  /** The real run this one shadows (shadow), or the report it makes (app). No foreign key: see the migration. */
  real_id: string | null;
  real_ref: Record<string, unknown> | null;
  /** What the run was asked to do: the range, the set, and the request n8n was (or would be) sent. */
  input: Record<string, unknown>;
  status: "running" | "done" | "stopped";
  step: string | null;
  steps_done: number;
  /** When the runner last ran a step of the run, whatever came of it. The 90-minute stuck rule reads this for a run that makes a real report. */
  heartbeat_at: string;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  job_id: string | null;
}

/** An external job a step is waiting on (an Apify run, a Claude message batch, a Gamma generation). */
export interface PollState {
  /** Whatever the step needs to look the job up again, such as { apify_run_id }. Kept small. */
  handle: Record<string, unknown>;
  /** How many times the step has looked. */
  polls: number;
  /** When the step first scheduled a poll for this handle. */
  since: string;
}

/** scheduled_jobs.payload of a report_pipeline job. */
export interface PipelineJobPayload {
  run_id: string;
  pipeline: string;
  step: string;
  /** Small state carried from step to step (at most STATE_MAX_BYTES). Large data goes to the payload store. */
  state: Record<string, unknown>;
  poll?: PollState | null;
}

/**
 * Large in-between data (a raw scraper dataset, a long model answer), kept
 * outside the job and the run so neither grows. Expires on its own.
 */
export interface PayloadStore {
  put(key: string, value: unknown): Promise<{ key: string; bytes: number }>;
  get<T = unknown>(key: string): Promise<T | null>;
}

/**
 * Where a pipeline's results go. target "report" is the report itself; any
 * other target is a secondary output (a snapshot n8n also caches, for one).
 * In shadow mode every target lands in shadow storage. In app mode each
 * target needs a writer registered for the kind; there are none yet, which is
 * one reason the app engine cannot be switched on.
 */
export interface OutputWriter {
  write(target: string, data: Record<string, unknown>): Promise<void>;
}

/** What a step is given. A step reads through db, and writes only through output and payloads. */
export interface StepContext<S extends Record<string, unknown> = Record<string, unknown>> {
  run: PipelineRun;
  step: string;
  /** 1 on the first try of this step, more on a retry. */
  attempt: number;
  state: S;
  /** Set when the step is called back to look at an external job it started. */
  poll: PollState | null;
  now(): Date;
  /** Aborts when the step's time is up; pass it to every fetch. */
  signal: AbortSignal;
  /** When the step must have returned by. */
  deadline: Date;
  payloads: PayloadStore;
  output: OutputWriter;
  /** Read-only: from(table).select(...) works, any write throws. */
  // deno-lint-ignore no-explicit-any
  db: any;
  env(name: string): string | undefined;
}

/** What a step came to. A step that cannot go on throws; the runner retries it quietly. */
export type StepResult<S extends Record<string, unknown> = Record<string, unknown>> =
  | { type: "next"; step: string; state?: S; detail?: Record<string, unknown> }
  | {
    type: "poll";
    /** Seconds until the step is called again to look. */
    waitSeconds: number;
    handle: Record<string, unknown>;
    state?: S;
    detail?: Record<string, unknown>;
  }
  | { type: "done"; state?: S; detail?: Record<string, unknown> };

export type Step<S extends Record<string, unknown> = Record<string, unknown>> = (ctx: StepContext<S>) => Promise<StepResult<S>>;

/** One in-app pipeline, registered in registry.ts. */
export interface PipelineDefinition<S extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  kind: ReportKind;
  /** The modes it may run in. A placeholder runs only in shadow. */
  modes: readonly RunMode[];
  /**
   * True only for a pipeline that makes the real report (it has writers for
   * every target it writes in app mode). The database refuses the app engine
   * for a kind until an app-capable pipeline has finished a shadow run.
   */
  appCapable: boolean;
  /** The secrets it reads (secrets.ts); a pipeline whose secrets are not all set is never chosen. */
  secrets: readonly string[];
  /**
   * Secrets a run waits for, quietly, while they are not set (APIFY_API_TOKEN
   * before the owner adds it): a shadow is still chosen and its step waits
   * and looks again, saying so in its step log. App mode needs them set, so
   * a real report never waits on a missing secret: the kind stays on n8n.
   */
  awaitedSecrets?: readonly string[];
  first: string;
  steps: Record<string, Step<S>>;
  /** Tries of one step before the run stops (default MAX_STEP_ATTEMPTS). */
  maxStepAttempts?: number;
  /** How long one external job may be polled before it counts as a failed try (default MAX_POLL_MINUTES). */
  maxPollMinutes?: number;
  /** How long the whole run may take before it stops (default MAX_RUN_HOURS). */
  maxRunHours?: number;
}
