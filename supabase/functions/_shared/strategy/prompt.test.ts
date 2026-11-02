// @vitest-environment node
// The strategy as the calendar planner reads it (spec: docs/superpowers/specs/
// 2026-11-02-content-strategy-tab-design.md, "The calendar planner"): goals,
// audience, positioning, pillars, the platforms posting now and what to avoid,
// people's versions where edited, capped, and "" for a client with none.
import { describe, expect, it } from "vitest";
import { STRATEGY_BLOCK_CHARS, strategyBlock, strategyPromptBlock } from "./prompt";
import { fakeDb } from "../lifecycle/fakeDb";

const stored = (over: Record<string, unknown> = {}) => ({
  client_id: "c1",
  written_at: "2026-11-02T10:00:00.000Z",
  sections: {
    goals: "Grow saves on Instagram.", audience: "Rec league captains.", positioning: "Built around the captain's week.",
    "pillar:Beer League Truths": "Carousels of league truths.", "pillar:Captain Life": "Checklists and reminders.",
    "platform:instagram:posting": "The home base: carousels and reels.", "platform:tiktok:new": "Launch with captain POV skits.",
    not_now: "YouTube: long video is costly.", avoid: "Office photos.", measures: "Instagram: median engagement above 42.",
  },
  platforms: [{ platform: "Instagram", key: "instagram", state: "posting" }, { platform: "TikTok", key: "tiktok", state: "new" }, { platform: "YouTube", key: "youtube", state: "not_now" }],
  pillars: [{ name: "Beer League Truths", share: 50 }, { name: "Captain Life", share: 50 }],
  ...over,
});

describe("the strategy block", () => {
  it("gives goals, audience, positioning, pillars, the platforms posting now and what to avoid", () => {
    const block = strategyBlock(stored(), []);
    for (const part of ["Grow saves on Instagram.", "Rec league captains.", "Built around the captain's week.", "- Beer League Truths: Carousels of league truths.", "- Captain Life: Checklists and reminders.", "- Instagram: The home base: carousels and reels.", "Office photos."]) {
      expect(block).toContain(part);
    }
    // New platforms need a live account before the calendar can plan them; measures and not now are for the team.
    for (const left of ["captain POV skits", "median engagement above 42", "long video is costly"]) expect(block).not.toContain(left);
  });

  it("gives people's versions wherever they edited a section", () => {
    const block = strategyBlock(stored(), [
      { section_key: "audience", text: "Captains and their co-captains." },
      { section_key: "pillar:Captain Life", text: "What a captain's Tuesday looks like." },
      { section_key: "platform:instagram:posting", text: "Reels first." },
      { section_key: "pillar:Old pillar", text: "A pillar that left the strategy." },
    ]);
    expect(block).toContain("Captains and their co-captains.");
    expect(block).not.toContain("Rec league captains.");
    expect(block).toContain("- Captain Life: What a captain's Tuesday looks like.");
    expect(block).toContain("- Instagram: Reels first.");
    expect(block).not.toContain("A pillar that left the strategy.");
  });

  it("holds at most 4,000 characters, cut at a line", () => {
    const long = Array.from({ length: 400 }, (_, i) => `- Goal line ${i} for the next 90 days.`).join("\n");
    const block = strategyBlock(stored({ sections: { ...stored().sections, goals: long } }), []);
    expect(STRATEGY_BLOCK_CHARS).toBe(4000);
    expect(block.length).toBeLessThanOrEqual(4000);
    expect(block.length).toBeGreaterThan(3000);
    expect(block.endsWith("days.")).toBe(true);
  });

  it("is empty for a client with no strategy, and reads people's versions with the stored one", async () => {
    expect(await strategyPromptBlock(fakeDb({}), "c1")).toBe("");
    // A row that holds only a write under way is no strategy yet.
    expect(await strategyPromptBlock(fakeDb({ content_strategies: [{ client_id: "c1", sections: {}, platforms: [], pillars: [], written_at: null, pending: { phase: "check" } }] }), "c1")).toBe("");
    const db = fakeDb({ content_strategies: [stored()], content_strategy_edits: [{ client_id: "c1", section_key: "goals", text: "Win playoffs season." }, { client_id: "c2", section_key: "avoid", text: "Another client's." }] });
    const block = await strategyPromptBlock(db, "c1");
    expect(block).toContain("Win playoffs season.");
    expect(block).not.toContain("Another client's.");
  });

  it("says why when the strategy cannot be read", async () => {
    const db = fakeDb({});
    db.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) });
    await expect(strategyPromptBlock(db, "c1")).rejects.toThrow("Could not read the content strategy: boom");
  });
});
