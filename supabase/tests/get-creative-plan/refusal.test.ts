/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// P57-03: get-creative-plan answers a plan that can never load again (its
// client's references changed) with the same 500 it gives an outage, so the
// post panel (P09-05) cannot tell "stop" from "try later".
import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as any;
function fakeDb() {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain, eq: () => chain,
        single: async () => table === "creative_directions"
          ? { data: { id: "p1", client_id: "c1", mode: "image", platform: "Instagram", format: "Image", plan: { frames: [] }, reference_paths: ["c1/old.png"] }, error: null }
          : { data: { design_references: ["c1/new.png"], harvested_design_references: [] }, error: null },
        maybeSingle: async () => ({ data: { logo_url: null, brand_identity: null }, error: null }),
      };
      return chain;
    },
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x/${p}` }, error: null }) }) },
  };
}

async function load() {
  vi.resetModules();
  vi.doMock("../../../supabase/functions/_shared/supabase.ts", () => ({ createClient: () => fakeDb() }));
  vi.doMock("../../../supabase/functions/_shared/auth/requireStaff.ts", () => ({
    AuthzError: class extends Error { status = 403; },
    requireStaff: async () => ({ userId: "staff-1" }),
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("none", { status: 599 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../../supabase/functions/get-creative-plan/index.ts");
  return handler;
}
afterEach(() => { delete g.Deno; vi.doUnmock("../../../supabase/functions/_shared/supabase.ts"); vi.doUnmock("../../../supabase/functions/_shared/auth/requireStaff.ts"); });

describe("get-creative-plan for a plan whose references changed", () => {
  it("answers a refusal (4xx) the caller can stop on, not a server error", async () => {
    const h = await load();
    const res = await h(new Request("http://x/get-creative-plan", { method: "POST", body: JSON.stringify({ plan_id: "p1", client_id: "c1" }) }));
    const body = await res.json();
    expect(body.error).toMatch(/references have changed/);
    expect(res.status).toBeLessThan(500);
    expect(body.code).toBe("plan_unavailable");
  });
});
