import { describe, it, expect } from "vitest";
import { consolidatePrompt, mergePrompt, parseConsolidation, parseMergeOps, parseVoiceProfile, voicePromptBlock, voiceProfilePrompt, type ClientVoice, type Preference } from "./voice";

const pref = (id: string, description: string, times = 1, at = "2026-10-13T00:00:00Z", type = "tone"): Preference =>
  ({ id, pattern_type: type, pattern_description: description, times_confirmed: times, source: "copy_edit", last_confirmed_at: at });

const VOICE: ClientVoice = {
  brand: "Moburst",
  preferences: [pref("p1", "Direct, instructional tone.", 3), pref("p2", "No emoji on LinkedIn.")],
  social: {
    built_at: "2026-10-19T08:00:00Z",
    post_count: 41,
    platforms: {
      LinkedIn: { summary: "Confident and data-led.", opening: "Opens with a number.", length: "3 short paragraphs", structure: "Line breaks", emoji: "Rare", hashtags: "2 to 3 at the end", cta: "Soft", person: "We", formality: "Professional", phrases: ["growth done right"] },
      Instagram: { summary: "Playful.", opening: "", length: "", structure: "", emoji: "Often", hashtags: "", cta: "", person: "", formality: "", phrases: [] },
    },
    examples: { LinkedIn: [{ text: "AEO gets you recommended.", date: "2026-10-02", link: null, format: "image" }], Instagram: [{ text: "Swipe for the checklist", date: "2026-10-03", link: null, format: "carousel" }] },
  },
  briefTone: "Ambitious, expert, results-driven, growth-focused.",
};

describe("voicePromptBlock", () => {
  it("puts the team's preferences first, then the real voice, then the brief", () => {
    const block = voicePromptBlock(VOICE);
    const i1 = block.indexOf("1. The team's stated preferences");
    const i2 = block.indexOf("2. Moburst's real social voice");
    const i3 = block.indexOf("3. The brief's tone");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(block).toContain("- Direct, instructional tone. (confirmed 3 times)");
    expect(block).toContain("41 posts, 2026-10-19");
    expect(block).toContain('Phrases it uses: "growth done right"');
  });

  it("narrows the voice and examples to the platforms asked for", () => {
    const block = voicePromptBlock(VOICE, { platforms: ["linkedin"] });
    expect(block).toContain("LinkedIn: Confident and data-led.");
    expect(block).not.toContain("Instagram: Playful.");
    expect(block).not.toContain("Swipe for the checklist");
  });

  it("says plainly when nothing has been learned yet", () => {
    const block = voicePromptBlock({ brand: "Bader Law", preferences: [], social: null, briefTone: null });
    expect(block).toContain("- None recorded yet.");
    expect(block).toContain("Not learned yet");
    expect(block).toContain("3. The brief's tone: not given");
  });
});

describe("voice profile", () => {
  it("asks about each platform's posts and reads back only platforms that were asked about", () => {
    const prompt = voiceProfilePrompt("Bader Law", { Facebook: [{ text: "Injured? Call us.", date: "2026-10-01", format: "image" }] });
    expect(prompt).toContain("Facebook (1 posts):");
    const parsed = parseVoiceProfile(JSON.stringify({ platforms: { facebook: { summary: "Plain and urgent.", phrases: ["Call us", 3] }, TikTok: { summary: "x" } } }), ["Facebook"]);
    expect(Object.keys(parsed)).toEqual(["Facebook"]);
    expect(parsed.Facebook.phrases).toEqual(["Call us"]);
  });
});

describe("the preference memory", () => {
  const current = [pref("p1", "Removes explicit calls to action.", 1, "2026-08-26T00:00:00Z", "cta_style"), pref("p2", "Concise copy.")];

  it("describes an edit or a note against the current list", () => {
    expect(mergePrompt("Moburst", current, { kind: "copy_edit", before: "A. Follow us!", after: "A.", platform: "LinkedIn" })).toContain("for LinkedIn");
    expect(mergePrompt("Moburst", [], { kind: "revise_note", note: "No emojis" })).toContain('"No emojis"');
  });

  it("keeps operations on real preferences, one per preference, at most three", () => {
    const ops = parseMergeOps(JSON.stringify({ ops: [
      { op: "replace", id: "p1", pattern_type: "cta_style", description: "End with a direct call to action." },
      { op: "confirm", id: "p1" },
      { op: "confirm", id: "nope" },
      { op: "add", pattern_type: "weird", description: "No emoji on LinkedIn." },
      { op: "confirm", id: "p2" },
      { op: "add", pattern_type: "tone", description: "Fourth op" },
    ] }), ["p1", "p2"]);
    expect(ops).toEqual([
      { op: "replace", id: "p1", pattern_type: "cta_style", description: "End with a direct call to action." },
      { op: "add", pattern_type: "other", description: "No emoji on LinkedIn." },
      { op: "confirm", id: "p2" },
    ]);
    expect(parseMergeOps("not json", ["p1"])).toEqual([]);
  });

  it("consolidates an unmerged list, keeping only ids that exist", () => {
    expect(consolidatePrompt("Moburst", current)).toContain("[p1] 2026-08-26 (cta_style)");
    const merged = parseConsolidation(JSON.stringify({ preferences: [{ pattern_type: "cta_style", description: "Direct CTAs.", from: ["p1", "x"] }, { description: "No source", from: [] }] }), ["p1", "p2"]);
    expect(merged).toEqual([{ pattern_type: "cta_style", description: "Direct CTAs.", from: ["p1"] }]);
  });
});
