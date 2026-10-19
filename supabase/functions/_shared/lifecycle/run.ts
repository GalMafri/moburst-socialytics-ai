// supabase/functions/_shared/lifecycle/run.ts
//
// The client lifecycle's two jobs in the scheduled-jobs queue:
//   lifecycle       look at one client's steps and queue the ones that are due
//                   (daily for every active client, and at once when a client
//                   is created or its website or social accounts change);
//   lifecycle_step  run one step and store what it came to.
// A step's own outcome (waiting for posts, a provider down for an hour) lives
// on its client_lifecycle_steps row with its retry time; the queue job only
// fails when the lifecycle itself cannot run.

import { decide, rowAfter, STALE_RUN_MS, type StepRow } from "./policy.ts";
import { STEPS, type ClientRow } from "./steps.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface LifecycleJob {
  id: string;
  client_id: string;
  payload: { step?: string; force?: boolean } | null;
}

export interface LifecycleOutcome {
  status: "done" | "skipped";
  reason?: string | null;
  result?: Record<string, unknown> | null;
}

const STEP_COLUMNS = "client_id, step, inputs_key, status, attempts, attempted_at, done_at, next_attempt_at, result, error";
const CLIENT_COLUMNS = "id, name, archived_at, sprout_customer_id, website_url";

async function readClient(db: Db, clientId: string): Promise<ClientRow | null> {
  const { data, error } = await db.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the client: ${error.message}`);
  return data;
}

async function readRows(db: Db, clientId: string): Promise<Map<string, StepRow>> {
  const { data, error } = await db.from("client_lifecycle_steps").select(STEP_COLUMNS).eq("client_id", clientId);
  if (error) throw new Error(`Could not read the client's lifecycle: ${error.message}`);
  return new Map((data ?? []).map((r: StepRow) => [r.step, r]));
}

/**
 * Mark a step running, only if no live run holds it: two lifecycle looks at
 * the same client (a save and the daily tick) can never both queue it.
 */
async function claimStep(db: Db, row: StepRow | null, clientId: string, step: string, now: Date): Promise<boolean> {
  const at = now.toISOString();
  if (!row) {
    const { data, error } = await db.from("client_lifecycle_steps")
      .upsert({ client_id: clientId, step, status: "running", attempted_at: at, updated_at: at }, { onConflict: "client_id,step", ignoreDuplicates: true })
      .select("step");
    if (error) throw new Error(`Could not claim the ${step} step: ${error.message}`);
    return !!data?.length;
  }
  const stale = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const { data, error } = await db.from("client_lifecycle_steps").update({ status: "running", attempted_at: at, updated_at: at })
    .eq("client_id", clientId).eq("step", step).or(`status.neq.running,attempted_at.lt."${stale}"`).select("step");
  if (error) throw new Error(`Could not claim the ${step} step: ${error.message}`);
  return !!data?.length;
}

async function saveRow(db: Db, row: StepRow): Promise<void> {
  const { error } = await db.from("client_lifecycle_steps").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "client_id,step" });
  if (error) throw new Error(`Could not save the lifecycle step: ${error.message}`);
}

export async function runLifecycle(db: Db, job: LifecycleJob, now = new Date()): Promise<LifecycleOutcome> {
  const client = await readClient(db, job.client_id);
  if (!client) return { status: "skipped", reason: "The client no longer exists." };
  if (client.archived_at) return { status: "skipped", reason: "The client is archived." };
  const rows = await readRows(db, client.id);
  const queued: string[] = [];
  for (const [step, def] of Object.entries(STEPS)) {
    const inputsKey = await def.inputs(db, client);
    const row = rows.get(step) ?? null;
    const d = decide(row, inputsKey, def.policy, now);
    if (!d.due) continue;
    // Claimed before the job exists, so a second look at the same client queues nothing.
    if (!(await claimStep(db, row, client.id, step, now))) continue;
    const { error } = await db.from("scheduled_jobs").insert({
      kind: "lifecycle_step", client_id: client.id, payload: { step, force: d.force, why: d.why },
      dedupe_key: `lifecycle_step:${step}:${client.id}:${now.getTime()}`, priority: 35, available_at: now.toISOString(),
    });
    if (error) throw new Error(`Could not queue the ${step} step: ${error.message}`);
    queued.push(`${step} (${d.why})`);
  }
  return { status: "done", reason: queued.length ? `Queued ${queued.join(", ")}.` : "Every step is current.", result: { queued } };
}

export async function runLifecycleStep(db: Db, job: LifecycleJob, now = new Date()): Promise<LifecycleOutcome> {
  const step = String(job.payload?.step ?? "");
  const def = STEPS[step];
  if (!def) return { status: "skipped", reason: `Unknown lifecycle step ${step}.` };
  const client = await readClient(db, job.client_id);
  if (!client) return { status: "skipped", reason: "The client no longer exists." };
  if (client.archived_at) return { status: "skipped", reason: "The client is archived." };
  const rows = await readRows(db, client.id);
  const prev = rows.get(step) ?? null;
  const inputsKey = await def.inputs(db, client);
  const base = { client_id: client.id, step, inputs_key: inputsKey ?? "" };
  if (inputsKey === null) {
    await saveRow(db, rowAfter(prev, base, { status: "waiting", reason: "input" }, now));
    return { status: "done", reason: `${step}: waiting for its input.` };
  }
  let outcome;
  try {
    outcome = await def.run(db, client, { force: job.payload?.force === true });
  } catch (e) {
    outcome = { status: "failed" as const, error: e instanceof Error ? e.message : String(e) };
  }
  // The row before this run is the one to compare with: a running mark keeps the previous inputs.
  await saveRow(db, rowAfter(prev, base, outcome, new Date()));
  return { status: "done", reason: `${step}: ${outcome.status}`, result: { step, outcome: outcome.status } };
}
