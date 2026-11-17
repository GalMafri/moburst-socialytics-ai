// supabase/functions/_shared/lifecycle/trackingNote.ts
//
// Whether each client's confirmed competitors are tracked, kept on the
// client's competitive schedule between runs.
//
// A competitive analysis runs only when the confirmed set is tracked
// (competitive/selectionTracking.ts). The dispatch writes "needs tracking" on
// the schedule when it waits, but only once the run is due, and the set and
// the lifecycle's own rows are readable by staff alone. So until the run was
// due, a client's screens had nothing to read and promised "The first
// competitive analysis runs on <date>" for a selection nothing tracked yet.
//
// The scheduled-jobs worker brings every active competitive schedule in line
// on each of its ticks (run-scheduled-jobs, once a minute): the note begins
// with NEEDS_TRACKING while the client's current set is not tracked on record
// (trackedOnRecord, the one record every screen reads), and is cleared once
// it is. It is the worker's own pass, not a lifecycle look, because nothing
// in the app looks at every client more than once a day; this way the note is
// right for every client within a minute of a release and of any change, with
// nobody asking. Two small reads a tick, and a write only for a schedule
// whose note is out of line.
//
// Only that note is written or cleared; a run's own note ("The report ran.",
// an error) is left as the dispatch wrote it, and the schedule's dates are
// never touched. Best effort: a pass that cannot be made changes nothing
// else, and the next tick makes it.

import { NEEDS_TRACKING, trackedOnRecord, type TrackedSetRow } from "../competitive/selectionTracking.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** The note a schedule carries while its selection's tracking has not started. */
export const TRACKING_NOT_STARTED = `${NEEDS_TRACKING}: Tracking for the confirmed competitors has not started.`;

/** The sets a competitive analysis can run on, as the dispatch reads them. */
const RUNNABLE = ["confirmed", "analyzing", "complete", "failed"];
/** Clients asked for in one read of their sets. */
const CLIENTS_PER_READ = 50;
/** Rows one read returns at most (PostgREST's default). A read that reaches it may have left a client's newest set out. */
export const READ_LIMIT = 1000;

const awaits = (note: unknown) => typeof note === "string" && note.startsWith(NEEDS_TRACKING);
/** A note the dispatch keeps for the team: why a run could not start, or that one is running. */
const runNote = (note: unknown) => typeof note === "string" && (/^error:/.test(note) || note === "The report is running.");

type SetRow = TrackedSetRow & { client_id: string };

/** The newest confirmed set of each of these clients, newest first as the dispatch and the lifecycle pick it. */
async function newestSets(db: Db, ids: string[], into: Map<string, SetRow>): Promise<void> {
  const { data, error } = await db.from("competitor_sets").select("client_id, rivaliq_landscape_id, tracking_check, confirmed_at, created_at")
    .in("client_id", ids).in("status", RUNNABLE)
    .order("confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(READ_LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SetRow[];
  // A read cut at its limit may have left a client's newest set out: asked again for fewer clients. For one client the first row is its newest either way.
  if (rows.length >= READ_LIMIT && ids.length > 1) {
    const half = Math.ceil(ids.length / 2);
    await newestSets(db, ids.slice(0, half), into);
    await newestSets(db, ids.slice(half), into);
    return;
  }
  for (const row of rows) if (!into.has(row.client_id)) into.set(row.client_id, row);
}

/** Each client's current set. Clients with none are left out. */
async function currentSets(db: Db, clientIds: string[]): Promise<Map<string, SetRow>> {
  const current = new Map<string, SetRow>();
  for (let i = 0; i < clientIds.length; i += CLIENTS_PER_READ) await newestSets(db, clientIds.slice(i, i + CLIENTS_PER_READ), current);
  return current;
}

/**
 * Bring every active competitive schedule in line with its client's
 * tracking. Answers what it found and how many notes it wrote, or null when
 * the pass could not be made. Never throws.
 */
export async function noteSchedulesTracking(db: Db): Promise<{ waiting: number; tracked: number; written: number } | null> {
  try {
    const { data: schedules, error } = await db.from("report_schedules").select("id, client_id, last_result")
      .eq("report_kind", "competitive").eq("is_active", true).limit(READ_LIMIT);
    if (error) throw new Error(error.message);
    const rows = (schedules ?? []) as Array<{ id: string; client_id: string; last_result: string | null }>;
    if (!rows.length) return { waiting: 0, tracked: 0, written: 0 };
    const sets = await currentSets(db, [...new Set(rows.map((s) => s.client_id))]);
    const out = { waiting: 0, tracked: 0, written: 0 };
    for (const s of rows) {
      // A client with no confirmed competitors is not tracked either.
      const tracked = trackedOnRecord(sets.get(s.client_id) ?? null);
      out[tracked ? "tracked" : "waiting"] += 1;
      const next = tracked ? (awaits(s.last_result) ? null : undefined) : (awaits(s.last_result) || runNote(s.last_result) ? undefined : TRACKING_NOT_STARTED);
      if (next === undefined) continue;
      // Only over the note this pass read: a note the dispatch wrote meanwhile stays.
      const write = db.from("report_schedules").update({ last_result: next }).eq("id", s.id);
      const { error: writeError } = await (s.last_result == null ? write.is("last_result", null) : write.eq("last_result", s.last_result));
      if (writeError) throw new Error(writeError.message);
      out.written += 1;
    }
    return out;
  } catch (e) {
    console.warn("[scheduled-jobs] the schedules' tracking notes were not updated:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
