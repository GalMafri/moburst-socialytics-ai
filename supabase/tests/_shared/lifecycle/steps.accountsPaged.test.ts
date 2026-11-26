// @vitest-environment node
// The accounts step reads the Sprout profile rows it needs, never the whole
// table in one read, which PostgREST caps at 1,000 rows (QA 22 Nov 2026,
// P39-05: past 1,000 rows, the client's own active account could be left out,
// and a second account on its network added).
import { afterEach, describe, expect, it } from "vitest";
import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../support/lifecycleFakeDb";
import type { StepRow } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); });

const client = {
  id: "c1", name: "Northwind Law", website_url: null, field_sources: {}, timezone: "UTC", geo: "US", language: "en",
  brand_identity: null, logo_url: null, brief_text: "", brief_file_id: "", strategy_doc_file_path: null, content_pillars: [], social_keywords: [],
  primary_platforms: [], company_slug: null, hub_company_name: null, competitor_seed_notes: "",
  harvested_design_references: [], design_references: null, sprout_customer_id: null, location: null, voice_built_at: null,
};

/** A database whose reads of sprout_profiles answer at most 1,000 rows, as PostgREST does. */
function capped(db: ReturnType<typeof fakeDb>) {
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const q = from(table);
    if (table !== "sprout_profiles") return q;
    const then = q.then.bind(q);
    q.then = (res: (r: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) =>
      then((r: { data: unknown; error: unknown }) => res(Array.isArray(r.data) ? { ...r, data: r.data.slice(0, 1000) } : r), rej);
    return q;
  };
  return db;
}

describe("accounts with more than 1,000 Sprout profile rows", () => {
  it("still sees the client's own account on a network and adds no second one", async () => {
    deps.now = () => new Date("2026-11-22T10:00:00.000Z");
    // A profile on Instagram this client's name matches, beside the client's own Instagram account.
    deps.listCustomerProfiles = async () => [
      { id: "900", name: "NWL Archive", native_name: "nwl_archive", network_type: "fb_instagram_account", native_link: "", status: "active" },
      { id: "901", name: "Northwind Law", native_name: "northwind.law", network_type: "fb_instagram_account", native_link: "", status: "active" },
    ];
    deps.listCustomerGroups = async () => [];
    const others = Array.from({ length: 1200 }, (_, i) => ({ client_id: `other-${i}`, sprout_profile_id: 10_000 + i, network_type: "facebook", is_active: true }));
    const db = capped(fakeDb({
      clients: [client],
      sprout_profiles: [...others, { client_id: "c1", sprout_profile_id: 900, network_type: "fb_instagram_account", profile_name: "Northwind Law", native_name: "northwindlaw", is_active: true }],
      sprout_profile_removals: [], client_public_profiles: [],
    }, { lifecycle_write_client: writeClientRpc }));
    await STEPS.accounts.run(db, client, { force: false, previous: null, rows: new Map<string, StepRow>() });
    const mine = db.tables.sprout_profiles.filter((r) => r.client_id === "c1");
    expect(mine.map((r) => r.sprout_profile_id)).toEqual([900]);
  });
});
