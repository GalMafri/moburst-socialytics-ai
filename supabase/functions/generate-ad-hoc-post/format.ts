// supabase/functions/generate-ad-hoc-post/format.ts
//
// The format a new post is written for, from the New post dialog's choice
// (Stories for Facebook and Instagram, 2 Nov 2026). A Story is a person's
// choice, on Instagram or Facebook only: with Story chosen, the model writes
// the Story's message in one or two short sentences and no hashtags; on any
// other network it is refused. In auto mode, or for another format, the model
// is not offered Story, and a Story it returns anyway is saved as an image.
// Pure: no Deno, no network.

import { STORY_FORMAT, canBeStory, isStoryFormat } from "../_shared/design/story.ts";

export interface AdHocFormat {
  /** The person chose Story. */
  story: boolean;
  /** The prompt's CREATIVE TYPE. */
  creative: string;
  /** What the reply's "format" holds. */
  formatField: string;
  /** What the reply's "caption_angle" holds. */
  captionField: string;
  /** What the reply's "hashtags" holds. */
  hashtagsField: string;
}

export function adHocFormat(creativeType: unknown, platform: unknown): AdHocFormat | { refused: string } {
  const chosen = typeof creativeType === "string" ? creativeType.trim() : "";
  if (isStoryFormat(chosen)) {
    if (!canBeStory(String(platform ?? ""))) return { refused: "Stories are made for Instagram and Facebook." };
    return {
      story: true,
      creative: "Story: one still frame, 9:16, seen full screen for a few seconds",
      formatField: STORY_FORMAT,
      captionField: "the Story's message in one or two short sentences, which the words on its frame are written from",
      hashtagsField: "empty: a Story has no hashtags",
    };
  }
  return {
    story: false,
    creative: chosen || "AI decides based on topic and platform",
    formatField: "the creative format (Image/Carousel/Video/Reel)",
    captionField: "the full post caption text",
    hashtagsField: "relevant hashtags",
  };
}

/** The model's post as it is saved: a chosen Story is a Story with no hashtags; a Story nobody chose is an image. */
export function settleFormat<T extends { format?: unknown; hashtags?: unknown }>(post: T, f: AdHocFormat): T {
  if (f.story) return { ...post, format: STORY_FORMAT, hashtags: [] };
  if (isStoryFormat(typeof post.format === "string" ? post.format : "")) return { ...post, format: "Image" };
  return post;
}
