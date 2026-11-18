// "Sync from Sprout": the Sprout onboarding run, started by a staff member
// on top of the weekly one (the owner, 18 Nov 2026).
//
// Nothing here runs the onboarding. startSproutSync queues the same
// sprout_onboarding job the weekly clock queues, through
// enqueue_sprout_onboarding_now (20261118130000_sprout_sync_now.sql), which
// queues nothing while a run is queued or running; the per-minute worker
// runs it (run-scheduled-jobs/sproutOnboarding.ts). sproutSyncStatus says
// where the run stands, read from the queue with the service role (staff
// have no access to scheduled_jobs), in the few words the dashboard needs:
// whether a run is under way, and what the newest finished run added.
//
// A run is one job, or a job and the jobs it left its brands to
// (sprout_onboarding:rest:<the job before>), so the clients a run added are
// read from every job of it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Db = SupabaseClient;

/** How many of the newest sprout_onboarding jobs are read: a run and the jobs it left its brands to are among them. */
const RECENT = 50;
const REST = /^sprout_onboarding:rest:(.+)$/;

interface JobRow {
  id: string;
  dedupe_key: string | null;
  status: string;
  attempts: number | null;
  created_at: string | null;
  finished_at: string | null;
}

export interface SyncStatus {
  /** A run is queued or running: the weekly one, one a person started, or the rest of either. */
  open: boolean;
  /** The run under way is on another try: an earlier try did not finish. */
  slow: boolean;
  /** The newest run that is over, when none is under way: whether it finished, and the clients it added. */
  last: { finished: boolean; finished_at: string | null; added: Array<{ id: string; name: string }> } | null;
}

const isOpen = (j: JobRow) => j.status === "queued" || j.status === "running";

/** A job and the jobs before it in its run, newest first. */
function runOf(rows: JobRow[], head: JobRow): JobRow[] {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const run = [head];
  for (let job = head; ;) {
    const before = byId.get(REST.exec(String(job.dedupe_key ?? ""))?.[1] ?? "");
    if (!before || run.includes(before)) return run;
    run.push(before);
    job = before;
  }
}

/** Where the Sprout onboarding stands now. */
export async function sproutSyncStatus(db: Db): Promise<SyncStatus> {
  const { data, error } = await db.from("scheduled_jobs")
    .select("id, dedupe_key, status, attempts, created_at, finished_at")
    .eq("kind", "sprout_onboarding")
    .order("created_at", { ascending: false })
    .limit(RECENT);
  if (error) throw new Error(`Could not read the Sprout onboarding jobs: ${error.message}`);
  const rows = (data ?? []) as JobRow[];

  const open = rows.filter(isOpen);
  if (open.length) {
    // Waiting for another try, or on a second one.
    const slow = open.some((j) => (j.status === "queued" ? Number(j.attempts ?? 0) >= 1 : Number(j.attempts ?? 0) >= 2));
    return { open: true, slow, last: null };
  }
  const newest = rows[0];
  if (!newest) return { open: false, slow: false, last: null };

  const run = runOf(rows, newest);
  const { data: results, error: resultsError } = await db.from("scheduled_jobs")
    // Only the ids of the clients each job made: a job's whole result lists every Sprout brand.
    .select("id, created:result->created")
    .in("id", run.map((j) => j.id));
  if (resultsError) throw new Error(`Could not read what the Sprout onboarding added: ${resultsError.message}`);
  const ids = [...new Set(((results ?? []) as Array<{ created?: unknown }>).flatMap((r) => (Array.isArray(r.created) ? r.created.map(String) : [])))];

  let added: Array<{ id: string; name: string }> = [];
  if (ids.length) {
    const { data: clients, error: clientsError } = await db.from("clients").select("id, name").in("id", ids);
    if (clientsError) throw new Error(`Could not read the clients the Sprout onboarding added: ${clientsError.message}`);
    added = ((clients ?? []) as Array<{ id: string; name: string | null }>)
      .map((c) => ({ id: String(c.id), name: String(c.name ?? "") }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }
  return { open: false, slow: false, last: { finished: newest.status === "done", finished_at: newest.finished_at ?? null, added } };
}

/**
 * Queue a run for now, unless one is queued or running. `started` says a
 * run was queued by this call; `job_id` names the run, this one or the one
 * already under way.
 */
export async function startSproutSync(db: Db): Promise<{ started: boolean; job_id: string | null }> {
  const { data, error } = await db.rpc("enqueue_sprout_onboarding_now");
  if (error) throw new Error(`Could not queue the Sprout onboarding: ${error.message}`);
  const answer = (data ?? {}) as { queued?: unknown; job_id?: unknown };
  return { started: answer.queued === true, job_id: typeof answer.job_id === "string" ? answer.job_id : null };
}
