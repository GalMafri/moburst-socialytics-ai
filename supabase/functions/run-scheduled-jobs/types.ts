// Shapes shared by the scheduled-jobs worker, its store and its tests.

export type JobKind = "feed_refresh" | "dispatch";
export type JobStatus = "queued" | "running" | "waiting" | "blocked" | "done" | "skipped" | "failed";

/** A row of public.scheduled_jobs. */
export interface ScheduledJob {
  id: string;
  kind: JobKind;
  client_id: string;
  schedule_id: string | null;
  occurrence: string | null;
  priority: number;
  stagger_seconds: number;
  status: JobStatus;
  phase: "prepared" | "posting" | null;
  report_id: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  lease_until: string | null;
  reason: string | null;
  result: Record<string, unknown> | null;
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
}

/** Terminal states: the job is finished and finished_at is set. */
export const TERMINAL: ReadonlySet<JobStatus> = new Set(["done", "skipped", "failed"]);
