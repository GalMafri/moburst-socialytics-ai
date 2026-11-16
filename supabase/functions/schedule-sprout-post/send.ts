// What schedule-sprout-post does once the caller, the client and the profile
// are checked: the post is checked against its network's rules, sent to
// Sprout as Sprout's Publishing API documents it (_shared/sprout/publishing.ts),
// and recorded in scheduled_posts, the row every screen reads. Kept apart
// from the HTTP handler so the whole exchange with Sprout runs in tests
// against Sprout's documented answers.

import { publishProblems } from "../_shared/sprout/publishRules.ts";
import { fitImage, ImageTooLarge } from "../_shared/sprout/media.ts";
import { createDraftPost, earliestSendTime, profileGroupId, publishingToken, sproutMinute, SproutRefusal, uploadMediaFromUrl, type SproutMediaType } from "../_shared/sprout/publishing.ts";

export interface SendRequest {
  clientId: string;
  reportId: string | null;
  calendarPostKey: string | null;
  /** The client's assigned profile: its sprout_profiles row and Sprout's id for it. */
  profile: { rowId: string; sproutProfileId: number; networkType: string | null };
  platform: string | null;
  text: string;
  mediaUrls: string[];
  /** When the post goes out (ISO), as the person chose it. Unused when publishing now. */
  scheduledTime: string | null;
  /**
   * Send to Sprout now (Lital, 2 and 3 Nov 2026). Sprout has no immediate
   * mode, so the post is sent for the earliest minute Sprout takes
   * (earliestSendTime) and recorded with status "sent_now". Like every post
   * from the API, it arrives in Sprout as a draft and is approved there.
   */
  sendNow?: boolean;
  customerId: string;
  createdBy: string | null;
  /**
   * The id of the row the person saw as unconfirmed (Sprout was asked, no post id was ever written, the send that
   * wrote it is over, and no read of Sprout can settle it: its API retrieves a post by id only). Pressing send
   * again means "send it again": that one row is closed as failed and this send goes ahead. An asked row whose
   * send can still be running is not closed, and the press answers 409 (store.ts). The post may then exist twice
   * as a draft in Sprout, where drafts are approved by hand.
   */
  supersede?: string | null;
}

/**
 * The scheduled_posts rows this needs. A row is written as "sending" before
 * Sprout is asked to make the post, marked "asked" right before the request, and every later send of that post finds
 * it, whatever the last write did. The table holds one sending or asked row per post
 * (20261113100710_scheduled_posts_sending.sql), so two presses that arrive
 * together cannot both go on.
 */
export interface SentStore {
  /** The send time of a row for the post with this status: at this minute, or (sent now) sent since a time. Null when there is none. */
  alreadySent(q: { clientId: string; calendarPostKey: string; status: string; at?: string; since?: string }): Promise<string | null>;
  /** Writes the row as sending. "taken" when another send of this post holds it; null when it could not be written. */
  claim(row: Record<string, unknown>, opts?: { supersede?: string | null }): Promise<{ id: string } | "taken" | null>;
  /**
   * A write to the row this send claimed, made only while the row still has the status `from`: Sprout's post id
   * and the final status, or failed with the reason. True once written; false when it could not be written or
   * the row is no longer `from` (another press closed it), which the row then keeps.
   */
  settle(id: string, patch: Record<string, unknown>, from: string): Promise<boolean>;
  /** Takes back a row this send wrote and no longer needs. */
  drop(id: string): Promise<void>;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** How long a post sent now counts as sent, so a second press or a resend does not send it again. */
export const SEND_NOW_WINDOW_MS = 15 * 60_000;

/** The statuses a sent post is recorded with; scheduled_posts' status rule must allow each (statuses.test.ts). */
export const SENT_STATUSES = { scheduled: "scheduled", now: "sent_now" } as const;

/** The statuses a row is written with besides the sent ones; the status rule allows these too (statuses.test.ts). */
export const WORKING_STATUSES = { sending: "sending", asked: "asked", unconfirmed: "unconfirmed", failed: "failed" } as const;

/**
 * "sending": the row is written and Sprout has not been asked, so nothing is in Sprout.
 * "asked": Sprout is being asked to make the post and the answer is not written down yet. The send that wrote the
 * row is the only one that writes it next; if that send dies before it does, the row stays asked, and the
 * function's own time limit from created_at says when it can no longer be running (sendWindow.ts).
 * "unconfirmed": the send asked Sprout and ended without an answer that says what Sprout did (a lost answer, a
 * server error, a body that cannot be read). The post may be in Sprout and no later write will say.
 * An asked or unconfirmed row with no post id holds its post until a person sends it again
 * (SendRequest.supersede): an unconfirmed row at once, an asked row once its send can no longer be running.
 */
export const HELD_STATUSES = [WORKING_STATUSES.sending, WORKING_STATUSES.asked, WORKING_STATUSES.unconfirmed] as const;

export async function sendToSprout(req: SendRequest, store: SentStore, opts: { fetchImpl?: typeof fetch; waits?: number[] } = {}): Promise<Reply> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const status = req.sendNow ? SENT_STATUSES.now : SENT_STATUSES.scheduled;
  let chosenAt: string | null = null;
  if (!req.sendNow) {
    try {
      chosenAt = sproutMinute(String(req.scheduledTime ?? ""));
    } catch {
      return { status: 422, body: { error: "The date and time are not complete.", code: "not_publishable", problems: ["The date and time are not complete."] } };
    }
  }

  // The network's own rules, checked before Sprout is asked. The one-minute
  // rule (a time must be ahead) applies to a chosen time only.
  const problems = publishProblems({ network: req.profile.networkType || req.platform, text: req.text, mediaUrls: req.mediaUrls, sendAt: chosenAt });
  if (problems.length) return { status: 422, body: { error: problems.join(" "), code: "not_publishable", problems } };

  // A post already sent is not sent twice: for the same calendar post and
  // minute, or sent now within the last quarter hour.
  if (req.calendarPostKey) {
    const since = new Date(Date.now() - SEND_NOW_WINDOW_MS).toISOString();
    const already = await store.alreadySent(req.sendNow
      ? { clientId: req.clientId, calendarPostKey: req.calendarPostKey, status, since }
      : { clientId: req.clientId, calendarPostKey: req.calendarPostKey, status, at: chosenAt! });
    if (already) return { status: 200, body: { success: true, already: true, recorded: true, status, scheduled_time: already } };
  }

  // Each image fitted to what the network takes through Sprout
  // (_shared/sprout/media.ts): an image over the limit goes as a smaller
  // version of itself, and one that cannot be made to fit stops the post.
  const mediaUrls: string[] = [];
  try {
    for (const url of req.mediaUrls) mediaUrls.push(await fitImage(fetchImpl, url, req.profile.networkType || req.platform));
  } catch (e) {
    if (!(e instanceof ImageTooLarge)) throw e;
    return { status: 422, body: { error: e.message, code: "not_publishable", problems: [e.message] } };
  }

  // Until the post is made in Sprout, every step can be asked again: a
  // refusal here answers 502, which the dialog sends again quietly.
  let token: string;
  let groupId: string | null;
  const media: Array<{ media_id: string; media_type: SproutMediaType }> = [];
  try {
    token = await publishingToken(fetchImpl, opts.waits);
    groupId = await profileGroupId(fetchImpl, req.customerId, token, req.profile.sproutProfileId, opts.waits);
  } catch (e) {
    return { status: 502, body: { error: e instanceof Error ? e.message : String(e), code: "sprout_not_answering" } };
  }
  // Sprout makes posts inside a group (group_id is required); a profile in none cannot take one.
  if (!groupId) return { status: 409, body: { error: "The profile is in no Sprout group, so Sprout cannot make a post for it.", code: "profile_not_in_group" } };
  for (const url of mediaUrls) {
    try {
      const uploaded = await uploadMediaFromUrl(fetchImpl, req.customerId, token, url, opts.waits);
      media.push({ media_id: uploaded.media_id, media_type: uploaded.media_type });
    } catch (e) {
      console.error("Sprout did not take a file:", e instanceof SproutRefusal ? `${e.status} ${e.detail}` : e);
    }
  }
  // Every file must make it: a post never goes to Sprout without the creative it was sent with.
  if (media.length < mediaUrls.length) {
    return { status: 502, body: { error: "Sprout did not take every attached file, so nothing was sent.", code: "media_not_taken", media_requested: mediaUrls.length, media_attached: media.length } };
  }

  // Sent now: the earliest minute Sprout takes, worked out once the files are in.
  const sendAt = chosenAt ?? earliestSendTime(new Date());

  // The row is written before Sprout is asked, so a send that dies half way, or
  // a last write that fails, still leaves the post held against a second send.
  const claimed = await store.claim({
    client_id: req.clientId,
    report_id: req.reportId,
    profile_id: req.profile.rowId,
    platform: req.platform,
    scheduled_time: sendAt,
    status: WORKING_STATUSES.sending,
    post_content: req.text,
    created_by: req.createdBy,
    media_url: req.mediaUrls.length > 0 ? `${req.mediaUrls.length} attached` : null,
    ...(req.calendarPostKey ? { calendar_post_key: req.calendarPostKey } : {}),
  }, { supersede: req.supersede });
  if (claimed === "taken") return { status: 409, body: { error: "This post is already being sent to Sprout.", code: "send_in_progress" } };
  if (!claimed) return { status: 502, body: { error: "The send could not be started.", code: "not_recorded" } };

  // A press that settled between the first look and the claim: found now, and this row goes.
  if (req.calendarPostKey) {
    const since = new Date(Date.now() - SEND_NOW_WINDOW_MS).toISOString();
    const already = await store.alreadySent(req.sendNow
      ? { clientId: req.clientId, calendarPostKey: req.calendarPostKey, status, since }
      : { clientId: req.clientId, calendarPostKey: req.calendarPostKey, status, at: chosenAt! });
    if (already) {
      await store.drop(claimed.id);
      return { status: 200, body: { success: true, already: true, recorded: true, status, scheduled_time: already } };
    }
  }

  // The row says Sprout is being asked before it is, so whatever happens next cannot make it look as if nothing
  // went to Sprout. If that write does not go through, Sprout is not asked and the row goes.
  if (!(await store.settle(claimed.id, { status: WORKING_STATUSES.asked }, WORKING_STATUSES.sending))) {
    await store.drop(claimed.id);
    return { status: 502, body: { error: "The send could not be started.", code: "not_recorded" } };
  }

  // Made once: a lost answer is never sent again (createDraftPost), and an answer that is no clear refusal answers 500, which the dialog does not repeat.
  let created;
  try {
    created = await createDraftPost(fetchImpl, req.customerId, token, { groupId, profileId: req.profile.sproutProfileId, text: req.text, sendAt, media }, opts.waits);
  } catch (e) {
    const detail = e instanceof SproutRefusal ? `${e.status} ${e.detail}` : String(e);
    console.error("Sprout did not make the post:", detail);
    // Sprout's own word that it made nothing: a 4xx, a 503 that lasted through the resends (Sprout's status
    // table: "The server is overloaded and cannot process the request"; createDraftPost sends it again for the
    // same reason), or an answer that lists its posts and has none for the profile. The row says failed, with
    // why, and the post can be sent again. An answer that never came, any other server error, or a body that
    // cannot be read says nothing about what Sprout did: the row says unconfirmed, so every screen knows at once
    // that this send is over, and the person can send the post again (SendRequest.supersede).
    const refused = e instanceof SproutRefusal && ((e.status >= 400 && e.status < 500) || e.status === 503 || e.madeNone);
    if (refused && e instanceof SproutRefusal) await store.settle(claimed.id, { status: WORKING_STATUSES.failed, failure_reason: `Sprout did not make the post: ${e.status} ${e.message}`.slice(0, 500) }, WORKING_STATUSES.asked);
    else await store.settle(claimed.id, { status: WORKING_STATUSES.unconfirmed }, WORKING_STATUSES.asked);
    return { status: 500, body: { error: e instanceof Error ? e.message : String(e), code: refused ? "post_not_made" : "post_not_confirmed" } };
  }

  // The post is in Sprout now; the row is what every screen reads. A row closed meanwhile stays closed and the
  // answer says the send was not recorded.
  const recorded = await store.settle(claimed.id, { sprout_post_id: created.publishingPostId, status }, WORKING_STATUSES.asked);
  return {
    status: 200,
    body: { success: true, recorded, status, scheduled_time: sendAt, sprout_post_id: created.publishingPostId, sprout_link: created.permaLink, draft: true, media_attached: media.length },
  };
}
