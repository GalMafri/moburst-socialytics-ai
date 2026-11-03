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
}

export function rewritePrompt(i: RewriteInput): string {
  const story = isStoryPost({ format: i.format, platform: i.platform });
  const noteLines = i.note
    ? `\n\nTHE NOTE FOR THIS REWRITE: "${i.note}"\nSomeone on the brand's side asked for this rewrite with this note. Follow it for this post. Where it differs from a stated preference above, the note wins for this post.`
    : "";
  return `${story ? "Rewrite this Story's message" : "Rewrite this social media post copy"} with a fresh take. Keep the same strategic angle and concept, but create completely new wording.

PLATFORM: ${i.platform || "general"}
${story ? "FORMAT: Story: one still frame, 9:16, seen full screen for a few seconds\n" : ""}${i.competitive ? `\n${i.competitive}\n` : ""}
CONTENT PILLAR: ${i.pillar || "general"}
CONCEPT: ${i.concept}
CURRENT COPY (rewrite this): ${i.currentCopy}
CURRENT CTA: ${i.currentCta || ""}

${i.voiceBlock}${noteLines}

Return ONLY this JSON:
{
  "caption_angle": "${story ? "the Story's message in one or two short sentences, which the words on its frame are written from" : "the new post caption"}",
  "CTA": "new call to action",
  "hashtags": "${story ? "" : "relevant hashtags"}"
}`;
}
