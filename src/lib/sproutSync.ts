// "Sync from Sprout" on the staff dashboard (the owner, 18 Nov 2026: a
// button that syncs all clients from Sprout whenever a staff member wants,
// on top of the weekly sync). The button only queues the run the weekly
// clock queues (supabase/functions/_shared/sprout/syncNow.ts); the run
// happens on the server, one at a time. This is what the dashboard asks the
// server and the words it shows: whether a run is under way, and one line
// for how the newest run ended. Never the run's own reason for stopping.

import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";

export interface SyncedClient {
  id: string;
  name: string;
}

/** Where the run stands, as the server answers it. */
export interface SproutSyncState {
  /** A run is queued or running: the weekly one, or one any staff member started. */
  open: boolean;
  /** The run under way is on another try. */
  slow: boolean;
  /** The newest run that is over, when none is under way. */
  last: { finished: boolean; added: SyncedClient[] } | null;
}

export const SYNC_LABEL = "Sync from Sprout";
export const SYNC_BUSY = "Syncing from Sprout…";
export const SYNC_SLOW = "Syncing from Sprout is taking longer than usual. It keeps trying.";
export const SYNC_NOTHING_NEW = "No new brands in Sprout. Everything is up to date.";
export const SYNC_NOT_FINISHED = "The sync from Sprout did not finish. The weekly sync still runs.";
export const SYNC_NOT_STARTED = "The sync from Sprout did not start. The weekly sync still runs.";

/** "Added 2 new clients from Sprout:", before their names. */
export const addedLead = (count: number): string => `Added ${count} new ${count === 1 ? "client" : "clients"} from Sprout:`;

/** The one line a run leaves: the clients it added, each by name, and a sentence when there is one to say. */
export interface SyncLine {
  added: SyncedClient[];
  text: string;
}

/** The line for a run that is over, or null when the server has none to tell of. */
export function finishedLine(last: SproutSyncState["last"]): SyncLine | null {
  if (!last) return null;
  if (!last.finished) return { added: last.added, text: SYNC_NOT_FINISHED };
  return last.added.length ? { added: last.added, text: "" } : { added: [], text: SYNC_NOTHING_NEW };
}

/** The server's answer as a state, or null when the answer is not one. */
export function syncStateOf(data: unknown): SproutSyncState | null {
  const sync = (data as { sync?: unknown } | null)?.sync as { open?: unknown; slow?: unknown; last?: unknown } | null | undefined;
  if (!sync || typeof sync !== "object" || typeof sync.open !== "boolean") return null;
  const last = sync.last as { finished?: unknown; added?: unknown } | null | undefined;
  const added = Array.isArray(last?.added)
    ? (last!.added as Array<{ id?: unknown; name?: unknown }>).filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && c.name.trim()).map((c) => ({ id: c.id as string, name: (c.name as string).trim() }))
    : [];
  return { open: sync.open, slow: sync.slow === true, last: last && typeof last === "object" ? { finished: last.finished === true, added } : null };
}

/** Where the run stands. Throws when the server did not answer, so the page keeps what it last knew and asks again. */
export async function readSproutSync(): Promise<SproutSyncState> {
  const { data, error } = await supabase.functions.invoke("sprout-profiles", { body: { action: "sync_status" } });
  if (error) throw error;
  const state = syncStateOf(data);
  if (!state) throw new Error("The sync status was not answered.");
  return state;
}

/**
 * Ask for a run now. The server queues one unless a run is already under
 * way, however often it is asked, so a request that did not get through is
 * sent again quietly. Resolves with whether this press started the run and
 * where the run stands, or null when no answer came.
 */
export async function startSproutSync(): Promise<{ started: boolean; sync: SproutSyncState } | null> {
  const reply = await sendQuietly(() => supabase.functions.invoke("sprout-profiles", { body: { action: "sync_now" } }), {
    again: (e) => invokeResendable(e, { idempotent: true }),
  });
  if (reply.error) {
    console.warn("[sync from sprout] not started yet", reply.error);
    return null;
  }
  const sync = syncStateOf(reply.data);
  return sync ? { started: (reply.data as { started?: unknown }).started === true, sync } : null;
}
