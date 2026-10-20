// Shapes shared by the scheduled-jobs worker, its store and its tests.

export type JobKind = "feed_refresh" | "dispatch" | "week_plan" | "week_revise" | "voice_profile" | "lifecycle" | "lifecycle_step" | "report_text";
export type JobStatus = "queued" | "running" | "waiting" | "blocked" | "done" | "skipped" | "failed";

/** One step of an in-app report pipeline (_shared/pipelines/runner.ts), run in its own lane of the worker. */
export type PipelineJobKind = "report_pipeline";

/** A row of public.scheduled_jobs. */
export interface ScheduledJob {
  id: string;
  kind: JobKind | PipelineJobKind;
  client_id: string;
  schedule_id: string | null;
  occurrence: string | null;
  priority: number;
  stagger_seconds: number;
  status: JobStatus;
  phase: "prepared" | "posting" | "sent" | null;
  report_id: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  lease_until: string | null;
  reason: string | null;
  result: Record<string, unknown> | null;
  /** What a lifecycle_step job runs ({ step, force }), or a manual report run (dispatch.ts ManualRun). */
  payload?: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** What running a job came to. The worker writes it back to the row. */
export interface JobOutcome {
  status: JobStatus;
  reason?: string | null;
  result?: Record<string, unknown> | null;
  /** For a retry: when the job may be leased again. */
  available_at?: string;
  /** Waiting on another job (a week plan waits for the voice profile): the lease doesn't count as an attempt. */
  deferred?: boolean;
  /** A report_pipeline job's next payload (the step it runs next, its state). Left as is when absent. */
  payload?: Record<string, unknown> | null;
  /** The job moved on to new work (a pipeline's next step): its attempts start again from none. */
  resetAttempts?: boolean;
}

/** Terminal states: the job is finished and finished_at is set. */
export const TERMINAL: ReadonlySet<JobStatus> = new Set(["done", "skipped", "failed"]);
