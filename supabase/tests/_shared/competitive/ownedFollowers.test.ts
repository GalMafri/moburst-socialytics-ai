// @vitest-environment node
// The client's followers per network from Sprout's profile analytics, which the
// content strategy shows beside each platform it measures: each assigned
// profile's newest reading, added up across the network, and none for a network
// with a profile that has no reading.
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectOwnedFollowers, newestFollowers } from "../../../functions/_shared/competitive/ownedSource";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const profiles = [
  { sprout_profile_id: 1, network_type: "instagram", profile_name: "Brand" },
  { sprout_profile_id: 2, network_type: "instagram", profile_name: "Brand Two" },
  { sprout_profile_id: 3, network_type: "linkedin_company", profile_name: "Brand LinkedIn" },
];
const row = (id: number, date: string, followers: number | null) => ({ dimensions: { customer_profile_id: id, "reporting_period.by(day)": date }, metrics: { "lifetime_snapshot.followers_count": followers } });

describe("the newest follower reading", () => {
  it("takes each profile's newest reading, adds a network's profiles, and gives none when one has no reading", () => {
    const got = newestFollowers(profiles, [row(1, "2026-11-01", 1000), row(1, "2026-11-03", 1100), row(2, "2026-11-02", 400), row(3, "2026-11-02", null)]);
    expect(got).toEqual({ instagram: 1500, linkedin: null });
    // A profile with only older readings still counts at its newest; one with none leaves the network without a total.
    expect(newestFollowers(profiles, [row(1, "2026-11-01", 1000)])).toEqual({ instagram: null, linkedin: null });
    expect(newestFollowers(profiles.slice(0, 1), [])).toEqual({ instagram: null });
  });
});

describe("reading the client's followers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks Sprout once for the profiles' followers over two weeks, and returns the newest per network", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "x" } });
    const asked: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
      if (url.includes("identity.sproutsocial.com")) return new Response(JSON.stringify({ access_token: "t" }));
      asked.push({ url, body: JSON.parse(init.body ?? "{}") });
      return new Response(JSON.stringify({ data: [row(1, "2026-11-09", 2000)], paging: { current_page: 1, total_pages: 1 } }));
    });
    const db = fakeDb({ sprout_profiles: [{ client_id: "c1", sprout_profile_id: 1, network_type: "instagram", profile_name: "Brand", is_active: true }] });
    const got = await collectOwnedFollowers(db, { id: "c1", sprout_customer_id: "9" }, new Date("2026-11-10T10:00:00Z"));
    expect(got).toEqual({ instagram: 2000 });
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toContain("/analytics/profiles");
    expect(asked[0].body.filters).toContain("reporting_period.in(2026-10-27...2026-11-10)");
  });

  it("is empty for a client Sprout does not cover, without calling Sprout", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await collectOwnedFollowers(fakeDb({ sprout_profiles: [] }), { id: "c1" })).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
