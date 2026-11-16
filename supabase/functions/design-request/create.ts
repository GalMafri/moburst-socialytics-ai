// supabase/functions/design-request/create.ts
//
//   create {client_id, report_id, calendar_post_key, platform, format, post_copy, note?, visual_direction?, route?}
//        Plans the options from the post and the client's own posts, then
//        starts them. A second call while the post's designs are being
//        prepared returns the open request. A video whose idea is a real
//        person on camera is filmed, never generated. An archived client
//        gets nothing made.
//
// Free of Deno and network imports: index.ts hands in the database, the
// membership check and the starts.

import { canFilm } from "../_shared/design/requestRules.ts";
import { designKind } from "../_shared/design/weekRules.ts";
import { cleanNote } from "../_shared/notes/regenerateNote.ts";
import { postTimeOf } from "./postTime.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface CreateDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  now(): Date;
  /** Who a video has to film, or null when it can be generated. */
  filmedReason(clientId: string, copy: string, visual: string): Promise<string | null>;
  /** Keep the answer that a video post is filmed. */
  recordFilming(p: Row, reason: string): Promise<Row>;
  /** Start the request the way every design starts (index.ts startRequest). */
  start(settings: Row, p: Row): Promise<Row>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

export async function createDesign(d: CreateDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  const postKey = String(body.calendar_post_key || "");
  const copy = String(body.post_copy || "").trim();
  if (!clientId || !postKey || !copy) return { status: 400, body: { error: "client_id, calendar_post_key and post_copy are required." } };
  const userId = await d.requireMember(clientId);

  const { data: client } = await d.db.from("clients").select("id, archived_at").eq("id", clientId).maybeSingle();
  if (!client) return { status: 404, body: { error: "No such client." } };
  if (client.archived_at) return { status: 409, body: { error: "This client is archived." } };

  const { data: settings } = await d.db.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
  // Answered as a 200 so the screen can read the code (invoke() hides non-2xx bodies).
  if (!settings?.confirmed_at) return { body: { code: "not_set_up" } };

  const visual = typeof body.visual_direction === "string" ? body.visual_direction.trim().slice(0, 600) : "";
  // Chosen in the Video tab instead of filming: a video in the look of the client's posts.
  const route = body.route === "posts" ? "posts" : null;
  // A video for a post whose time has passed, or is less than a day away, is made from the client's posts: nothing is parked for footage that cannot arrive in time (12 Nov 2026).
  const postAt = await postTimeOf(d.db, clientId, postKey);
  const video = designKind(body.format, body.platform) === "video";
  const routeNow = video && !route && !canFilm(postAt, d.now()) ? "posts" : route;
  // A video whose idea is a real person on camera (the founder speaking, say) is filmed, never generated.
  if (video && !routeNow) {
    const filmed = await d.filmedReason(clientId, copy, visual);
    if (filmed) {
      const request = await d.recordFilming({ clientId, postKey, copy, reportId: body.report_id || null, platform: body.platform || null, format: body.format || null, requestedBy: userId, visual: visual || null }, filmed);
      return { body: { code: "needs_filming", who: filmed, request } };
    }
  }
  // A note left on Regenerate: every option follows it, and the design memory hears it.
  const note = cleanNote(body.note);
  const request = await d.start(settings, {
    clientId, postKey, copy, reportId: body.report_id || null, platform: body.platform || null, format: body.format || null, requestedBy: userId, visual: visual || null, route: routeNow,
    note: note || null, learnNote: true,
  });
  return { body: { request } };
}
