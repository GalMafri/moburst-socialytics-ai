/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// A new post, and a post's copy written again, for a strategy-only client (no
// active account in Sprout): both answer 409 with the one sentence before the
// model is asked for anything. For a client in Sprout both write as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Any = any;
const g = globalThis as Any;
const SENTENCE = "Harbor Lane is set up for strategy only. Its calendar, designs, analytics and reports open once its social accounts are connected.";

let world: { strategyOnly: boolean; modelCalls: number };

function fakeAdmin() {
  return {
    rpc: async (name: string) => ({ data: name === "client_strategy_only" ? world.strategyOnly : null, error: null }),
    from(table: string) {
      const chain: Any = {
        select: () => chain, eq: () => chain, in: () => chain, is: () => chain, not: () => chain, order: () => chain, limit: () => chain, gte: () => chain,
        maybeSingle: async () => ({ data: table === "clients" ? { name: "Harbor Lane", content_pillars: [], brand_book_text: "" } : null, error: null }),
        then: (ok: Any) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return chain;
    },
  };
}

async function load(fn: "generate-ad-hoc-post" | "regenerate-post-copy") {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => fakeAdmin() }));
  vi.doMock("../../functions/_shared/auth/requireStaff.ts", () => ({
    AuthzError: class extends Error { constructor(public status: number, message: string) { super(message); } },
    requireStaff: async () => ({ userId: "staff-1" }),
    staffGate: async () => null,
  }));
  vi.doMock("../../functions/_shared/auth/requireMember.ts", () => ({ requireMember: async () => "person-1" }));
  vi.doMock("../../functions/_shared/voice/load.ts", () => ({ COPY_MODEL: "copy-model", loadClientVoice: async () => null }));
  vi.doMock("../../functions/_shared/voice/voice.ts", () => ({ voicePromptBlock: () => "" }));
  vi.doMock("../../functions/_shared/competitive/brief.ts", () => ({ competitiveBrief: async () => "" }));
  vi.doMock("../../functions/_shared/anthropic.ts", () => ({
    anthropicMessages: async () => { world.modelCalls++; return { text: JSON.stringify({ platform: "Instagram", format: "Single image", hook: "A hook", concept: "A concept", caption_angle: "A caption", CTA: "Learn more", hashtags: "#one" }) }; },
  }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import(`../../functions/${fn}/index.ts`);
  return handler;
}
const ask = (handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) => handler(new Request("http://x/fn", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { world = { strategyOnly: true, modelCalls: 0 }; });
afterEach(() => {
  delete g.Deno;
  for (const m of ["supabase.ts", "auth/requireStaff.ts", "auth/requireMember.ts", "voice/load.ts", "voice/voice.ts", "competitive/brief.ts", "anthropic.ts"]) vi.doUnmock(`../../functions/_shared/${m}`);
});

describe("a new post for a strategy-only client", () => {
  const body = { client_id: "c1", platform: "Instagram", topic: "Our spring opening", creative_type: "Single image" };

  it("is answered with the one sentence, and nothing is written or spent", async () => {
    const h = await load("generate-ad-hoc-post");
    const res = await ask(h, body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SENTENCE });
    expect(world.modelCalls).toBe(0);
  });

  it("is written as before for a client in Sprout, and for the same client once it has an account", async () => {
    const h = await load("generate-ad-hoc-post");
    expect((await ask(h, body)).status).toBe(409);
    world.strategyOnly = false;
    const res = await ask(h, body);
    expect(res.status).toBe(200);
    expect((await res.json()).post).toMatchObject({ platform: "Instagram" });
    expect(world.modelCalls).toBe(1);
  });
});

describe("a post's copy written again for a strategy-only client", () => {
  const body = { client_id: "c1", platform: "Instagram", current_copy: "Doors open Friday.", format: "Single image" };

  it("is answered with the one sentence, and nothing is written or spent", async () => {
    const h = await load("regenerate-post-copy");
    const res = await ask(h, body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SENTENCE });
    expect(world.modelCalls).toBe(0);
  });

  it("is written as before for a client in Sprout, and for the same client once it has an account", async () => {
    const h = await load("regenerate-post-copy");
    expect((await ask(h, body)).status).toBe(409);
    world.strategyOnly = false;
    const res = await ask(h, body);
    expect(res.status).toBe(200);
    expect((await res.json()).post.caption_angle).toBe("A caption");
    expect(world.modelCalls).toBe(1);
  });
});
