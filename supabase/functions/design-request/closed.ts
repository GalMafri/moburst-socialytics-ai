// supabase/functions/design-request/closed.ts
//
// A strategy-only client (no active account in Sprout,
// _shared/sprout/strategyOnly.ts) gets no designs and no videos. Each action
// that starts one for a named client (a post's "Create design", "Add a
// Story", a filmed clip, the week's design button and its preview) is
// answered the way a client whose designs are not set up yet is answered:
// code "not_set_up", waiting for its social accounts, which the screens
// already say in one plain line ("Designs start once ...'s social accounts
// are connected."). Nothing is planned, started, written or spent.
//
// The answer is given only after the membership check each action makes, so
// nothing about a client is said to someone who cannot work on it. For any
// other client this is one small read and the action goes on unchanged, with
// its own checks. Every other action goes on as before too: it stops, uses,
// turns down or reads a design that exists.
//
// Free of Deno and network imports: index.ts hands in the database and the
// membership check.

import { isStrategyOnly } from "../_shared/sprout/strategyOnly.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface ClosedDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

/** The actions that start a design or a video for the client the request names. */
export const STARTING_ACTIONS: ReadonlySet<string> = new Set(["create", "story", "footage", "week_preview", "week_start"]);

/** The answer for a strategy-only client, or null when the action goes on as before. */
export async function closedForStrategyOnly(d: ClosedDeps, body: Record<string, unknown> | null | undefined): Promise<Answer | null> {
  if (!STARTING_ACTIONS.has(String(body?.action ?? ""))) return null;
  const clientId = String(body?.client_id || "");
  // Without a client the action answers its own 400.
  if (!clientId) return null;
  if (!(await isStrategyOnly(d.db, clientId))) return null;
  // Said only to someone who can work on the client's posts; anyone else gets the action's own refusal.
  await d.requireMember(clientId);
  const { data: client } = await d.db.from("clients").select("name").eq("id", clientId).maybeSingle();
  // Answered as a 200 so the screen can read the code (invoke() hides non-2xx bodies).
  return { body: { code: "not_set_up", waiting_for: "social_accounts", client_name: client?.name ?? null } };
}
