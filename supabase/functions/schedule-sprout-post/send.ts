// What schedule-sprout-post does once the caller, the client and the profile
// are checked: the post is checked against its network's rules, sent to
// Sprout as Sprout's Publishing API documents it (_shared/sprout/publishing.ts),
// and recorded in scheduled_posts, the row every screen reads. Kept apart
// from the HTTP handler so the whole exchange with Sprout runs in tests
// against Sprout's documented answers.

import { publishProblems } from "../_shared/sprout/publishRules.ts";
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
}

/** The scheduled_posts rows this needs: whether one is already there, and writing one. */
export interface SentStore {
  /** The send time of a row for the post with this status: at this minute, or (sent now) sent since a time. Null when there is none. */
  alreadySent(q: { clientId: string; calendarPostKey: string; status: string; at?: string; since?: string }): Promise<string | null>;
  /** True once the row is written. */
  record(row: Record<string, unknown>): Promise<boolean>;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** How long a post sent now counts as sent, so a second press or a resend does not send it again. */
export const SEND_NOW_WINDOW_MS = 15 * 60_000;

export async function sendToSprout(req: SendRequest, store: SentStore, opts: { fetchImpl?: typeof fetch; waits?: number[] } = {}): Promise<Reply> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const status = req.sendNow ? "sent_now" : "scheduled";
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
  for (const url of req.mediaUrls) {
    try {
      const uploaded = await uploadMediaFromUrl(fetchImpl, req.customerId, token, url, opts.waits);
      media.push({ media_id: uploaded.media_id, media_type: uploaded.media_type });
    } catch (e) {
      console.error("Sprout did not take a file:", e instanceof SproutRefusal ? `${e.status} ${e.detail}` : e);
    }
  }
  // Every file must make it: a post never goes to Sprout without the creative it was sent with.
  if (media.length < req.mediaUrls.length) {
    return { status: 502, body: { error: "Sprout did not take every attached file, so nothing was sent.", code: "media_not_taken", media_requested: req.mediaUrls.length, media_attached: media.length } };
  }

  // Sent now: the earliest minute Sprout takes, worked out once the files are in.
  const sendAt = chosenAt ?? earliestSendTime(new Date());

  // Made once: a lost answer is never sent again (createDraftPost), and a refusal answers 500, which the dialog does not repeat.
  let created;
  try {
    created = await createDraftPost(fetchImpl, req.customerId, token, { groupId, profileId: req.profile.sproutProfileId, text: req.text, sendAt, media }, opts.waits);
  } catch (e) {
    const detail = e instanceof SproutRefusal ? `${e.status} ${e.detail}` : String(e);
    console.error("Sprout did not make the post:", detail);
    return { status: 500, body: { error: e instanceof Error ? e.message : String(e), code: "post_not_made" } };
  }

  // The post is in Sprout now; the row is what every screen reads.
  const recorded = await store.record({
    client_id: req.clientId,
    report_id: req.reportId,
    sprout_post_id: created.publishingPostId,
    profile_id: req.profile.rowId,
    platform: req.platform,
    scheduled_time: sendAt,
    status,
    post_content: req.text,
    created_by: req.createdBy,
    media_url: req.mediaUrls.length > 0 ? `${req.mediaUrls.length} attached` : null,
    ...(req.calendarPostKey ? { calendar_post_key: req.calendarPostKey } : {}),
  });
  return {
    status: 200,
    body: { success: true, recorded, status, scheduled_time: sendAt, sprout_post_id: created.publishingPostId, sprout_link: created.permaLink, draft: true, media_attached: media.length },
  };
}
