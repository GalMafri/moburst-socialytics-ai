// P49: a split group's franchise part is taken for the national client by the
// group's shared label. A group that holds a national brand and a local franchise
// is two brands (brands.ts header), but matchBrand's name rule compares the client
// name with brand.group.name, which both parts share, so the franchise is
// "Already a client" of the national brand and Sync from Sprout never adds it.
import { describe, expect, it } from "vitest";
import { groupBrands, matchBrand, type KnownClient } from "../../../../supabase/functions/_shared/sprout/brands";
import type { SproutProfile } from "../../../../supabase/functions/_shared/lifecycle/accounts";

const p = (id: string, name: string, native: string, network: string): SproutProfile => ({ id, name, native_name: native, network_type: network, native_link: "", status: "active", groups: ["21"] });
const national: KnownClient = { id: "nat", name: "Harbor Wax", website_url: null, archived_at: null, demo_job_id: null, site_profiles: [] };

describe("P49 split group parts and the group's name", () => {
  it("does not match the franchise part to the national client by the shared group label", () => {
    const brands = groupBrands([
      p("7010", "Harbor Wax", "harborwax", "fb_instagram_account"), p("7011", "Harbor Wax", "harborwax", "facebook"),
      p("7020", "Harbor Wax (Lakeside)", "harborwax_lakeside", "fb_instagram_account"), p("7021", "Harbor Wax (Lakeside)", "harborwaxlakeside", "facebook"),
    ], [{ id: "21", name: "Harbor Wax" }]);
    const franchise = brands.find((b) => b.name === "Harbor Wax (Lakeside)")!;
    expect(franchise).toBeTruthy();
    const assigned = new Map([["7010", ["nat"]], ["7011", ["nat"]]]);
    expect(matchBrand(franchise, { clients: [national], assigned, removed: new Map() })).toBeNull();
  });
});
