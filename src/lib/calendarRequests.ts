// "Plan next week" and "Revise this week" only queue work on the server
// (weekly calendar, Lital 19 Oct 2026). A request that could not be sent (no
// connection, a server hiccup) is sent again quietly with growing waits
// (src/lib/quietSend.ts), and nothing is shown as an error: the calendar
// shows what the server has, and the daily run asks again for any week left
// behind.

import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, QUIET_WAITS_MS, sendQuietly } from "@/lib/quietSend";

type Reply = { data: Record<string, unknown> | null; error: unknown };
type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<Reply>;

/** Waits between tries: 1, 3, then 9 seconds. */
export const SEND_WAITS_MS = QUIET_WAITS_MS;

/**
 * Send a calendar-posts request that queues work. Resolves with the reply,
 * or null when it could not be sent or the server turned it down. The server
 * queues a week once however often it is asked, so a server failure is worth
 * asking again; a refusal (4xx) won't change by asking again.
 */
export async function queueCalendarWork(
  body: Record<string, unknown>,
  deps: { invoke?: Invoke; wait?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, unknown> | null> {
  const invoke: Invoke = deps.invoke ?? ((name, options) => supabase.functions.invoke(name, options) as Promise<Reply>);
  const reply = await sendQuietly(() => invoke("calendar-posts", { body }), {
    again: (e) => invokeResendable(e, { idempotent: true }),
    waits: SEND_WAITS_MS,
    wait: deps.wait,
  });
  if (reply.error) return null;
  return reply.data?.error ? null : (reply.data ?? {});
}
