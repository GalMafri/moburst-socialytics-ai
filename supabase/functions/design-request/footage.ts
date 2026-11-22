// supabase/functions/design-request/footage.ts
//
//   footage {client_id, calendar_post_key, post_copy, path, ...}
//        A filmed clip for a video post with a real person on camera: the
//        clip is the footage, and the post's hook and the client's logo file
//        go over it, keeping its sound. Anyone who can work on the client's
//        posts.
//
// The clip must be a file of this client that is really there, and the post
// must be a video: a path nobody uploaded, or a still post, starts nothing.
// A post that waits for filming is a video by that fact (the request that
// asked for the clip is what offered the screen's filming), so only a post
// with no such request is checked against its calendar row.
// Free of Deno and network imports: index.ts hands in the database, the
// membership check, the storage check and the start.

import { endRequest } from "../_shared/canva/jobs.ts";
import { designKind } from "../_shared/design/weekRules.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface FootageDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  /** Whether a file is in the footage bucket at this path. */
  clipExists(path: string): Promise<boolean>;
  /** Start the request the way every design starts (index.ts startRequest). */
  start(settings: Row, p: Row): Promise<Row>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

export async function footageFor(d: FootageDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  const postKey = String(body.calendar_post_key || "");
  const path = String(body.path || "");
  const copy = String(body.post_copy || "").trim();
  if (!clientId || !postKey || !copy || !path) return { status: 400, body: { error: "client_id, calendar_post_key, post_copy and path are required." } };
  const userId = await d.requireMember(clientId);
  if (!path.startsWith(`${clientId}/`) || path.includes("..")) return { status: 400, body: { error: "That clip does not belong to this client." } };
  const { data: settings } = await d.db.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (!settings?.confirmed_at) return { body: { code: "not_set_up" } };

  const { data: waiting } = await d.db.from("design_requests").select("id").eq("client_id", clientId).eq("calendar_post_key", postKey).eq("status", "needs_filming");
  if (!(waiting ?? []).length) {
    // The calendar's own post says what it is; a post that is not there yet is taken as the screen sent it.
    const { data: post } = await d.db.from("calendar_posts").select("format, platform").eq("client_id", clientId).eq("post_key", postKey).maybeSingle();
    const format = post ? post.format ?? null : body.format || null;
    const platform = post ? post.platform ?? null : body.platform || null;
    if (designKind(format, platform) !== "video") return { status: 400, body: { error: "That post is not a video." } };
  }
  if (!(await d.clipExists(path))) return { status: 400, body: { error: "That clip was not found." } };

  const { data: filmed } = await d.db.from("design_requests").select("on_camera").eq("client_id", clientId).eq("calendar_post_key", postKey).in("status", ["needs_filming", "closed"]).not("on_camera", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const visual = typeof body.visual_direction === "string" ? body.visual_direction.trim().slice(0, 600) : "";
  // QA 22 Nov 2026 (P56-04): a video being made without footage (from the
  // client's posts, say) was answered in place of the clip's, so the clip was
  // used by nothing. The clip the person filmed wins: that video stops, the
  // way Stop stops it (cancel.ts), and one is made from the clip.
  const { data: open } = await d.db.from("design_requests").select("id, footage_path").eq("client_id", clientId).eq("calendar_post_key", postKey).eq("status", "preparing").maybeSingle();
  if (open && !open.footage_path) {
    const at = new Date().toISOString();
    await d.db.from("canva_finish_jobs").update({ status: "canceled", lease_until: null, updated_at: at })
      .eq("design_request_id", open.id).in("status", ["queued", "running"]);
    await d.db.from("design_requests").update({ status: "canceled", updated_at: at }).eq("id", open.id).eq("status", "preparing");
  }
  const request = await d.start(settings, {
    clientId, postKey, copy, reportId: body.report_id || null, platform: body.platform || null, format: body.format || "Video", requestedBy: userId,
    visual: visual || null, footagePath: path, onCamera: filmed?.on_camera ?? "the speaker",
  });
  // The footage came: the post no longer waits to be filmed. Only when the
  // request answered is the one made from this clip.
  if (request?.footage_path === path) for (const w of waiting ?? []) await endRequest(d.db, w.id, "filmed");
  return { body: { request } };
}
