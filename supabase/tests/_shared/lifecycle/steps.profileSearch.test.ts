// @vitest-environment node
// A client whose homepage links no profiles (EPIC Studios) or that has no
// website (Faranak), and that RivalIQ and the team gave none, has its own
// public profiles searched for on the web, at most once in 30 days (Lital,
// 26 Nov 2026: "didn't we say we will be able to scrape these?").
import { afterEach, describe, expect, it } from "vitest";
import { deps, PROFILE_SEARCH_DAYS, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { desiredProfiles } from "../../../functions/_shared/strategy/profiles";
import { extractIndexedProfiles } from "../../../functions/_shared/competitive/extractSocialHandles";
import { fakeDb, writeClientRpc } from "../../support/lifecycleFakeDb";
import type { StepRow } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); });

const NOW = new Date("2026-11-26T16:00:00.000Z");
const client = {
  id: "c1", name: "Faranak", website_url: null, field_sources: {}, timezone: "UTC", geo: "US", language: "en",
  brand_identity: null, logo_url: null, brief_text: "", brief_file_id: "", strategy_doc_file_path: null, content_pillars: [], social_keywords: [],
  primary_platforms: [], company_slug: null, hub_company_name: null, competitor_seed_notes: "",
  harvested_design_references: [], design_references: null, sprout_customer_id: null, location: null, voice_built_at: null,
};

function setup(publicRows: Array<Record<string, unknown>> = []) {
  deps.now = () => NOW;
  deps.listCustomerProfiles = async () => [];
  deps.listCustomerGroups = async () => [];
  const searches: Array<{ feature: string; name: string; website: string | null }> = [];
  deps.findBrandProfiles = async (cost, brand) => {
    searches.push({ feature: cost.feature, ...brand });
    return { ok: true, handles: [{ platform: "instagram", handle: "faranak", profile_url: "https://www.instagram.com/faranak/", confidence: 0.8 }] as never };
  };
  const db = fakeDb({ clients: [client], sprout_profiles: [], sprout_profile_removals: [], client_public_profiles: publicRows }, { lifecycle_write_client: writeClientRpc });
  return { db, searches };
}

const accountsRow = (result: Record<string, unknown>): Map<string, StepRow> =>
  new Map([["accounts", { step: "accounts", status: "done", result } as unknown as StepRow]]);

describe("the client's own profiles, searched for when nothing else gives one", () => {
  it("searches by name when there is no website, and keeps what it found, marked as found by a search", async () => {
    const { db, searches } = setup();
    const out = await STEPS.accounts.run(db, client, { force: false, previous: null, rows: new Map() });
    expect(searches).toEqual([{ feature: "lifecycle.public_profiles", name: "Faranak", website: null }]);
    expect(db.tables.client_public_profiles.map((r) => [r.platform, r.handle, r.source])).toEqual([["instagram", "faranak", "search"]]);
    expect((out as { result: { profile_search: unknown } }).result.profile_search).toEqual({ searched_at: NOW.toISOString(), handles: [{ platform: "instagram", handle: "faranak", profile_url: "https://www.instagram.com/faranak/" }] });
  });

  it("does not search again within 30 days, and keeps the last search's record", async () => {
    const { db, searches } = setup();
    const last = { searched_at: new Date(NOW.getTime() - (PROFILE_SEARCH_DAYS - 1) * 86_400_000).toISOString(), handles: [] };
    const out = await STEPS.accounts.run(db, client, { force: false, previous: null, rows: accountsRow({ profile_search: last }) });
    expect(searches).toHaveLength(0);
    expect((out as { result: { profile_search: unknown } }).result.profile_search).toEqual(last);
  });

  it("searches again once 30 days have passed", async () => {
    const { db, searches } = setup();
    const last = { searched_at: new Date(NOW.getTime() - (PROFILE_SEARCH_DAYS + 1) * 86_400_000).toISOString(), handles: [] };
    await STEPS.accounts.run(db, client, { force: false, previous: null, rows: accountsRow({ profile_search: last }) });
    expect(searches).toHaveLength(1);
  });

  it("never searches when the team added a profile", async () => {
    const { db, searches } = setup([{ client_id: "c1", platform: "linkedin", handle: "faranak-co", url: null, source: "person" }]);
    await STEPS.accounts.run(db, client, { force: false, previous: null, rows: new Map() });
    expect(searches).toHaveLength(0);
  });

  it("leaves no record when the search did not answer, so it runs again next time", async () => {
    const { db } = setup();
    deps.findBrandProfiles = async () => ({ ok: false, handles: [] });
    const out = await STEPS.accounts.run(db, client, { force: false, previous: null, rows: new Map() });
    expect((out as { result: Record<string, unknown> }).result.profile_search).toBeUndefined();
  });

  it("ranks a searched profile after RivalIQ's record and the homepage's link on the same platform", () => {
    const got = desiredProfiles({
      rows: [], brand: "EPIC Studios", rivaliq: [{ platform: "tiktok", handle: "epic_tt" }], site: ["instagram:epicstudios.ai"],
      searched: [{ platform: "instagram", handle: "other" }, { platform: "tiktok", handle: "other" }, { platform: "linkedin", handle: "epic-studios" }],
    });
    expect(got.map((r) => [r.platform, r.handle, r.source])).toEqual([["instagram", "epicstudios.ai", "website"], ["tiktok", "epic_tt", "rivaliq"], ["linkedin", "epic-studios", "search"]]);
  });

  it("takes a profile titled with the brand's dotted initials, and never a lookalike", () => {
    const got = extractIndexedProfiles([
      { url: "https://www.instagram.com/epicstudios.app/", title: "E.P.I.C. Studios (@epicstudios.app) • Instagram" },
      { url: "https://www.linkedin.com/company/epic-entertainment-group", title: "Epic Entertainment Group | LinkedIn" },
    ], "EPIC Studios");
    expect(got.map((h) => [h.platform, h.handle])).toEqual([["instagram", "epicstudios.app"]]);
    // A one-word name needs the exact account name: a person called Faranak is not the brand.
    expect(extractIndexedProfiles([{ url: "https://www.instagram.com/__.faranak.__fa/", title: "Faranak Fa (@__.faranak.__fa)" }], "Faranak")).toEqual([]);
  });
});
