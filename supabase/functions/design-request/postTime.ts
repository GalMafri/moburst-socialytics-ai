// supabase/functions/design-request/postTime.ts
//
// When a post goes out, as an exact moment: the calendar's date and time read
// in the client's own time zone. A person's video request asks this before it
// is parked for footage, so a post that has passed, or is less than a day
// away, is made from the client's posts instead of waiting for filming that
// cannot arrive in time (12 Nov 2026).

import { postInstant } from "../_shared/design/requestRules.ts";

/** The post's instant in the client's time zone, from calendar_posts and clients.timezone; null when the post is not in the calendar. */
export async function postTimeOf(admin: any, clientId: string, postKey: string): Promise<Date | null> {
  const { data: post } = await admin.from("calendar_posts").select("post_date, posting_time").eq("client_id", clientId).eq("post_key", postKey).maybeSingle();
  if (!post) return null;
  const { data: client } = await admin.from("clients").select("timezone").eq("id", clientId).maybeSingle();
  return postInstant(post.post_date, post.posting_time, client?.timezone ?? null);
}
