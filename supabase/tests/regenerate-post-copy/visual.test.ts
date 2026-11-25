// Social AI sync, 18 Nov 2026 (Sinéad): a regenerated post kept its old
// "Visual:" line, so the design followed copy that was gone; and she asked
// for a Regenerate of its own for the visual that brings a new idea, not a
// rework of the same one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rewritePrompt, type RewriteInput } from "../../functions/regenerate-post-copy/prompt";

const input = (over: Partial<RewriteInput> = {}): RewriteInput => ({
  platform: "Instagram", format: "Single image", pillar: "Beer League Truths", concept: "Captains pay last", currentCopy: "Captains pay last. Here is why.",
  currentCta: "Download the app", competitive: "", voiceBlock: "VOICE", note: "", currentVisual: "A dim rink at night, one helmet on the bench.", ...over,
});

describe("the copy rewrite brings its visual along", () => {
  it("shows the current visual and asks for one that matches the new copy", () => {
    const prompt = rewritePrompt(input());
    expect(prompt).toContain("CURRENT VISUAL: A dim rink at night, one helmet on the bench.");
    expect(prompt).toContain('"visual_direction":');
    expect(prompt.indexOf('"visual_direction":')).toBeGreaterThan(prompt.indexOf('"caption_angle":'));
  });

  it("still asks for a visual when the post had none", () => {
    const prompt = rewritePrompt(input({ currentVisual: null }));
    expect(prompt).not.toContain("CURRENT VISUAL");
    expect(prompt).toContain('"visual_direction":');
  });
});

describe("Regenerate visual", () => {
  it("asks for a completely new visual idea, different from the current one, and keeps the copy", () => {
    const prompt = rewritePrompt(input({ mode: "visual" }));
    expect(prompt).toContain("CURRENT VISUAL (replace this with a different idea): A dim rink at night, one helmet on the bench.");
    expect(prompt).toContain("COPY (keep as it is): Captains pay last. Here is why.");
    expect(prompt).toContain('"visual_direction":');
    expect(prompt).not.toContain('"caption_angle"');
    expect(prompt).not.toContain('"hashtags"');
  });

  it("puts a note for the visual after the voice", () => {
    const prompt = rewritePrompt(input({ mode: "visual", note: "Show the parking lot" }));
    expect(prompt.indexOf('THE NOTE FOR THIS REWRITE: "Show the parking lot"')).toBeGreaterThan(prompt.indexOf("VOICE"));
  });
});

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
const ask = (body: Record<string, unknown>) => handler(new Request("https://f/regenerate-post-copy", { method: "POST", body: JSON.stringify({ client_id: "c1", platform: "Instagram", format: "Image", concept: "Captains pay last.", current_copy: "Captains pay last.", ...body }) }));
const answer = (json: Record<string, unknown>) => model.mockImplementation(async () => ({ text: JSON.stringify(json), stopReason: "end_turn", raw: {} }));

beforeEach(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "k" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../functions/regenerate-post-copy/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("regenerate-post-copy", () => {
  it("answers the new copy with its visual", async () => {
    answer({ caption_angle: "Captains always pay last.", CTA: "Get the app", hashtags: "#beerleague", visual_direction: "A captain's wallet left on the locker room bench." });
    const res = await ask({ current_visual: "A dim rink." });
    expect(res.status).toBe(200);
    expect((await res.json()).post).toMatchObject({ caption_angle: "Captains always pay last.", visual_direction: "A captain's wallet left on the locker room bench." });
    expect(String(model.mock.calls[0][0].body.messages[0].content)).toContain("CURRENT VISUAL: A dim rink.");
  });

  it("answers only a new visual for mode visual, and sends the copy as it is", async () => {
    answer({ visual_direction: "Two skates crossed on the ice under one floodlight." });
    const res = await ask({ mode: "visual", current_visual: "A dim rink." });
    expect(res.status).toBe(200);
    expect((await res.json()).post).toEqual({ visual_direction: "Two skates crossed on the ice under one floodlight." });
    expect(String(model.mock.calls[0][0].body.messages[0].content)).toContain("COPY (keep as it is): Captains pay last.");
  });

  it("refuses a visual answer with no visual, as it refuses a copy answer with no copy", async () => {
    answer({ caption_angle: "x" });
    expect((await ask({ mode: "visual" })).status).toBe(500);
  });
});
