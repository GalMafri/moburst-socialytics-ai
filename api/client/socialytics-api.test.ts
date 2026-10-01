import { describe, it, expect } from "vitest";
import { ApiClientError, SocialyticsApi } from "./socialytics-api";

function api(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new SocialyticsApi({ baseUrl: "https://x.supabase.co/functions/v1/api/", key: "soc_k", fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch });
  return { client, calls };
}

describe("SocialyticsApi", () => {
  it("sends the key, builds query strings and unwraps envelopes", async () => {
    const { client, calls } = api((url) => (url.includes("/v1/reports?") ? { status: 200, body: { data: [{ id: "r1" }], next_cursor: null } } : { status: 200, body: { data: { id: "c1" } } }));
    const page = await client.reports.list({ client_id: "c1", status: "completed", limit: 5, cursor: undefined });
    expect(page.data[0].id).toBe("r1");
    expect(calls[0].url).toBe("https://x.supabase.co/functions/v1/api/v1/reports?client_id=c1&status=completed&limit=5");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer soc_k");
    expect((await client.clients.get("c1")).id).toBe("c1");
    await client.clients.analytics("c1", { start: "2026-09-01", end: "2026-09-30" });
    expect(calls[2].url).toContain("/v1/clients/c1/analytics?start=2026-09-01&end=2026-09-30");
  });
  it("turns an error envelope into ApiClientError with its code and details", async () => {
    const { client } = api(() => ({ status: 422, body: { error: { code: "unprocessable", message: "No Sprout profiles are assigned to this client.", details: { reason: "no_sprout_profiles" } } } }));
    const err = await client.clients.analytics("c1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 422, code: "unprocessable", details: { reason: "no_sprout_profiles" } });
  });
  it("creates a demo job and waits for a terminal status", async () => {
    let polls = 0;
    const { client, calls } = api((url, init) => (init?.method === "POST" ? { status: 202, body: { data: { id: "j1", status: "queued" } } } : { status: 200, body: { data: { id: "j1", status: ++polls < 3 ? "running" : "partial" } } }));
    const job = await client.demoJobs.create({ client_name: "Brooklinen", website: "brooklinen.com" });
    expect(job.id).toBe("j1");
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ client_name: "Brooklinen", website: "brooklinen.com" });
    const done = await client.demoJobs.wait("j1", { pollMs: 1, sleep: async () => {} });
    expect(done.status).toBe("partial");
    expect(polls).toBe(3);
  });
});
