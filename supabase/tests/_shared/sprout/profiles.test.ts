// @vitest-environment node
// Sprout's profile and group lists, as its documented metadata endpoints
// answer (api.sproutsocial.com/docs: Customer Profiles lists each profile's
// "groups", an array of group ids; Customer Groups lists "group_id" and "name").
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCustomerGroups, listCustomerProfiles, SproutListError } from "../../../functions/_shared/sprout/profiles";

const g = globalThis as { Deno?: unknown };
beforeEach(() => { g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "id", SPROUT_CLIENT_SECRET: "secret" } as Record<string, string>)[k] } }; });
afterEach(() => { delete g.Deno; });

function sprout(answers: Record<string, { status?: number; body: unknown }>) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url.includes("identity.sproutsocial.com")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    const hit = Object.entries(answers).find(([path]) => url.endsWith(path));
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe("listCustomerProfiles", () => {
  it("keeps each profile's Sprout groups, as ids", async () => {
    const { fetchImpl } = sprout({ "/metadata/customer": { body: { data: [
      { customer_profile_id: 492, network_type: "twitter", name: "Sprout Social", native_name: "sproutsocial", native_id: "42793960", groups: [23598, 65245] },
      { customer_profile_id: 493, network_type: "facebook", name: "Solo", native_name: "solo" },
    ] } } });
    expect(await listCustomerProfiles("1676448", fetchImpl)).toEqual([
      { id: "492", name: "Sprout Social", native_name: "sproutsocial", network_type: "twitter", native_link: "", status: "active", groups: ["23598", "65245"] },
      { id: "493", name: "Solo", native_name: "solo", network_type: "facebook", native_link: "", status: "active", groups: [] },
    ]);
  });
  it("keeps the network metadata Sprout gives a local profile, such as its address", async () => {
    const { fetchImpl } = sprout({ "/metadata/customer": { body: { data: [
      { customer_profile_id: 501, network_type: "google_my_business", name: "Olo Austin", native_name: "olo-austin", network_metadata: { address: "12 Main Street, Austin, TX 78701" } },
    ] } } });
    expect((await listCustomerProfiles("1676448", fetchImpl))[0].network_metadata).toEqual({ address: "12 Main Street, Austin, TX 78701" });
  });
});

describe("listCustomerGroups", () => {
  it("lists each group's id and name from the groups endpoint", async () => {
    const { urls, fetchImpl } = sprout({ "/metadata/customer/groups": { body: { data: [{ group_id: 1234, name: "Sprout Social Team " }, { group_id: 99, name: "" }] } } });
    expect(await listCustomerGroups("1676448", fetchImpl)).toEqual([{ id: "1234", name: "Sprout Social Team" }, { id: "99", name: "" }]);
    expect(urls.at(-1)).toBe("https://api.sproutsocial.com/v1/1676448/metadata/customer/groups");
  });
  it("throws Sprout's refusal with its status, the token never in the detail", async () => {
    const { fetchImpl } = sprout({ "/metadata/customer/groups": { status: 403, body: { error: "Bearer tok is not allowed" } } });
    const err = await listCustomerGroups("1676448", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(SproutListError);
    expect(err).toMatchObject({ status: 403 });
    expect(err.detail).not.toMatch(/Bearer tok/);
  });
});
