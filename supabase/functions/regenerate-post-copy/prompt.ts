// supabase/functions/regenerate-post-copy/prompt.ts
//
// The instruction a post's copy is rewritten with on Regenerate. With a note
// (notes on regenerate, Lital 3 Nov 2026), the note comes after the client's
// voice and wins for this post where it differs from a stated preference: the
// person asked for it now. A Story's message is rewritten the way New post
// writes one (generate-ad-hoc-post/format.ts): one or two short sentences, no
// hashtags. With no note and no Story, the prompt is the one used before
// notes. Free of Deno and network imports so it can be tested.

import { isStoryPost } from "../_shared/design/story.ts";

export interface RewriteInput {
  platform: string | null;
  format: string | null;
  pillar: string | null;
  /** What the post is about: its concept, or its copy when it has none. */
  concept: string;
  currentCopy: string;
  currentCta: string | null;
  /** The competitive picture (competitive/brief.ts), or "". */
  competitive: string;
  /** How the client writes (voice/voice.ts voicePromptBlock). */
  voiceBlock: string;
  /** The person's note for this rewrite (cleanNote), or "". */
  note: string;
  /** The post's "Visual:" line, what its picture shows, when it has one. */
  currentVisual?: string | null;
  /**
   * "copy" (the default): new copy, with a visual that matches it. "visual":
   * a completely new visual idea for the same copy. Social AI sync, 18 Nov
   * 2026 (Sinéad): the visual stayed as it was when the copy changed, and she
   * asked for a Regenerate of its own for the visual.
   */
  mode?: "copy" | "visual";
}

/** What the visual describes, as the design planners read it (canva/options.ts). */
const VISUAL_SPEC = "one or two sentences describing the picture: its subject, setting, light and mood, with no words, logos or real people in it";

export function rewritePrompt(i: RewriteInput): string {
  const story = isStoryPost({ format: i.format, platform: i.platform });
  const noteLines = i.note
    ? `\n\nTHE NOTE FOR THIS REWRITE: "${i.note}"\nSomeone on the brand's side asked for this rewrite with this note. Follow it for this post. Where it differs from a stated preference above, the note wins for this post.`
    : "";
  const visual = String(i.currentVisual ?? "").trim();
  if (i.mode === "visual") {
    return `Give this ${story ? "Story" : "social media post"} a completely new visual idea. It is a different picture from the current one, not a variation of it: a new subject or a new scene that tells the same message. Keep the copy as it is.

PLATFORM: ${i.platform || "general"}
${story ? "FORMAT: Story: one still frame, 9:16, seen full screen for a few seconds\n" : ""}
CONTENT PILLAR: ${i.pillar || "general"}
CONCEPT: ${i.concept}
COPY (keep as it is): ${i.currentCopy}
${visual ? `CURRENT VISUAL (replace this with a different idea): ${visual}\n` : ""}
${i.voiceBlock}${noteLines}

Return ONLY this JSON:
{
  "visual_direction": "the new visual: ${VISUAL_SPEC}"
}`;
  }
  return `${story ? "Rewrite this Story's message" : "Rewrite this social media post copy"} with a fresh take. Keep the same strategic angle and concept, but create completely new wording.

PLATFORM: ${i.platform || "general"}
${story ? "FORMAT: Story: one still frame, 9:16, seen full screen for a few seconds\n" : ""}${i.competitive ? `\n${i.competitive}\n` : ""}
CONTENT PILLAR: ${i.pillar || "general"}
CONCEPT: ${i.concept}
CURRENT COPY (rewrite this): ${i.currentCopy}
CURRENT CTA: ${i.currentCta || ""}
${visual ? `CURRENT VISUAL: ${visual}\n` : ""}
${i.voiceBlock}${noteLines}

Return ONLY this JSON:
{
  "caption_angle": "${story ? "the Story's message in one or two short sentences, which the words on its frame are written from" : "the new post caption"}",
  "CTA": "new call to action",
  "hashtags": "${story ? "" : "relevant hashtags"}",
  "visual_direction": "the picture for the new ${story ? "message" : "copy"}: ${VISUAL_SPEC}. Keep the current visual where it still fits the new ${story ? "message" : "copy"}, and change it where it no longer does"
}`;
}
