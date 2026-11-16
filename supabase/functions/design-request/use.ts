// supabase/functions/design-request/use.ts
//
//   use {iteration_id}   anyone who can work on the client's posts: puts one
//        live design option in use for its post, and every other design of
//        that post stops being in use.
//
// Only a design option someone has not deleted or turned down goes in use:
// a deleted design stays deleted. The switch is one statement in the
// database (use_design), so a post never has none or two in use. Clients
// cannot write post_iterations (staff-only RLS), so this goes through the
// service role after a membership check. Free of Deno and network imports:
// index.ts hands in the database and the membership check.

import { DESIGN_ANGLE } from "../_shared/canva/jobs.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface UseDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

const GONE: Answer = { status: 404, body: { error: "That design is no longer available." } };

export async function putDesignInUse(d: UseDeps, body: Record<string, unknown>): Promise<Answer> {
  const { data: it } = await d.db.from("post_iterations").select("id, client_id, variant_angle, archived_at, rejected_at").eq("id", String(body.iteration_id || "")).maybeSingle();
  if (!it) return GONE;
  await d.requireMember(it.client_id);
  // The database holds the same rule (use_design); this answers it without asking.
  if (!DESIGN_ANGLE.test(String(it.variant_angle ?? "")) || it.archived_at || it.rejected_at) return GONE;
  const { data: used, error } = await d.db.rpc("use_design", { p_iteration: it.id });
  if (error) throw new Error(error.message);
  return used ? { body: { ok: true } } : GONE;
}
