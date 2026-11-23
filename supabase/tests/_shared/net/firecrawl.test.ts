// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWeb } from "../../../functions/_shared/net/firecrawl";
import { costCtx } from "../../../functions/_shared/paid/index";
import { useTestMeter } from "../../paid/testMeter";

const cost = costCtx({ clientId: "c1", feature: "lifecycle.website", actor: "schedule" });
afterEach(() => { vi.unstubAllGlobals(); useTestMeter(); });

describe("searchWeb", () => {
  it("asks Firecrawl's search for ten results and answers their addresses in order", async () => {
    let body: Record<string, unknown> = {};
    let url = "";
    useTestMeter(async (u: string, init?: RequestInit) => {
      url = u;
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: [{ url: "https://olo.com" }, { title: "no url" }, { url: "https://olo.co" }] }), { status: 200 });
    });
    expect(await searchWeb(cost, "Olo\nInc")).toEqual(["https://olo.com", "https://olo.co"]);
    expect(url).toBe("https://api.firecrawl.dev/v1/search");
    expect(body).toEqual({ query: "Olo Inc", limit: 10 });
  });
  it("answers none without a key or when Firecrawl does not answer", async () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    useTestMeter(async () => { throw new Error("never sent"); }, { auth: true });
    expect(await searchWeb(cost, "Olo")).toEqual([]);
    useTestMeter(async () => new Response("no", { status: 502 }));
    expect(await searchWeb(cost, "Olo")).toEqual([]);
  });
});
