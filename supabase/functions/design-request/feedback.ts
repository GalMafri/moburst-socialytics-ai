// supabase/functions/design-request/feedback.ts
//
//   feedback {iteration_id, verdict:"rejected"|"deleted", reason?, note?, make_new?}
//        Turns a design down (its reason becomes a rule for the client's next
//        designs, and a new design is started with the note) or deletes it.
//        Turning down the post's current design starts a new one.
//
// Free of Deno and network imports: index.ts hands in the database, the
// membership check, the design memory and the start.

import { DESIGN_ANGLE } from "../_shared/canva/jobs.ts";
import type { Learning } from "../_shared/design-prompts/feedback.ts";
import { currentCopyOf } from "../_shared/design/weekRules.ts";
import { cleanNote } from "../_shared/notes/regenerateNote.ts";
import { noteLearnedOf } from "./note.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface FeedbackDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  /** The design hidden and its reason taught to the memory (feedback.ts recordFeedback): the rules stored. */
  record(it: Row, verdict: "rejected" | "archived", reason: string | undefined, note: string | undefined, userId: string): Promise<Learning[]>;
  /** Start the request the way every design starts (index.ts startRequest). */
  start(settings: Row, p: Row): Promise<Row>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

/** A post's copy as it is now: its latest saved edit, or the copy it was planned with. */
async function currentCopy(db: Db, post: { client_id: string; post_key: string; copy: string }): Promise<string> {
  const { data: edits } = await db.from("post_iterations").select("post_copy, media_urls, created_at, version")
    .eq("client_id", post.client_id).eq("calendar_post_key", post.post_key)
    .order("created_at", { ascending: false }).limit(20);
  return currentCopyOf(edits ?? [], post.copy);
}

export async function designFeedback(d: FeedbackDeps, body: Row): Promise<Answer> {
  const verdict = body.verdict === "rejected" ? "rejected" : body.verdict === "deleted" ? "archived" : null;
  if (!verdict) return { status: 400, body: { error: "verdict must be rejected or deleted." } };
  const { data: it } = await d.db.from("post_iterations").select("id, client_id, calendar_post_key, report_id, platform, format, post_copy, visual_direction, variant_angle, concept, is_selected, variant_group_id").eq("id", String(body.iteration_id || "")).maybeSingle();
  if (!it || !DESIGN_ANGLE.test(it.variant_angle ?? "")) return { status: 404, body: { error: "That design is no longer available." } };
  const userId = await d.requireMember(it.client_id);
  const learnings = await d.record(it, verdict, body.reason, body.note, userId);

  let request: Row | null = null;
  if (verdict === "rejected" && body.make_new !== false && it.calendar_post_key) {
    const { data: settings } = await d.db.from("design_brand_settings").select("*").eq("client_id", it.client_id).maybeSingle();
    if (settings?.confirmed_at) {
      const copy = await currentCopy(d.db, { client_id: it.client_id, post_key: it.calendar_post_key, copy: it.post_copy ?? "" });
      if (copy) {
        // Made again the way the turned-down one was made (from the client's posts, say).
        const { data: madeBy } = it.variant_group_id ? await d.db.from("design_requests").select("video_route").eq("id", it.variant_group_id).maybeSingle() : { data: null };
        // The new design follows the note as Regenerate's does; what the feedback taught is already learned, and shown on it.
        const note = cleanNote(body.note);
        request = await d.start(settings, {
          clientId: it.client_id, postKey: it.calendar_post_key, copy, reportId: it.report_id, platform: it.platform, format: it.format, requestedBy: userId, route: madeBy?.video_route ?? null,
          note: note || null, noteLearned: note ? noteLearnedOf(learnings) : null,
        });
      }
    }
  }
  return { body: { ok: true, learnings: learnings.length, request } };
}
