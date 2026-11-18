// Copy written again whose reply was cut off at its limit, or declined, is
// no copy: the person reads what the screen always said for a reply it
// cannot parse, never half a caption. The call leaves the model room to
// think before it writes (18 Nov 2026).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSON_WAIT_MS, roomFor } from "../../functions/_shared/anthropicReply";

vi.mock("../../functions/_shared/supabase.ts", () => ({ // The client has an account in Sprout, so it is not strategy-only (_shared/sprout/strategyOnly.ts).
  createClient: () => ({ rpc: async (name: string) => ({ data: name === "client_strategy_only" ? false : null, error: null }) }) }));
vi.mock("../../functions/_shared/auth/requireStaff.ts", () => ({ AuthzError: class AuthzError extends Error { status = 403; } }));
vi.mock("../../functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "u1" }));
vi.mock("../../functions/_shared/voice/load.ts", () => ({ COPY_MODEL: "claude-opus-5-5", loadClientVoice: async () => ({}) }));
vi.mock("../../functions/_shared/voice/voice.ts", () => ({ voicePromptBlock: () => "VOICE" }));
vi.mock("../../functions/_shared/competitive/brief.ts", () => ({ competitiveBrief: async () => "" }));

const model = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: model }));

let handler: (req: Request) => Promise<Response>;
let reply: { text: string; stop: string };
const sent = () => model.mock.calls.map((c) => ({ model: c[0].body.model, max_tokens: c[0].body.max_tokens, waitMs: c[0].waitMs }));

beforeEach(async () => {
  model.mockReset();
  model.mockImplementation(async () => ({ text: reply.text, stopReason: reply.stop, raw: {} }));
  vi.stubGlobal("Deno", { env: { get: () => "k" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../functions/regenerate-post-copy/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ask = () => handler(new Request("https://f/regenerate-post-copy", { method: "POST", body: JSON.stringify({ client_id: "c1", platform: "Instagram", concept: "The new office.", current_copy: "We moved." }) }));
const COPY = JSON.stringify({ caption_angle: "We moved, and the coffee is better.", CTA: "Visit us", hashtags: "#office" });

describe("regenerate-post-copy and a reply that did not finish", () => {
  it("asks with room for the model to think before the copy, and returns a whole reply's copy", async () => {
    reply = { text: COPY, stop: "end_turn" };
    const res = await ask();
    expect(res.status).toBe(200);
    expect((await res.json()).post.caption_angle).toBe("We moved, and the coffee is better.");
    // One call, and it may take what a person can wait and no more: past the request's own limit the person would read a gateway error.
    expect(sent()).toEqual([{ model: "claude-opus-5-5", max_tokens: roomFor(2000), waitMs: PERSON_WAIT_MS }]);
  });

  it("answers as it does for a reply it cannot parse when the reply was cut off, with or without text, declined, or too long in coming", async () => {
    for (const r of [{ text: "", stop: "max_tokens" }, { text: COPY, stop: "max_tokens" }, { text: "", stop: "refusal" }, { text: "", stop: "timed_out" }]) {
      reply = r;
      const res = await ask();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to parse copy from AI response" });
    }
    expect(sent()).toHaveLength(4);
  });
});
