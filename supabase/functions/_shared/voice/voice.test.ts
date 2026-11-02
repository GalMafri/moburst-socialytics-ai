import { describe, it, expect } from "vitest";
import { consolidatePrompt, mergePrompt, parseConsolidation, parseMergeOps, parseVoiceProfile, voicePromptBlock, voiceProfilePrompt, type ClientVoice, type Preference } from "./voice";
import { loadClientVoice } from "./load";
import { fakeDb } from "../lifecycle/fakeDb";
import type { DatedPoint } from "../notes/notes";

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
    expect(block).toContain("How Moburst writes. When these disagree, the earlier one wins.\n");
    // Each preference carries the date it was last confirmed.
    expect(block).toMatch(/- Direct, instructional tone\. \(Oct 13(, 2026)?, confirmed 3 times\)/);
    expect(block).toMatch(/- No emoji on LinkedIn\. \(Oct 13(, 2026)?\)/);
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

describe("what the client told the team (section 1)", () => {
  const TODAY = "2026-11-02";
  const dated = (id: string, kind: DatedPoint["kind"], date: string, text: string, over: Partial<DatedPoint> = {}): DatedPoint =>
    ({ id, note_id: "n1", kind, text, platform: null, said_on: null, until: null, created_at: `${date}T12:00:00Z`, date, ...over });
  const points = [
    dated("a", "avoid", "2026-10-28", `Never say "cheap"; say "affordable".`),
    dated("ig", "do", "2026-10-25", "Use carousels.", { platform: "Instagram" }),
    dated("u", "upcoming", "2026-10-20", "Holiday sale, 20% off.", { until: "2026-11-30" }),
    dated("f", "fact", "2026-10-01", "The new office opens on Main St."),
  ];
  const withNotes = (over: Partial<NonNullable<ClientVoice["notes"]>> = {}): ClientVoice => ({ ...VOICE, notes: { points, standing: null, today: TODAY, ...over } });

  it("comes first, with dated points and the rule that the later date wins between it and the team's preferences", () => {
    const block = voicePromptBlock(withNotes(), { platforms: ["Instagram"] });
    expect(block.split("\n")[0]).toBe("How Moburst writes. When these disagree, the earlier one wins, except between 1 and 2, where the later date wins.");
    const i1 = block.indexOf("1. What Moburst told the team. Follow these; use the facts, but never say they come from notes or meetings.");
    const i2 = block.indexOf("2. The team's stated preferences, each with the date it was last confirmed");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(block.indexOf("3. Moburst's real social voice")).toBeGreaterThan(i2);
    expect(block).toContain("4. The brief's tone");
    for (const line of ["Avoid:", `- Oct 28: Never say "cheap"; say "affordable".`, "Do:", "- Oct 25 (Instagram only): Use carousels.", "Coming up:", "- Until Nov 30: Holiday sale, 20% off.", "Facts:", "- Oct 1: The new office opens on Main St."]) {
      expect(block.slice(i1, i2)).toContain(`${line}\n`);
    }
    expect(block).toContain("- Direct, instructional tone. (Oct 13, confirmed 3 times)");
  });

  it("leaves out a point for another platform", () => {
    expect(voicePromptBlock(withNotes(), { platforms: ["LinkedIn"] })).not.toContain("Use carousels.");
  });

  it("is absent when there are no points and no standing notes", () => {
    const block = voicePromptBlock(withNotes({ points: [] }));
    expect(block).not.toContain("told the team");
    expect(block).toContain("1. The team's stated preferences");
    expect(block.split("\n")[0]).toBe("How Moburst writes. When these disagree, the earlier one wins.");
  });

  it("prints the team's standing notes (the brief's brand notes) above the dated points, capped at 1,500 characters", () => {
    const block = voicePromptBlock(withNotes({ standing: `Always say "clients", never "customers".\n${"More notes here. ".repeat(150)}` }));
    const section = block.slice(block.indexOf("1. What Moburst"), block.indexOf("2. The team's"));
    const standing = section.indexOf("Standing notes from the team:\nAlways say \"clients\", never \"customers\".");
    expect(standing).toBeGreaterThan(-1);
    expect(standing).toBeLessThan(section.indexOf("Avoid:"));
    const text = section.slice(section.indexOf("Standing notes from the team:\n") + "Standing notes from the team:\n".length, section.indexOf("\nAvoid:"));
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text.endsWith(".")).toBe(true);
    // Standing notes alone still make section 1.
    expect(voicePromptBlock(withNotes({ points: [], standing: "No slang." }))).toContain("1. What Moburst told the team.");
  });

  it("stays within 5,000 characters, the standing notes included", () => {
    const many = Array.from({ length: 60 }, (_, i) => dated(`p${i}`, "avoid", "2026-10-20", `Rule ${i}: ${"w".repeat(200)}`));
    const block = voicePromptBlock(withNotes({ points: many, standing: "S. ".repeat(600) }));
    const body = block.slice(block.indexOf("\n", block.indexOf("1. What Moburst")) + 1, block.indexOf("\n2. The team's"));
    expect(body.length).toBeLessThanOrEqual(5000);
    expect(body.startsWith("Standing notes from the team:")).toBe(true);
  });
});

describe("loadClientVoice", () => {
  it("returns only the points in use, the client's standing notes and the client's day", async () => {
    const db = fakeDb({
      clients: [{ id: "c1", name: "Bader Law", brand_identity: { tone_of_voice: "Plain" }, social_voice: null, brand_notes: "  No slang.  ", timezone: "Pacific/Auckland" }],
      brand_voice_learnings: [],
      client_notes: [
        { id: "n1", client_id: "c1", note_date: "2026-10-01", date_set_by: "app", created_at: "2026-10-01T00:00:00Z" },
        { id: "n2", client_id: "c1", note_date: "2026-10-20", date_set_by: "app", created_at: "2026-10-20T00:00:00Z" },
      ],
      client_note_points: [
        { id: "old", client_id: "c1", note_id: "n1", kind: "avoid", text: "Old rule.", platform: null, said_on: null, until: null, created_at: "2026-10-01T00:00:00Z", removed_at: null },
        { id: "new", client_id: "c1", note_id: "n2", kind: "avoid", text: "New rule.", platform: null, said_on: null, until: null, created_at: "2026-10-20T00:00:00Z", removed_at: null },
        { id: "gone", client_id: "c1", note_id: "n2", kind: "do", text: "Removed.", platform: null, said_on: null, until: null, created_at: "2026-10-20T00:00:00Z", removed_at: "2026-10-21T00:00:00Z" },
        { id: "over", client_id: "c1", note_id: "n2", kind: "upcoming", text: "Sale.", platform: null, said_on: null, until: "2026-11-02", created_at: "2026-10-20T00:00:00Z", removed_at: null },
        { id: "other", client_id: "c2", note_id: "n9", kind: "do", text: "Another client's.", platform: null, said_on: null, until: null, created_at: "2026-10-20T00:00:00Z", removed_at: null },
      ],
      client_note_links: [{ client_id: "c1", point_id: "new", other_id: "old", relation: "conflict", created_at: "2026-10-20T00:00:00Z" }],
    });
    // Nov 3 in Auckland: the sale's last day was yesterday there.
    const voice = await loadClientVoice(db, "c1", new Date("2026-11-02T12:00:00Z"));
    expect(voice.notes?.today).toBe("2026-11-03");
    expect(voice.notes?.points.map((p) => p.id)).toEqual(["new"]);
    expect(voice.notes?.standing).toBe("No slang.");
    expect(voicePromptBlock(voice)).toContain("Standing notes from the team:\nNo slang.\nAvoid:\n- Oct 20: New rule.");
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
