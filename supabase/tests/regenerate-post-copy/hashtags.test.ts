// QA 22 Nov 2026 (P58-01): regenerate-post-copy answers a post whose hashtags are a string, the
// shape its own prompt asks the model for. Every calendar post carries hashtags
// as string[] (calendar_posts.hashtags, saveCopy, mcp/reads.ts), and the
// calendar copy editor and Send to Sprout call .some/.map on them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({ rpc: async (name: string) => ({ data: name === "client_strategy_only" ? false : null, error: null }) }) }));
vi.mock("../../functions/_shared/auth/requireStaff.ts", () => ({ AuthzError: class AuthzError extends Error { status = 403; } }));
vi.mock("../../functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "u1" }));
vi.mock("../../functions/_shared/voice/load.ts", () => ({ COPY_MODEL: "m", loadClientVoice: async () => ({}) }));
vi.mock("../../functions/_shared/voice/voice.ts", () => ({ voicePromptBlock: () => "VOICE" }));
vi.mock("../../functions/_shared/competitive/brief.ts", () => ({ competitiveBrief: async () => "" }));
const model = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: model }));

let handler: (req: Request) => Promise<Response>;
beforeEach(async () => {
  // The model answers exactly the JSON shape prompt.ts:45-50 asks for.
  model.mockImplementation(async () => ({ text: JSON.stringify({ caption_angle: "We moved, and the coffee is better.", CTA: "Visit us", hashtags: "#office #coffee" }), stopReason: "end_turn", raw: {} }));
  vi.stubGlobal("Deno", { env: { get: () => "k" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../functions/regenerate-post-copy/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("regenerate-post-copy hashtags shape", () => {
  it("answers a feed post's hashtags as a list, the shape every calendar post has", async () => {
    const res = await handler(new Request("https://f/regenerate-post-copy", { method: "POST", body: JSON.stringify({ client_id: "c1", platform: "Instagram", format: "Image", concept: "The new office.", current_copy: "We moved." }) }));
    expect(res.status).toBe(200);
    const { post } = await res.json();
    expect(Array.isArray(post.hashtags)).toBe(true);
  });
});

describe("regenerate-post-copy hashtags for a Story", () => {
  it("answers a Story with no hashtags, as a list", async () => {
    const res = await handler(new Request("https://f/regenerate-post-copy", { method: "POST", body: JSON.stringify({ client_id: "c1", platform: "Instagram", format: "Story", concept: "The new office.", current_copy: "We moved." }) }));
    expect(res.status).toBe(200);
    const { post } = await res.json();
    expect(post.hashtags).toEqual([]);
  });
});

describe("regenerate-post-copy when the model gives no hashtags", () => {
  it("leaves hashtags out of the answer, so the post keeps its own and a save never clears them", async () => {
    for (const given of [undefined, null, "", []]) {
      model.mockImplementation(async () => ({ text: JSON.stringify({ caption_angle: "A new caption.", CTA: "Visit us", ...(given === undefined ? {} : { hashtags: given }) }), stopReason: "end_turn", raw: {} }));
      const res = await handler(new Request("https://f/regenerate-post-copy", { method: "POST", body: JSON.stringify({ client_id: "c1", platform: "Instagram", format: "Image", concept: "The new office.", current_copy: "We moved." }) }));
      const { post } = await res.json();
      expect("hashtags" in post, `given ${JSON.stringify(given)}`).toBe(false);
    }
  });
});
