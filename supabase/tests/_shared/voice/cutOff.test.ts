// The voice's three model calls and a reply that did not finish (cut off at
// its limit, or declined): nothing is learned from it, a merge changes
// nothing, and a profile is not built from it. Each call leaves the model
// room to think before it answers (18 Nov 2026). The model is a fake.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildVoiceProfile, consolidateMemory, learnFromSignal } from "../../../functions/_shared/voice/load";
import { roomFor } from "../../../functions/_shared/anthropicReply";
import type { OwnPost } from "../../../functions/_shared/calendar/evidence";
import { fakeDb } from "../../support/lifecycleFakeDb";

const anthropic = vi.hoisted(() => vi.fn());
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: anthropic }));
vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterEach(() => anthropic.mockReset());
afterAll(() => vi.unstubAllGlobals());

const pref = (id: string, description: string) => ({
  id, client_id: "c1", pattern_type: "tone", pattern_description: description, times_confirmed: 1, source: "copy_edit",
  last_confirmed_at: "2026-10-13T00:00:00Z", platform: null, status: "active", replaced_by: null,
});
const world = () => fakeDb({ clients: [{ id: "c1", name: "the client", timezone: "UTC" }], brand_voice_learnings: [pref("p1", "Casual and upbeat."), pref("p2", "Short captions.")] });
const sent = () => anthropic.mock.calls.map((c) => [c[0].body.model, c[0].body.max_tokens]);
const NOTE = { kind: "rewrite_note" as const, note: "Never use exclamation marks", before: "Join us!", after: "Join us.", platform: "Instagram" };

describe("the voice and a reply that did not finish", () => {
  it("learns nothing from a signal whose reply was cut off, though its text holds a whole preference", async () => {
    const db = world();
    const before = structuredClone(db.tables.brand_voice_learnings);
    anthropic.mockResolvedValue({ text: JSON.stringify({ ops: [{ op: "add", pattern_type: "vocabulary", description: "Never use exclamation marks.", platform: null }] }), stopReason: "max_tokens", raw: {} });
    expect(await learnFromSignal(db, "c1", NOTE)).toEqual({ ops: 0, changes: [] });
    expect(db.tables.brand_voice_learnings).toEqual(before);
    expect(sent()).toEqual([["claude-sonnet-5-5", roomFor(1200)]]);
  });

  it("changes nothing when the merge's reply was cut off or declined", async () => {
    for (const stopReason of ["max_tokens", "refusal"]) {
      const db = world();
      const before = structuredClone(db.tables.brand_voice_learnings);
      anthropic.mockResolvedValue({ text: JSON.stringify({ preferences: [{ pattern_type: "tone", description: "Casual, in short captions.", from: ["p1", "p2"] }] }), stopReason, raw: {} });
      await expect(consolidateMemory(db, "c1")).rejects.toThrow("The memory merge returned nothing usable; nothing was changed.");
      expect(db.tables.brand_voice_learnings).toEqual(before);
    }
    expect(sent()[0]).toEqual(["claude-sonnet-5-5", roomFor(3000)]);
  });

  it("builds no profile from a reply that was cut off", async () => {
    const NOW = new Date("2026-11-17T08:00:00Z");
    const posts: OwnPost[] = Array.from({ length: 6 }, (_, i) => ({
      id: `li${i}`, platform: "LinkedIn", format: "image", publishedAt: new Date(NOW.getTime() - (i + 3) * 86_400_000).toISOString(),
      text: "Proud of the team this week, and thankful for every client who trusted us.", link: null, impressions: 100 + i, engagement: 5 + i,
    }));
    const db = world();
    anthropic.mockResolvedValue({ text: JSON.stringify({ platforms: { LinkedIn: { summary: "Warm and proud.", phrases: ["proud of the team"] } }, overall: { summary: "Warm and proud.", phrases: [] } }), stopReason: "max_tokens", raw: {} });
    await expect(buildVoiceProfile(db, "c1", posts, NOW)).rejects.toThrow("The voice profile reply could not be read.");
    expect(db.tables.clients[0].social_voice).toBeUndefined();
    expect(sent()).toEqual([["claude-opus-5-5", roomFor(6000)]]);
  });
});
