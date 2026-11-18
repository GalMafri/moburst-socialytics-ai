// A one-off post whose reply was cut off at its limit, or declined, holds no
// post: the person reads what the screen always said for a reply it cannot
// parse, never half a post. The call leaves the model room to think before
// it writes (18 Nov 2026).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSON_WAIT_MS, roomFor } from "../../functions/_shared/anthropicReply";

vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({ from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: "the brand", content_pillars: [], brand_book_text: "" }, error: null }) }; return q; } }),
}));
vi.mock("../../functions/_shared/auth/requireStaff.ts", () => ({ staffGate: async () => null }));
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
  await import("../../functions/generate-ad-hoc-post/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ask = () => handler(new Request("https://f/generate-ad-hoc-post", { method: "POST", body: JSON.stringify({ client_id: "c1", platform: "Instagram", topic: "Our new office" }) }));
const POST = JSON.stringify({ platform: "Instagram", format: "Image", pillar: "Team", hook: "We moved.", concept: "The new office.", visual_direction: "A bright room.", caption_angle: "Come and see.", CTA: "Visit us", hashtags: "#office" });

describe("generate-ad-hoc-post and a reply that did not finish", () => {
  it("asks with room for the model to think before the post, and returns a whole reply's post", async () => {
    reply = { text: POST, stop: "end_turn" };
    const res = await ask();
    expect(res.status).toBe(200);
    expect((await res.json()).post.hook).toBe("We moved.");
    // One call, and it may take what a person can wait and no more: past the request's own limit the person would read a gateway error.
    expect(sent()).toEqual([{ model: "claude-opus-5-5", max_tokens: roomFor(2500), waitMs: PERSON_WAIT_MS }]);
  });

  it("answers as it does for a reply it cannot parse when the reply was cut off, with or without text, declined, or too long in coming", async () => {
    for (const r of [{ text: "", stop: "max_tokens" }, { text: POST, stop: "max_tokens" }, { text: "", stop: "refusal" }, { text: "", stop: "timed_out" }]) {
      reply = r;
      const res = await ask();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to parse post from AI response" });
    }
    // One call each: nothing is asked twice.
    expect(sent()).toHaveLength(4);
  });
});
