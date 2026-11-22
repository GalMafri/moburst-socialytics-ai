// @vitest-environment node
// P37-01 (QA 22 Nov 2026): accessTokenFor refreshed only when the token has under 60s left
// (oauth.ts:30,144), but renderImageWithHiggsfield holds that one token for its
// whole budget (up to 115s from generate-post-image). A token with 70s left is
// used as is, expires during jobs_wait, and the McpError 401 that follows is
// never answered with one refresh and a retry: the paid render is lost and the
// error says the team account "needs linking again".
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { renderImageWithHiggsfield } from "../../../functions/_shared/higgsfield/renderImage";

const T0 = Date.parse("2026-11-20T10:00:00.000Z");
const MISSING = "Could not find the function public.higgsfield_tokens_read without parameters in the schema cache";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("an access token that expires during a render", () => {
  it("is refreshed once and the render finishes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const expiry = T0 + 70_000; // 70s left: more than the 60s skew, less than the render's budget
    const missing = () => { throw new Error(MISSING); };
    const db = fakeDb(
      { integration_tokens: [{ provider: "higgsfield", client_id: "cid", refresh_token: "refresh-1", access_token: "access-1", expires_at: new Date(expiry).toISOString() }] },
      { higgsfield_tokens_read: missing, higgsfield_tokens_save: missing },
    );
    let tokenCalls = 0;
    let waits = 0;
    const rpc = (id: unknown, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith("/oauth/token")) {
        tokenCalls++;
        return new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200 });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === "Bearer access-1" && Date.now() >= expiry) return new Response("expired", { status: 401 });
      const msg = JSON.parse(String(init.body));
      if (msg.id === undefined) return new Response(null, { status: 202 });
      if (msg.method === "initialize") return rpc(msg.id, {});
      const name = msg.params?.name;
      const content = (o: unknown) => rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(o) }] });
      if (name === "balance") return content({ credits: 500 });
      if (name === "generate_image_batch") return content({ jobs: [{ index: 0, job_id: "job-1", status: "queued" }] });
      if (name === "jobs_wait") {
        waits++;
        vi.setSystemTime(Date.now() + 15_000); // a long poll takes its 15 seconds
        const done = waits >= 6;
        return content({ jobs: [{ index: 0, job_id: "job-1", status: done ? "completed" : "in_progress", result_url: done ? "https://cdn.test/img.png" : undefined }], all_terminal: done });
      }
      return rpc(msg.id, {});
    }));
    const download = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;

    const rendered = renderImageWithHiggsfield({ supabase: db, prompt: "p", aspectRatio: "1:1", referenceUrls: [], budgetMs: 115_000, fetchImpl: download });
    await expect(rendered).resolves.toMatchObject({ imageMime: "image/png" });
    expect(tokenCalls).toBe(1);
  });
});
