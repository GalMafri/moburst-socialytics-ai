// "Plan next week" and "Revise this week" only queue work on the server
// (weekly calendar, Lital 19 Oct 2026). A request that could not be sent (no
// connection, a server hiccup) is sent again quietly with growing waits, and
// nothing is shown as an error: the calendar shows what the server has, and
// the daily run asks again for any week left behind.

import { supabase } from "@/integrations/supabase/client";

type Reply = { data: Record<string, unknown> | null; error: unknown };
type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<Reply>;

/** Waits between tries: 1, 3, then 9 seconds. */
export const SEND_WAITS_MS = [1_000, 3_000, 9_000];

/** Worth sending again: no answer at all, or the server failed (5xx). A refusal (4xx) won't change by asking again. */
function sendAgain(error: unknown): boolean {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status;
  return typeof status !== "number" || status >= 500;
}

/**
 * Send a calendar-posts request that queues work. Resolves with the reply,
 * or null when it could not be sent or the server turned it down.
 */
export async function queueCalendarWork(
  body: Record<string, unknown>,
  deps: { invoke?: Invoke; wait?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, unknown> | null> {
  const invoke: Invoke = deps.invoke ?? ((name, options) => supabase.functions.invoke(name, options) as Promise<Reply>);
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    let reply: Reply;
    try {
      reply = await invoke("calendar-posts", { body });
    } catch (e) {
      reply = { data: null, error: e };
    }
    if (!reply.error) return reply.data?.error ? null : (reply.data ?? {});
    if (!sendAgain(reply.error) || attempt >= SEND_WAITS_MS.length) return null;
    await wait(SEND_WAITS_MS[attempt]);
  }
}
