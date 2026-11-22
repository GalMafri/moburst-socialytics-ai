// The scheduled_posts rows a send reads and writes (send.ts's SentStore),
// kept apart from the HTTP handler so the claim runs in tests against a
// table that holds the one-held-row-per-post index.

import type { SentStore } from "./send.ts";
import { SEND_RUN_LIMIT_MS } from "../_shared/sprout/sendWindow.ts";

/** The slice of the Supabase client this uses. */
// deno-lint-ignore no-explicit-any
export type Db = any;

/** Why a send was closed by the press that sent the post again (the same words as the before-insert trigger in 20261113103300_scheduled_posts_supersedes.sql, which a test checks). */
export const SUPERSEDED_REASON = "Sprout never confirmed the post, and it was sent again.";

export function sentStore(db: Db, opts: { waits?: number[]; now?: () => number } = {}): SentStore {
  const waits = opts.waits ?? [1_000, 3_000];
  const now = opts.now ?? Date.now;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Rows created before this were written by a send that can no longer be running. */
  const runOverBefore = () => new Date(now() - SEND_RUN_LIMIT_MS).toISOString();
  // A row that superseded an unconfirmed (or run-over asked) row carries that row's id in `supersedes`. The database
  // closes the earlier row in the same statement that writes the new one (a before-insert trigger), and puts it back
  // as unconfirmed when the new row ends without making anything in Sprout (an after-update and after-delete trigger,
  // 20261113103300_scheduled_posts_supersedes.sql), so no run has to survive for the post to keep reading as
  // unconfirmed. Nothing here closes or reopens the earlier row.
  return {
    async alreadySent({ clientId, calendarPostKey, profileId, status, at, since }) {
      let q = db.from("scheduled_posts").select("scheduled_time")
        .eq("client_id", clientId).eq("calendar_post_key", calendarPostKey).eq("profile_id", profileId).eq("status", status);
      if (at) q = q.eq("scheduled_time", at);
      if (since) q = q.gte("created_at", since);
      const { data } = await q.limit(1);
      return data?.[0]?.scheduled_time ? new Date(data[0].scheduled_time).toISOString().replace(".000Z", "Z") : null;
    },
    async claim(row, claimOpts) {
      const clientId = String(row.client_id);
      const key = typeof row.calendar_post_key === "string" ? row.calendar_post_key : null;
      // The person pressed send again on a post shown as unconfirmed: that one row (no post id ever written) is
      // the one this send supersedes, and only that one, so a press that arrives after another send has taken over
      // finds the new row held and is told so. An "unconfirmed" row belongs to a send that ended without Sprout's
      // answer and writes nothing more, so it can be superseded at once. An "asked" row only once the send that
      // wrote it can no longer be running (the function's own time limit from created_at, sendWindow.ts): before
      // that its answer may still come, so the row stays held, the insert below answers "taken" and no second
      // draft is made, whatever the screen showed. The closing itself is done by the database with the insert.
      let supersedes: string | null = null;
      if (key && claimOpts?.supersede) {
        const earlier = () => db.from("scheduled_posts").select("id").eq("id", claimOpts.supersede).eq("client_id", clientId)
          .eq("calendar_post_key", key).is("sprout_post_id", null);
        const ended = await earlier().eq("status", "unconfirmed");
        const over = (ended?.data?.length ?? 0) > 0 ? ended : await earlier().eq("status", "asked").lt("created_at", runOverBefore());
        if ((over?.data?.length ?? 0) > 0) supersedes = String(claimOpts.supersede);
      }
      // A row still "sending" once its run is over belongs to a send that died before it asked Sprout anything,
      // so nothing is in Sprout and the post may go again. A row that was "asked" is never closed here: Sprout may
      // hold the post, and only the answer (or Sprout itself) can say.
      if (key) {
        await db.from("scheduled_posts").update({ status: "failed", failure_reason: "The send did not start." })
          .eq("client_id", clientId).eq("calendar_post_key", key).eq("status", "sending")
          .lt("created_at", runOverBefore());
      }
      let error: { message: string; code?: string } | null = null;
      for (let attempt = 0; attempt <= waits.length; attempt++) {
        const res = await db.from("scheduled_posts").insert(supersedes ? { ...row, supersedes } : row).select("id").single();
        if (!res.error) return { id: String(res.data.id) };
        error = res.error;
        // The one-held-row-per-post index: another send of this post holds it.
        if (error?.code === "23505") return "taken";
        if (attempt < waits.length) await wait(waits[attempt]);
      }
      console.error("The send could not be recorded:", error?.message);
      return null;
    },
    async settle(id, patch, from) {
      let error: { message: string } | null = null;
      for (let attempt = 0; attempt <= waits.length; attempt++) {
        // Written only while the row is still in the state this send left it in: a row another press closed in
        // the meantime is never reopened.
        const res = await db.from("scheduled_posts").update(patch).eq("id", id).eq("status", from).select("id");
        error = res.error;
        if (!error) {
          return (res.data?.length ?? 0) > 0;
        }
        if (attempt < waits.length) await wait(waits[attempt]);
      }
      console.error("The sent post could not be recorded:", error?.message);
      return false;
    },
    async drop(id) {
      await db.from("scheduled_posts").delete().eq("id", id);
    },
  };
}
