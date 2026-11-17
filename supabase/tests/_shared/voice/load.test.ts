import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildVoiceProfile, learnFromSignal, undoLearning } from "../../../functions/_shared/voice/load";
import { VOICE_RULE } from "../../../functions/_shared/voice/voice";
import type { OwnPost } from "../../../functions/_shared/calendar/evidence";
import { fakeDb, type FakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

// The preference memory learning from one signal, and a rewrite note's
// learning taken back with Undo (notes on regenerate, 3 Nov 2026). The model
// is a fake: no call leaves the test.

const anthropic = vi.hoisted(() => vi.fn());
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: anthropic }));
vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterEach(() => anthropic.mockReset());
afterAll(() => vi.unstubAllGlobals());

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const pref = (id: string, description: string, over: Row = {}): Row => ({
  id, client_id: "c1", pattern_type: "tone", pattern_description: description, times_confirmed: 1, source: "copy_edit",
  last_confirmed_at: "2026-10-13T00:00:00Z", platform: null, status: "active", replaced_by: null, ...over,
});

function world(prefs: Row[]): FakeDb {
  return fakeDb({ clients: [{ id: "c1", name: "Pay The Pyper" }], brand_voice_learnings: prefs });
}
const reply = (ops: Row[]) => anthropic.mockResolvedValue({ text: JSON.stringify({ ops }), raw: {} });
const active = (db: FakeDb) => db.tables.brand_voice_learnings.filter((p) => p.client_id === "c1" && p.status === "active").map((p) => p.pattern_description).sort();
const NOTE = { kind: "rewrite_note" as const, note: "Never use exclamation marks", before: "Join us!", after: "Join us.", platform: "Instagram" };

describe("learnFromSignal", () => {
  it("reports what it added, replaced and confirmed, and keeps a rewrite note's preferences under their own source", async () => {
    const db = world([pref("p1", "Casual and upbeat."), pref("p2", "Short captions.", { pattern_type: "length", times_confirmed: 2 })]);
    reply([
      { op: "add", pattern_type: "vocabulary", description: "Never use exclamation marks.", platform: null },
      { op: "replace", id: "p1", pattern_type: "tone", description: "Calm and plain.", platform: null },
      { op: "confirm", id: "p2" },
    ]);
    const out = await learnFromSignal(db, "c1", NOTE);
    expect(anthropic).toHaveBeenCalledTimes(1);
    expect(anthropic.mock.calls[0][0].body.messages[0].content).toContain('"Never use exclamation marks"');
    const added = db.tables.brand_voice_learnings.find((p) => p.pattern_description === "Never use exclamation marks.")!;
    const calm = db.tables.brand_voice_learnings.find((p) => p.pattern_description === "Calm and plain.")!;
    expect(added).toMatchObject({ source: "rewrite_note", evidence: "Never use exclamation marks", status: "active" });
    expect(out.ops).toBe(3);
    expect(out.changes).toEqual([
      { op: "add", id: added.id, description: "Never use exclamation marks.", platform: null },
      { op: "replace", id: calm.id, description: "Calm and plain.", platform: null, added: true, replaced: { id: "p1", description: "Casual and upbeat." } },
      { op: "confirm", id: "p2", description: "Short captions.", platform: null },
    ]);
    expect(active(db)).toEqual(["Calm and plain.", "Never use exclamation marks.", "Short captions."]);
  });

  it("reports an addition in the same words as a preference it has as a confirmation", async () => {
    const db = world([pref("p1", "Never use exclamation marks.", { pattern_type: "vocabulary" })]);
    reply([{ op: "add", pattern_type: "vocabulary", description: "never use exclamation marks.", platform: null }]);
    const out = await learnFromSignal(db, "c1", NOTE);
    expect(out.changes).toEqual([{ op: "confirm", id: "p1", description: "Never use exclamation marks.", platform: null }]);
    expect(db.tables.brand_voice_learnings).toHaveLength(1);
  });

  it("reports nothing for a note about this post alone", async () => {
    const db = world([pref("p1", "Casual and upbeat.")]);
    reply([]);
    expect(await learnFromSignal(db, "c1", { ...NOTE, note: "Mention the Friday sale" })).toEqual({ ops: 0, changes: [] });
    expect(active(db)).toEqual(["Casual and upbeat."]);
  });

  it("still asks nothing for a copy edit that changed nothing", async () => {
    const db = world([]);
    expect(await learnFromSignal(db, "c1", { kind: "copy_edit", before: "Same.", after: "Same. " })).toEqual({ ops: 0, changes: [] });
    expect(anthropic).not.toHaveBeenCalled();
  });
});

describe("undoLearning", () => {
  it("puts the list back as it was before the note: the addition goes and the replaced preference returns", async () => {
    const db = world([pref("p1", "Casual and upbeat."), pref("p2", "Short captions.", { pattern_type: "length" })]);
    reply([
      { op: "add", pattern_type: "vocabulary", description: "Never use exclamation marks.", platform: null },
      { op: "replace", id: "p1", pattern_type: "tone", description: "Calm and plain.", platform: null },
      { op: "confirm", id: "p2" },
    ]);
    const before = active(db);
    const { changes } = await learnFromSignal(db, "c1", NOTE);
    expect(await undoLearning(db, "c1", changes)).toBe(2);
    expect(active(db)).toEqual(before);
    expect(db.tables.brand_voice_learnings.find((p) => p.id === "p1")).toMatchObject({ status: "active", replaced_by: null });
  });

  it("brings back a preference that a preference it already had replaced, keeping that one", async () => {
    const db = world([pref("p1", "Casual and upbeat."), pref("p3", "Calm and plain.")]);
    reply([{ op: "replace", id: "p1", pattern_type: "tone", description: "Calm and plain.", platform: null }]);
    const { changes } = await learnFromSignal(db, "c1", NOTE);
    expect(changes).toEqual([{ op: "replace", id: "p3", description: "Calm and plain.", platform: null, added: false, replaced: { id: "p1", description: "Casual and upbeat." } }]);
    await undoLearning(db, "c1", changes);
    expect(active(db)).toEqual(["Calm and plain.", "Casual and upbeat."]);
  });

  it("takes back only what a note wrote for this client: another source, another client or a later change is left alone", async () => {
    const db = world([
      pref("e1", "From a copy edit."),
      pref("n2", "Another client's note.", { client_id: "c2", source: "rewrite_note" }),
      pref("p1", "Replaced since by someone else.", { status: "replaced", replaced_by: "x9" }),
    ]);
    const undone = await undoLearning(db, "c1", [
      { op: "add", id: "e1", description: "From a copy edit.", platform: null },
      { op: "add", id: "n2", description: "Another client's note.", platform: null },
      { op: "replace", id: "z1", description: "Gone.", platform: null, added: true, replaced: { id: "p1", description: "Replaced since by someone else." } },
    ]);
    expect(undone).toBe(0);
    expect(db.tables.brand_voice_learnings.map((p) => [p.id, p.status])).toEqual([["e1", "active"], ["n2", "active"], ["p1", "replaced"]]);
  });
});

// Copy sources, 17 Nov 2026 (invented names): a voice profile is stored with the display names the
// client's Sprout account lists written plainly, and carries the version of the rule it was built under.
describe("buildVoiceProfile", () => {
  const NOW = new Date("2026-11-17T08:00:00Z");
  const posts: OwnPost[] = Array.from({ length: 6 }, (_, i) => ({
    id: `li${i}`, platform: "LinkedIn", format: "image", publishedAt: new Date(NOW.getTime() - (i + 3) * 86_400_000).toISOString(),
    text: "Proud of the team this week, and thankful for every client who trusted us.", link: null, impressions: 100 + i, engagement: 5 + i,
  }));
  const reply = JSON.stringify({
    platforms: { LinkedIn: { summary: "Warm and proud; thanks Dana Reed ★★★★★ by name.", phrases: ["Dana Reed ★★★★★", "proud of the team"] } },
    overall: { summary: "Warm and proud.", phrases: ["Northwind Law - Trial Lawyers"] },
  });

  it("stores the rule's version and plain phrases", async () => {
    anthropic.mockResolvedValue({ text: reply, raw: {} });
    const db = fakeDb({ clients: [{ id: "c1", name: "Northwind Law", timezone: "UTC" }] });
    const voice = await buildVoiceProfile(db, "c1", posts, NOW, { names: [{ name: "Dana Reed ★★★★★", plain: "Dana Reed" }, { name: "Northwind Law - Trial Lawyers", plain: "Northwind Law" }] });
    expect(VOICE_RULE).toBe(1);
    expect(voice.rule).toBe(VOICE_RULE);
    expect(voice.platforms.LinkedIn.summary).toBe("Warm and proud; thanks Dana Reed by name.");
    expect(voice.platforms.LinkedIn.phrases).toEqual(["Dana Reed", "proud of the team"]);
    expect(voice.overall?.phrases).toEqual(["Northwind Law"]);
    // What the database holds is what was returned.
    expect(db.tables.clients[0].social_voice).toEqual(voice);
    expect(JSON.stringify(db.tables.clients[0].social_voice)).not.toContain("★");
  });

  it("stores the rule's version for a client with no listed names, and leaves its phrases as written", async () => {
    anthropic.mockResolvedValue({ text: reply, raw: {} });
    const db = fakeDb({ clients: [{ id: "c1", name: "Northwind Law", timezone: "UTC" }] });
    const voice = await buildVoiceProfile(db, "c1", posts, NOW);
    expect(voice.rule).toBe(VOICE_RULE);
    expect(voice.platforms.LinkedIn.phrases).toEqual(["Dana Reed ★★★★★", "proud of the team"]);
  });
});
