// supabase/functions/schedule-sprout-post/story.ts
//
// A Story is posted by hand: Sprout's Publishing API cannot create one
// (_shared/sprout/publishRules.ts). This function refuses it by the format the
// calendar holds for the post, read by its key, so a request that leaves the
// format out, or says another, never sends a Story as a feed post.

import { isStoryPost } from "../_shared/design/story.ts";
import { STORY_NOT_SCHEDULABLE } from "../_shared/sprout/publishRules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** Why this calendar post can't be scheduled because it is a Story, or null. */
export async function storedStoryProblem(db: Db, clientId: string, postKey: string | null | undefined): Promise<string | null> {
  if (!postKey) return null;
  const { data: post, error } = await db.from("calendar_posts").select("format, platform").eq("client_id", clientId).eq("post_key", postKey).maybeSingle();
  if (error) throw new Error("Could not read the calendar post.");
  return isStoryPost(post) ? STORY_NOT_SCHEDULABLE : null;
}
