import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { learnFromNote, recordFeedback } from "../../../functions/_shared/design-prompts/feedback";
import { loadDesignLearnings } from "../../../functions/_shared/design-prompts/learnings";
import { fakeDb, type FakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

// What a client's design memory learns: from a design turned down with Not
// right (its reasons teach, as before), and from a note left on Regenerate
// (notes on regenerate, Lital 3 Nov 2026), which teaches only when it says
// something lasting. The model is a fake: no call leaves the test.

const anthropic = vi.hoisted(() => vi.fn());
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: anthropic }));
vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterEach(() => anthropic.mockReset());
afterAll(() => vi.unstubAllGlobals());

const rules = (xs: Array<{ type: string; text: string }>) => anthropic.mockResolvedValue({ text: JSON.stringify({ rules: xs }), raw: {} });
const world = (): FakeDb => fakeDb({ design_learnings: [], post_iterations: [{ id: "it-1", client_id: "c1" }] });
const NOTE = { clientId: "c1", platform: "Instagram", format: "Single image", note: "Never show people, only the rink", userId: "person-1" };

describe("learnFromNote", () => {
  it("writes no rule for a note about this one post", async () => {
    const db = world();
    rules([]);
    expect(await learnFromNote(db, { ...NOTE, note: "Use the Friday sale photo" })).toEqual([]);
    expect(db.tables.design_learnings).toEqual([]);
    const call = anthropic.mock.calls[0][0].body;
    expect(call.model).toBe("claude-haiku-4-5-20251001");
    expect(call.max_tokens).toBe(400);
    expect(call.system).toContain("When the note is about this one post (its topic, its words, its picture, its date), write no rule.");
    expect(call.messages[0].content).toContain('"Use the Friday sale photo"');
  });

  it("keeps a lasting note as a rule for the brand's next designs, marked as learned from a note", async () => {
    const db = world();
    rules([{ type: "avoid", text: "Never show people; show the rink and the gear." }]);
    const learned = await learnFromNote(db, NOTE);
    expect(db.tables.design_learnings).toHaveLength(1);
    const row = db.tables.design_learnings[0];
    expect(row).toMatchObject({ client_id: "c1", pattern_type: "avoid", pattern_description: "Never show people; show the rink and the gear.", source: "regenerate_note", evidence: "Never show people, only the rink", created_by: "person-1", source_iteration_id: null });
    expect(learned).toEqual([{ id: row.id, pattern_type: "avoid", pattern_description: "Never show people; show the rink and the gear." }]);
    expect(await loadDesignLearnings(db, "c1")).toEqual({ avoid: ["Never show people; show the rink and the gear."], prefer: [] });
  });

  it("answers nothing learned, and writes nothing, when the learning does not finish", async () => {
    const db = world();
    anthropic.mockRejectedValue(new Error("busy"));
    expect(await learnFromNote(db, NOTE)).toBeNull();
    anthropic.mockResolvedValue({ text: "not json", raw: {} });
    expect(await learnFromNote(db, NOTE)).toBeNull();
    expect(db.tables.design_learnings).toEqual([]);
  });
});

describe("recordFeedback", () => {
  const it1 = { id: "it-1", client_id: "c1", platform: "Instagram", format: "Single image", concept: "a crowded bench" };

  it("still teaches from the reason, and lets the note join only when it is lasting", async () => {
    const db = world();
    rules([{ type: "avoid", text: "Avoid crowded scenes." }]);
    const learned = await recordFeedback(db, it1, "rejected", "wrong_style", "Too busy, and use the Friday photo", "person-1");
    const call = anthropic.mock.calls[0][0].body;
    expect(call.messages[0].content).toContain("because the visual style or layout did not fit the brand");
    expect(call.messages[0].content).toContain('Their note: "Too busy, and use the Friday photo"');
    expect(call.system).toContain("Use the note only where it says something lasting about the brand's designs; a part about this one post gives no rule.");
    const row = db.tables.design_learnings[0];
    expect(row).toMatchObject({ pattern_description: "Avoid crowded scenes.", source: "feedback", reason: "wrong_style", source_iteration_id: "it-1" });
    expect(learned).toEqual([{ id: row.id, pattern_type: "avoid", pattern_description: "Avoid crowded scenes." }]);
    expect(db.tables.post_iterations[0]).toMatchObject({ rejection_reason: "wrong_style", rejection_note: "Too busy, and use the Friday photo", is_selected: false });
  });

  it("remembers the reason itself when the model gives nothing", async () => {
    const db = world();
    anthropic.mockRejectedValue(new Error("busy"));
    await recordFeedback(db, it1, "rejected", "off_brand_colours", undefined, "person-1");
    expect(db.tables.design_learnings.map((r) => [r.pattern_description, r.source])).toEqual([["Avoid designs where the colors were off-brand.", "feedback"]]);
  });

  it("teaches nothing when a design is only deleted", async () => {
    const db = world();
    expect(await recordFeedback(db, it1, "archived", undefined, undefined, "person-1")).toEqual([]);
    expect(anthropic).not.toHaveBeenCalled();
    expect(db.tables.design_learnings).toEqual([]);
  });
});
