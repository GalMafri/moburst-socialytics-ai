import { describe, expect, it } from "vitest";
import { rewritePrompt, type RewriteInput } from "../../functions/regenerate-post-copy/prompt";
import { NOTE_MAX, cleanNote } from "../../functions/_shared/notes/regenerateNote";

// A post's copy rewritten on Regenerate, with the note the person left
// (notes on regenerate, Lital 3 Nov 2026).

const input = (over: Partial<RewriteInput> = {}): RewriteInput => ({
  platform: "Instagram", format: "Single image", pillar: "Beer League Truths", concept: "Captains pay last", currentCopy: "Captains pay last. Here is why.",
  currentCta: "Download the app", competitive: "", voiceBlock: "How Pay The Pyper writes.\n1. The team's stated preferences", note: "", ...over,
});

describe("rewritePrompt", () => {
  it("is today's prompt when no note is left", () => {
    expect(rewritePrompt(input())).toBe(`Rewrite this social media post copy with a fresh take. Keep the same strategic angle and concept, but create completely new wording.

PLATFORM: Instagram

CONTENT PILLAR: Beer League Truths
CONCEPT: Captains pay last
CURRENT COPY (rewrite this): Captains pay last. Here is why.
CURRENT CTA: Download the app

How Pay The Pyper writes.
1. The team's stated preferences

Return ONLY this JSON:
{
  "caption_angle": "the new post caption",
  "CTA": "new call to action",
  "hashtags": "relevant hashtags"
}`);
  });

  it("keeps the competitive picture where it was", () => {
    expect(rewritePrompt(input({ competitive: "COMPETITORS: x", platform: null, pillar: null, currentCta: null }))).toContain("PLATFORM: general\n\nCOMPETITORS: x\n\nCONTENT PILLAR: general");
  });

  it("puts the note after the voice, and says it wins for this post where it differs from a stated preference", () => {
    const prompt = rewritePrompt(input({ note: "Shorter, and no emoji" }));
    const voice = prompt.indexOf("1. The team's stated preferences");
    const note = prompt.indexOf('THE NOTE FOR THIS REWRITE: "Shorter, and no emoji"');
    expect(note).toBeGreaterThan(voice);
    expect(prompt).toContain("Someone on the brand's side asked for this rewrite with this note. Follow it for this post. Where it differs from a stated preference above, the note wins for this post.");
    expect(note).toBeLessThan(prompt.indexOf("Return ONLY this JSON"));
  });

  it("rewrites a Story's message as a Story is written: one or two short sentences, no hashtags", () => {
    const prompt = rewritePrompt(input({ format: "Story", note: "More playful" }));
    expect(prompt.split("\n")[0]).toBe("Rewrite this Story's message with a fresh take. Keep the same strategic angle and concept, but create completely new wording.");
    expect(prompt).toContain("FORMAT: Story: one still frame, 9:16, seen full screen for a few seconds");
    expect(prompt).toContain('"caption_angle": "the Story\'s message in one or two short sentences, which the words on its frame are written from"');
    expect(prompt).toContain('"hashtags": ""');
    expect(prompt).toContain('THE NOTE FOR THIS REWRITE: "More playful"');
  });

  it("treats a post called Story on another network as a feed post", () => {
    expect(rewritePrompt(input({ format: "Story", platform: "LinkedIn" })).split("\n")[0]).toBe("Rewrite this social media post copy with a fresh take. Keep the same strategic angle and concept, but create completely new wording.");
  });
});

describe("cleanNote", () => {
  it("trims a note and keeps it within the limit; anything else is no note", () => {
    expect(cleanNote("  Shorter please \n")).toBe("Shorter please");
    expect(cleanNote("x".repeat(NOTE_MAX + 40))).toHaveLength(NOTE_MAX);
    expect(cleanNote(undefined)).toBe("");
    expect(cleanNote(42)).toBe("");
    expect(cleanNote("   ")).toBe("");
  });
});
