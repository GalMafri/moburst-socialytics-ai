import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicFetch, anthropicMessages } from "./anthropic";

afterEach(() => { vi.unstubAllGlobals(); });

describe("anthropicFetch", () => {
  it("sends to the API path with the caller's request, the body's half emoji dropped", async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = [];
    const base = async (url: string, init?: RequestInit) => { sent.push({ url, init }); return new Response("{}"); };
    const headers = { "x-api-key": "k", "anthropic-version": "2023-06-01", "anthropic-beta": "b" };
    await anthropicFetch("/v1/messages/batches", { method: "POST", headers, body: JSON.stringify({ text: "cut \ud83d" }) }, base);
    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages/batches");
    expect(sent[0].init?.headers).toBe(headers);
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({ text: "cut " });
  });
  it("is what anthropicMessages sends with, so every prompt is cleaned the same way", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    });
    const r = await anthropicMessages({ apiKey: "k", body: { model: "m", max_tokens: 10, messages: [{ role: "user", content: "post \ud83d" }] } });
    expect(r.text).toBe("ok");
    expect(JSON.parse(bodies[0]).messages[0].content).toBe("post ");
  });
});
