// supabase/functions/design-request/shotBrief.ts
//
//   shot_brief {request_id}   Moburst staff with write access to the request's
//        client: the shot brief for a filmed video post, written (again).
//
// Write access is checked once, for the client the request belongs to, so a
// staff member without access to that client is refused. A request that is
// not there is answered only after the caller is known to be staff.
// Free of Deno and network imports: index.ts hands in the database, the
// staff check and the writing of the brief.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface ShotBriefDeps {
  db: Db;
  /** Moburst staff, with write access to the client when one is named. Throws AuthzError otherwise. */
  requireStaff(clientId?: string): Promise<unknown>;
  /** Write the brief for a request and keep it (index.ts writeShotBrief). */
  write(requestId: string): Promise<unknown>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

export async function shotBriefFor(d: ShotBriefDeps, body: Record<string, unknown>): Promise<Answer> {
  const { data: request } = await d.db.from("design_requests").select("id, client_id").eq("id", String(body.request_id || "")).maybeSingle();
  if (!request) {
    await d.requireStaff();
    return { status: 404, body: { error: "That video post is not waiting to be filmed." } };
  }
  await d.requireStaff(request.client_id);
  return { body: { brief: await d.write(request.id) } };
}
