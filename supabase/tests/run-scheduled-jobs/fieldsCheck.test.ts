// @vitest-environment node
// The onboarding_fields_check harness: which fields Sprout returns for one
// client, read the way the social read asks, with nothing written.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { onboardingFieldsCheck } from "../../functions/run-scheduled-jobs/fieldsCheck";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const tables = () => ({
  clients: [{ id: "c1", name: "Olo", sprout_customer_id: "1676448" }],
  sprout_profiles: [
    { client_id: "c1", sprout_profile_id: 7, network_type: "linkedin_company", native_name: "olo", is_active: true },
    { client_id: "c1", sprout_profile_id: 9, network_type: "google_my_business", native_name: "olo-austin", is_active: true },
  ],
});

function sprout(answers: { followers?: (metrics: string[]) => { status: number; body: unknown } } = {}) {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: String(init.method), body });
    const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (url.endsWith("/metadata/customer")) return reply(200, { data: [
      { customer_profile_id: 7, network_type: "linkedin_company", name: "Olo", native_name: "olo" },
      { customer_profile_id: 9, network_type: "google_my_business", name: "Olo Austin", native_name: "olo-austin", network_metadata: { address: "12 Main Street, Austin, TX 78701" } },
    ] });
    if (url.endsWith("/analytics/posts")) return reply(200, { data: [
      { guid: "g1", network: "LINKEDIN_COMPANY", customer_profile_id: 7, from: { profile_picture: "https://media.licdn.example/p.png?sig=SECRET" } },
      { guid: "g2", network: "LINKEDIN_COMPANY", customer_profile_id: 7 },
    ] });
    if (url.endsWith("/analytics/profiles")) {
      const a = answers.followers?.(body.metrics) ?? { status: 200, body: { data: [{ dimensions: { customer_profile_id: 7 }, metrics: { "lifetime_snapshot.followers_by_country": { US: 70, GB: 30 } } }] } };
      return reply(a.status, a.body);
    }
    return reply(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("onboardingFieldsCheck", () => {
  it("reads Sprout's documented endpoints for one client and says which fields came back, writing nothing", async () => {
    const db = fakeDb(tables());
    const before = JSON.stringify(db.tables);
    const { calls, fetchImpl } = sprout();
    const out = await onboardingFieldsCheck(db, "c1", { fetchImpl, token: async () => "tok", now: NOW });
    expect(out).toMatchObject({
      client: { id: "c1", name: "Olo" }, writes: "none",
      found: { profile_picture: true, followers_by_country: true, followers_by_city: false, profile_address: true },
      posts: { ok: true, read: 2, by_network: { LINKEDIN_COMPANY: { posts: 2, with_profile_picture: 1, picture_hosts: ["media.licdn.example"] } } },
    });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect((out.profiles as Array<{ id: string; address_read: boolean }>).find((p) => p.id === "9")?.address_read).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.sproutsocial.com/v1/1676448/", "")}`)).toEqual(["GET metadata/customer", "POST analytics/posts", "POST analytics/profiles"]);
    expect(calls[1].body).toMatchObject({ fields: expect.arrayContaining(["from.profile_picture"]), filters: ["customer_profile_id.eq(7, 9)", "created_time.in(2026-10-04T00:00:00...2026-11-03T23:59:59)"] });
    expect(calls[2].body).toMatchObject({ metrics: ["lifetime_snapshot.followers_by_country", "lifetime_snapshot.followers_by_city"] });
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(db.rpcCalls).toEqual([]);
  });

  it("asks each follower metric alone when Sprout refuses both, and reports its answer with the token hidden", async () => {
    const { calls, fetchImpl } = sprout({
      followers: (metrics) => (metrics.length > 1 || metrics[0].endsWith("by_city")
        ? { status: 400, body: { error: `Unknown metric for Bearer tok` } }
        : { status: 200, body: { data: [{ dimensions: { customer_profile_id: 7 }, metrics: { [metrics[0]]: [{ key: "US", value: 9 }] } }] } }),
    });
    const out = await onboardingFieldsCheck(fakeDb(tables()), "c1", { fetchImpl, token: async () => "tok", now: NOW });
    expect(calls.filter((c) => c.url.endsWith("/analytics/profiles"))).toHaveLength(3);
    expect(out).toMatchObject({ found: { followers_by_country: true, followers_by_city: false } });
    const city = (out.followers as Record<string, { ok: boolean; status: number; detail: string; asked: string }>)["lifetime_snapshot.followers_by_city"];
    expect(city).toMatchObject({ ok: false, status: 400, asked: "alone" });
    expect(city.detail).not.toContain("tok");
  });

  it("says so for a client with no Sprout profiles, asking Sprout nothing", async () => {
    const { calls, fetchImpl } = sprout();
    expect(await onboardingFieldsCheck(fakeDb({ ...tables(), sprout_profiles: [] }), "c1", { fetchImpl, token: async () => "tok", now: NOW }))
      .toMatchObject({ profiles: [], note: "The client has no active Sprout profiles." });
    expect(calls).toEqual([]);
  });
});
