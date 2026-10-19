// supabase/functions/_shared/lifecycle/run.ts
//
// The client lifecycle's two jobs in the scheduled-jobs queue:
//   lifecycle       look at one client's steps and queue the ones that are due
//                   (daily for every active client, and at once when a client
//                   is created or an input of a step changes);
//   lifecycle_step  run one step and store what it came to.
// A step's own outcome (waiting for posts, a provider down for an hour) lives
// on its client_lifecycle_steps row with its retry time; the queue job only
// fails when the lifecycle itself cannot run. After a step finishes, the
// client is looked at again: at once when it produced something (the steps
// after it may now be due), or when its retry or recheck time comes, so a
// new client goes through every step in minutes and a retry happens on time.
//
// A demo copy (a client the API demo made for a prospect) runs only the steps
// its demo job asks for, through runStepNow: no tracking slots, Sprout
// accounts, schedules or plans are taken for a prospect.

import { decide, rowAfter, STALE_RUN_MS, type StepOutcome, type StepRow } from "./policy.ts";
import { CLIENT_COLUMNS, STEPS, type ClientRow } from "./steps.ts";

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

/** Look at the client again at this time. One look per client per minute, however many steps ask. */
export async function queueLook(db: Db, clientId: string, at: Date): Promise<void> {
  const minute = at.toISOString().slice(0, 16);
  const { error } = await db.from("scheduled_jobs").upsert({
    kind: "lifecycle", client_id: clientId, dedupe_key: `lifecycle:${clientId}:${minute}`, priority: 30, available_at: at.toISOString(),
  }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) console.warn("[lifecycle] could not queue the next look:", error.message);
}

/** When the client should be looked at after a step's outcome: now for a result, at its time for a wait or a retry. */
export function nextLookAt(row: StepRow, outcome: StepOutcome, now: Date): Date | null {
  if (outcome.status === "done") return now;
  return row.next_attempt_at ? new Date(Math.max(now.getTime(), Date.parse(row.next_attempt_at))) : null;
}

const isDemo = (client: ClientRow) => !!client.demo_job_id;

export async function runLifecycle(db: Db, job: LifecycleJob, now = new Date()): Promise<LifecycleOutcome> {
  const client = await readClient(db, job.client_id);
  if (!client) return { status: "skipped", reason: "The client no longer exists." };
  if (client.archived_at) return { status: "skipped", reason: "The client is archived." };
  if (isDemo(client)) return { status: "skipped", reason: "A demo copy runs the steps its demo job asks for." };
  const rows = await readRows(db, client.id);
  const queued: string[] = [];
  for (const [step, def] of Object.entries(STEPS)) {
    const inputsKey = await def.inputs(db, client, rows);
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

/** Run a claimed step and store its outcome. The row before the claim is the one to compare with. */
async function execute(db: Db, client: ClientRow, rows: Map<string, StepRow>, step: string, inputsKey: string, force: boolean): Promise<{ row: StepRow; outcome: StepOutcome }> {
  const def = STEPS[step];
  const prev = rows.get(step) ?? null;
  const base = { client_id: client.id, step, inputs_key: inputsKey };
  let outcome: StepOutcome;
  try {
    outcome = await def.run(db, client, { force, previous: prev && prev.inputs_key === inputsKey ? prev : null, rows });
  } catch (e) {
    outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  const row = rowAfter(prev, base, outcome, new Date());
  await saveRow(db, row);
  const at = nextLookAt(row, outcome, new Date());
  if (at && !isDemo(client)) await queueLook(db, client.id, at);
  return { row, outcome };
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
  const inputsKey = await def.inputs(db, client, rows);
  if (inputsKey === null) {
    await saveRow(db, rowAfter(prev, { client_id: client.id, step, inputs_key: "" }, { status: "waiting", reason: "input" }, now));
    return { status: "done", reason: `${step}: waiting for its input.` };
  }
  const { outcome } = await execute(db, client, rows, step, inputsKey, job.payload?.force === true);
  return { status: "done", reason: `${step}: ${outcome.status}`, result: { step, outcome: outcome.status } };
}

/** What a step stands at, as a caller outside the queue (the API demo) reads it. */
export interface StepView {
  status: "done" | "waiting" | "failed" | "running" | "no_input";
  /** The step's stored result. */
  result: Record<string, unknown> | null;
  error: string | null;
  /** What a waiting step waits for ("in_progress" while work it started is under way). */
  waiting_for: string | null;
  /** True when this call ran the step. */
  ran: boolean;
}

const view = (row: StepRow | null, ran: boolean, status?: StepView["status"]): StepView => ({
  status: status ?? (row?.status as StepView["status"]) ?? "no_input",
  result: row?.result ?? null,
  error: row?.error ?? null,
  waiting_for: row?.status === "waiting" ? String((row.result as Record<string, unknown> | null)?.waiting_for ?? "") || null : null,
  ran,
});

/**
 * Bring one step of one client up to date now, in this request: run it when
 * it is due (or when work it started is under way), else answer with what
 * it stored. The API demo drives its onboarding through this, so the demo
 * and every client share one onboarding path. A step another run holds
 * answers "running".
 */
export async function runStepNow(db: Db, clientId: string, step: string, now = new Date()): Promise<StepView> {
  const def = STEPS[step];
  if (!def) throw new Error(`Unknown lifecycle step ${step}.`);
  const client = await readClient(db, clientId);
  if (!client || client.archived_at) return view(null, false, "no_input");
  const rows = await readRows(db, client.id);
  const row = rows.get(step) ?? null;
  const inputsKey = await def.inputs(db, client, rows);
  if (inputsKey === null) return view(row, false, "no_input");
  const d = decide(row, inputsKey, def.policy, now);
  const continuing = row?.status === "waiting" && row.inputs_key === inputsKey && (row.result as Record<string, unknown> | null)?.waiting_for === "in_progress";
  if (!d.due && !continuing) return view(row, false, row?.status === "running" ? "running" : undefined);
  if (!(await claimStep(db, row, client.id, step, now))) return view(row, false, "running");
  const { row: after } = await execute(db, client, rows, step, inputsKey, d.force);
  return view(after, true);
}
