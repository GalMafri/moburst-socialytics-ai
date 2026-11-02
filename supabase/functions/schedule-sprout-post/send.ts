// What schedule-sprout-post does once the caller, the client and the profile
// are checked: the post is checked against its network's rules, sent to
// Sprout as Sprout's Publishing API documents it (_shared/sprout/publishing.ts),
// and recorded in scheduled_posts, the row every screen reads. Kept apart
// from the HTTP handler so the whole exchange with Sprout runs in tests
// against Sprout's documented answers.

import { publishProblems } from "../_shared/sprout/publishRules.ts";
import { createDraftPost, profileGroupId, publishingToken, sproutMinute, SproutRefusal, uploadMediaFromUrl, type SproutMediaType } from "../_shared/sprout/publishing.ts";

export interface SendRequest {
  clientId: string;
  reportId: string | null;
  calendarPostKey: string | null;
  /** The client's assigned profile: its sprout_profiles row and Sprout's id for it. */
  profile: { rowId: string; sproutProfileId: number; networkType: string | null };
  platform: string | null;
  text: string;
  mediaUrls: string[];
  /** When the post goes out (ISO), as the person chose it. */
  scheduledTime: string;
  customerId: string;
  createdBy: string | null;
}

/** The scheduled_posts rows this needs: whether one is already there, and writing one. */
export interface SentStore {
  alreadySent(q: { clientId: string; calendarPostKey: string; status: string; at: string }): Promise<boolean>;
  /** True once the row is written. */
  record(row: Record<string, unknown>): Promise<boolean>;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export async function sendToSprout(req: SendRequest, store: SentStore, opts: { fetchImpl?: typeof fetch; waits?: number[] } = {}): Promise<Reply> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let sendAt: string;
  try {
    sendAt = sproutMinute(req.scheduledTime);
  } catch {
    return { status: 422, body: { error: "The date and time are not complete.", code: "not_publishable", problems: ["The date and time are not complete."] } };
  }

  // The network's own rules, checked before Sprout is asked.
  const problems = publishProblems({ network: req.profile.networkType || req.platform, text: req.text, mediaUrls: req.mediaUrls, sendAt });
  if (problems.length) return { status: 422, body: { error: problems.join(" "), code: "not_publishable", problems } };

  // A post already sent for this calendar post and time is not sent twice.
  if (req.calendarPostKey && await store.alreadySent({ clientId: req.clientId, calendarPostKey: req.calendarPostKey, status: "scheduled", at: sendAt })) {
    return { status: 200, body: { success: true, already: true, recorded: true, status: "scheduled", scheduled_time: sendAt } };
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
    status: "scheduled",
    post_content: req.text,
    created_by: req.createdBy,
    media_url: req.mediaUrls.length > 0 ? `${req.mediaUrls.length} attached` : null,
    ...(req.calendarPostKey ? { calendar_post_key: req.calendarPostKey } : {}),
  });
  return {
    status: 200,
    body: { success: true, recorded, status: "scheduled", scheduled_time: sendAt, sprout_post_id: created.publishingPostId, sprout_link: created.permaLink, draft: true, media_attached: media.length },
  };
}
