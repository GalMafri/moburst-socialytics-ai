import { describe, it, expect } from "vitest";
import { callFunction } from "./invoke";

describe("callFunction", () => {
  it("presents the operational secret, the acted-for user and the service role, and returns the parsed body", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const r = await callFunction("run-report", { client_id: "c" }, {
      url: "https://x.supabase.co", serviceKey: "svc", secret: "s3", actAs: "11111111-1111-4111-8111-111111111111",
      fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ report_id: "r" }), { status: 200 }); },
    });
    expect(seen!.url).toBe("https://x.supabase.co/functions/v1/run-report");
    const h = seen!.init.headers as Record<string, string>;
    expect(h["x-socialytics-secret"]).toBe("s3");
    expect(h["X-Cron-Secret"]).toBe("s3");
    expect(h["x-socialytics-user"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(h.Authorization).toBe("Bearer svc");
    expect(r).toEqual({ ok: true, status: 200, data: { report_id: "r" }, text: '{"report_id":"r"}' });
  });
  it("reports a refusal and an unreachable service without throwing", async () => {
    const refused = await callFunction("x", {}, { url: "u", serviceKey: "k", secret: null, actAs: null, fetchImpl: async () => new Response("nope", { status: 503 }) });
    expect(refused).toMatchObject({ ok: false, status: 503, data: null, text: "nope" });
    const down = await callFunction("x", {}, { url: "u", serviceKey: "k", secret: null, actAs: null, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
    expect(down).toMatchObject({ ok: false, status: 0, text: "ECONNRESET" });
  });
});
