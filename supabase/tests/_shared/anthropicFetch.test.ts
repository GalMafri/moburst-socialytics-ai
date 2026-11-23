import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicFetch, anthropicMessages } from "../../functions/_shared/anthropic";
import { costCtx } from "../../functions/_shared/paid/index";
import { useTestMeter } from "../paid/testMeter";

afterEach(() => { vi.unstubAllGlobals(); useTestMeter(); });

const cost = costCtx({ clientId: "client-1", feature: "test.anthropic", actor: "system", executionId: "run-1" });

describe("anthropicFetch", () => {
  it("sends to the API path with the caller's request, the body's half emoji dropped", async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = [];
    useTestMeter(async (url, init) => { sent.push({ url, init }); return new Response("{}"); });
    const headers = { "anthropic-beta": "b" };
    await anthropicFetch(cost, "/v1/messages/batches", { method: "POST", headers, body: JSON.stringify({ text: "cut \ud83d" }) });
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
    const r = await anthropicMessages({ cost, body: { model: "m", max_tokens: 10, messages: [{ role: "user", content: "post \ud83d" }] } });
    expect(r.text).toBe("ok");
    expect(JSON.parse(bodies[0]).messages[0].content).toBe("post ");
  });
  it("records what the call used against the client and feature it was made for", async () => {
    const rows = useTestMeter(async () => new Response(JSON.stringify({ id: "msg_1", model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { headers: { "content-type": "application/json" } }));
    await anthropicMessages({ cost, body: { model: "claude-opus-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: "client-1", feature: "test.anthropic", execution_id: "run-1", provider: "anthropic", resource: "claude-opus-5-5", quantities: { input_tokens: 10, output_tokens: 5 } });
  });
});
