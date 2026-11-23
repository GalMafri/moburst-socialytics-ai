// @vitest-environment node
// QA 22 Nov 2026 (P58-03): a brand read whose model step did not finish was
// answered 502, and the setup page (BrandBookUpload.tsx, invokeResendable with
// idempotent: true) resends any 5xx: up to three more crawls and model calls,
// each paid, before the same "not read yet". It is answered as a refusal now.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeResendable } from "../../../src/lib/quietSend";

const research = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/supabase.ts", () => ({ createClient: () => ({}) }));
vi.mock("../../functions/_shared/auth/requireStaff.ts", () => ({ staffGate: async () => null }));
vi.mock("../../functions/_shared/brand/research.ts", () => {
  class ResearchError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return { ResearchError, researchBrand: research };
});

let handler: (req: Request) => Promise<Response>;
beforeEach(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../functions/research-brand-identity/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); research.mockReset(); });

describe("research-brand-identity when the model does not finish the read", () => {
  it("answers a status the setup page does not send again", async () => {
    const { ResearchError } = await import("../../functions/_shared/brand/research.ts");
    research.mockRejectedValue(new ResearchError("model", "The brand read did not finish (500)."));
    const res = await handler(new Request("https://f/research-brand-identity", { method: "POST", body: JSON.stringify({ website_url: "https://example.com" }) }));
    expect(res.status).toBeLessThan(500);
    expect((await res.json()).error).toMatch(/did not finish/);
    expect(invokeResendable({ context: { status: res.status } }, { idempotent: true })).toBe(false);
  });
});
