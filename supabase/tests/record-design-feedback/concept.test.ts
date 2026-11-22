// P58-02: record-design-feedback reads the design row without its concept, so
// recordFeedback (design-prompts/feedback.ts:110) never tells the model what
// the rejected picture was, unlike the same rejection through design-request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROW = { id: "it1", client_id: "c1", platform: "Instagram", format: "Image", post_copy: "x", visual_direction: "desk", variant_angle: "a", concept: "A lawyer at a desk" };
vi.mock("../../../supabase/functions/_shared/supabase.ts", () => ({
  createClient: () => ({ from: () => ({ select: (cols: string) => {
    const picked = Object.fromEntries(cols.split(",").map((c) => c.trim()).map((c) => [c, (ROW as Record<string, unknown>)[c]]));
    const q = { eq: () => q, maybeSingle: async () => ({ data: picked, error: null }) };
    return q;
  } }) }) }));
vi.mock("../../../supabase/functions/_shared/auth/requireStaff.ts", () => ({
  AuthzError: class AuthzError extends Error { status = 403; },
  requireStaff: async () => ({ userId: "u1", viaSecret: false, asCaller: { rpc: async () => ({ data: true, error: null }) } }) }));
const record = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../../supabase/functions/_shared/design-prompts/feedback.ts", () => ({ recordFeedback: record }));

let handler: (req: Request) => Promise<Response>;
beforeEach(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "k" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../../supabase/functions/record-design-feedback/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("P58-02 record-design-feedback row", () => {
  it("hands recordFeedback the design's concept, which its prompt uses", async () => {
    const res = await handler(new Request("https://f/record-design-feedback", { method: "POST", body: JSON.stringify({ iteration_id: "it1", verdict: "rejected", reason: "off_brand" }) }));
    expect(res.status).toBe(200);
    const it = record.mock.calls[0][1] as Record<string, unknown>;
    expect(it.concept).toBe("A lawyer at a desk");
  });
});
