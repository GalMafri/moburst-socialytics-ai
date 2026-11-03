// @vitest-environment node
import { describe, expect, it } from "vitest";
import { searchWeb } from "./firecrawl";

describe("searchWeb", () => {
  it("asks Firecrawl's search for ten results and answers their addresses in order", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ success: true, data: [{ url: "https://olo.com" }, { title: "no url" }, { url: "https://olo.co" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await searchWeb("Olo\nInc", { apiKey: "fc", fetchImpl })).toEqual(["https://olo.com", "https://olo.co"]);
    expect(body).toEqual({ query: "Olo Inc", limit: 10 });
  });
  it("answers none without a key or when Firecrawl does not answer", async () => {
    expect(await searchWeb("Olo", { apiKey: "" })).toEqual([]);
    const down = (async () => new Response("no", { status: 502 })) as unknown as typeof fetch;
    expect(await searchWeb("Olo", { apiKey: "fc", fetchImpl: down })).toEqual([]);
  });
});
