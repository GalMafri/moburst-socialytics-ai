// supabase/functions/design-request/story.ts
//
// "Add a Story" on a Facebook or Instagram post (Stories for Facebook and
// Instagram, 2 Nov 2026; Stories you can find, 3 Nov 2026). Specs:
// docs/superpowers/specs/2026-11-02-stories-design.md and
// docs/superpowers/specs/2026-11-03-post-notes-stories-design.md
//
//   story {client_id, calendar_post_key}   anyone who can work on the
//        client's posts (as create): adds one Story post linked to the post
//        (same platform, date and time, story_of = its key, its current copy)
//        and, once the brand's designs are set up, starts the Story's design
//        through the same request a post's own "Create design" makes. Before
//        that, the Story is added with its message and no design. Pressed
//        again, it answers with the same Story.
//
// The post keeps its own design and its Schedule tab. Free of Deno and
// network imports: index.ts hands in the database, the membership check and
// its startRequest, so the action runs against a fake database in tests.

import { STORY_FORMAT, canBeStory, isStoryPost } from "../_shared/design/story.ts";
import { currentCopyOf } from "../_shared/design/weekRules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface StoryDeps {
  db: Db;
  /** Someone who can work on the client's posts: their user id. Throws AuthzError otherwise. */
  requireMember(clientId: string): Promise<string>;
  /** A design request for a post, as its own "Create design" starts it (index.ts startRequest). */
  startRequest(settings: Row, p: { clientId: string; postKey: string; copy: string; reportId: string | null; platform: string | null; format: string | null; requestedBy: string }): Promise<Row>;
}

export interface Answer { status?: number; body: Record<string, unknown> }

async function storyOf(db: Db, clientId: string, postKey: string): Promise<Row | null> {
  const { data } = await db.from("calendar_posts").select("*").eq("client_id", clientId).eq("story_of", postKey).maybeSingle();
  return data ?? null;
}

/** The post's copy as it is now: its latest saved edit, or the copy it was planned with. */
async function currentCopy(db: Db, post: Row): Promise<string> {
  const { data: edits } = await db.from("post_iterations").select("post_copy, media_urls, created_at")
    .eq("client_id", post.client_id).eq("calendar_post_key", post.post_key)
    .order("created_at", { ascending: false }).limit(20);
  return currentCopyOf(edits ?? [], post.copy);
}

export async function designStory(d: StoryDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  const postKey = String(body.calendar_post_key || "");
  if (!clientId || !postKey) return { status: 400, body: { error: "client_id and calendar_post_key are required." } };
  const userId = await d.requireMember(clientId);

  const { data: post } = await d.db.from("calendar_posts").select("*").eq("client_id", clientId).eq("post_key", postKey).maybeSingle();
  if (!post) return { status: 404, body: { error: "That post is no longer on the calendar." } };
  if (isStoryPost(post)) return { status: 400, body: { error: "This post is a Story already." } };
  if (!canBeStory(post.platform)) return { status: 400, body: { error: "Stories are made for Instagram and Facebook posts." } };

  // A post has one Story (unique on client_id, story_of): a second press opens it.
  const made = await storyOf(d.db, clientId, postKey);
  if (made) return { body: { story: made } };

  const copy = await currentCopy(d.db, post);
  if (!copy) return { status: 400, body: { error: "The post has no copy yet." } };

  // The key is the one calendar_posts_fill_key gives a new post, set here so the design request can name it at once.
  const id = crypto.randomUUID();
  const { data: story, error } = await d.db.from("calendar_posts").insert({
    id, post_key: `post:${id}`, client_id: clientId, platform: post.platform, post_date: post.post_date, posting_time: post.posting_time ?? null,
    format: STORY_FORMAT, copy, pillar: post.pillar ?? null, language: post.language ?? null, story_of: postKey,
    source: "ad_hoc", plan_id: null, report_id: null, created_by: userId,
  }).select("*").single();
  if (error || !story) {
    // Two presses at once: the unique index let one through; answer with it.
    const raced = await storyOf(d.db, clientId, postKey);
    if (raced) return { body: { story: raced } };
    throw new Error(`Could not add the Story: ${error?.message ?? "no row"}`);
  }

  // Before the brand's designs are set up, the Story waits with its message; its Create design makes it later.
  const { data: settings } = await d.db.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (!settings?.confirmed_at) return { body: { story, request: null } };

  const request = await d.startRequest(settings, {
    clientId, postKey: story.post_key, copy, reportId: null, platform: story.platform, format: STORY_FORMAT, requestedBy: userId,
  });
  return { body: { story, request } };
}
