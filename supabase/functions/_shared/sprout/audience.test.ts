// @vitest-environment node
// Where a client's followers are and what its local profiles give as an
// address, as Sprout's analytics/profiles and metadata endpoints answer.
// The follower-location shapes are read leniently (a map of place to count,
// or a list of rows): the onboarding_fields_check harness confirms which one
// Sprout sends before release.
import { describe, expect, it } from "vitest";
import { FOLLOWER_LOCATION_METRICS, followerCounts, followerLocations, listFollowerLocations, profileAddress } from "./audience";

describe("followerCounts", () => {
  it("reads a map of place to count, and a list of rows", () => {
    expect(followerCounts({ US: 120, GB: "30", XX: -1 })).toEqual([{ name: "US", count: 120 }, { name: "GB", count: 30 }]);
    expect(followerCounts([{ key: "Austin, TX", value: 12 }, { city: "Dallas, TX", count: 3 }, { name: "", value: 9 }])).toEqual([{ name: "Austin, TX", count: 12 }, { name: "Dallas, TX", count: 3 }]);
    expect(followerCounts(null)).toEqual([]);
  });
});

describe("followerLocations", () => {
  it("sums each profile's newest reading, and gives each country's share", () => {
    const rows = [
      { dimensions: { customer_profile_id: 7, "reporting_period.by(day)": "2026-11-01" }, metrics: { "lifetime_snapshot.followers_by_country": { US: 50, IL: 10 }, "lifetime_snapshot.followers_by_city": { "Austin, TX": 40 } } },
      { dimensions: { customer_profile_id: 7, "reporting_period.by(day)": "2026-10-31" }, metrics: { "lifetime_snapshot.followers_by_country": { US: 1 } } },
      { dimensions: { customer_profile_id: 8, "reporting_period.by(day)": "2026-11-01" }, metrics: { "lifetime_snapshot.followers_by_country": { "United States": 30, GB: 10 } } },
    ];
    expect(followerLocations(rows)).toEqual({
      countries: [{ country: "US", followers: 80, share: 0.8 }, { country: "IL", followers: 10, share: 0.1 }, { country: "GB", followers: 10, share: 0.1 }],
      cities: [{ name: "Austin, TX", count: 40 }],
    });
  });
});

describe("listFollowerLocations", () => {
  it("asks analytics/profiles for the two follower-location metrics over the days given", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      bodies.push({ url, ...JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ data: [{ dimensions: { customer_profile_id: 7 } }], paging: { current_page: 1, total_pages: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await listFollowerLocations(["7", "8"], { since: new Date("2026-10-30T00:00:00Z"), until: new Date("2026-11-02T00:00:00Z"), customerId: "1676448", fetchImpl, token: async () => "tok" });
    expect(rows).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      url: "https://api.sproutsocial.com/v1/1676448/analytics/profiles",
      filters: ["customer_profile_id.eq(7, 8)", "reporting_period.in(2026-10-30...2026-11-02)"], metrics: FOLLOWER_LOCATION_METRICS,
    });
  });
});

describe("profileAddress", () => {
  it("reads the address Sprout gives a local profile, as fields or as one line", () => {
    expect(profileAddress({ address: { street: "12 Main St", city: "Austin", state: "TX", postal_code: "78701", country: "US" } })).toEqual({ locality: "Austin", region: "TX", country: "US" });
    expect(profileAddress({ address: "12 Main Street, Austin, TX 78701, United States" })).toMatchObject({ region: "TX", country: "US" });
    expect(profileAddress({ address: "Somewhere nice" })).toBeNull();
    expect(profileAddress(null)).toBeNull();
  });
});
