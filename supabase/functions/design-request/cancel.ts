// supabase/functions/design-request/cancel.ts
//
//   cancel {request_id}   Stops a design being prepared: whoever could start
//        it can stop it. The request and its unfinished jobs are cancelled,
//        so the workers spend nothing more on it; the post keeps the design
//        it already had, and the week's design button counts the post again
//        next time it is pressed.
//
// Free of Deno and network imports: index.ts hands in the database and the
// membership check.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface CancelDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  now(): Date;
}

export interface Answer { status?: number; body: Record<string, unknown> }

export async function cancelRequest(d: CancelDeps, body: Record<string, unknown>): Promise<Answer> {
  const { data: request } = await d.db.from("design_requests").select("id, client_id, status").eq("id", String(body.request_id || "")).maybeSingle();
  if (!request) return { status: 404, body: { error: "That design is not being prepared." } };
  await d.requireMember(request.client_id);
  if (request.status !== "preparing") return { body: { request } };
  const at = d.now().toISOString();
  await d.db.from("canva_finish_jobs").update({ status: "canceled", lease_until: null, updated_at: at })
    .eq("design_request_id", request.id).in("status", ["queued", "running"]);
  const { data: updated } = await d.db.from("design_requests").update({ status: "canceled", updated_at: at }).eq("id", request.id).select("*").single();
  return { body: { request: updated } };
}
