import { describe, expect, it } from "vitest";
import { matchProfiles, platformsOf, profileKey, siteProfileLinks, type SproutProfile } from "./accounts";
import { normName, sameName, slugify, textHash } from "./names";

const p = (id: string, name: string, native: string, network: string, status = "active"): SproutProfile => ({ id, name, native_name: native, network_type: network, native_link: "", status });
// Sprout's names for the profiles, as listed on 19 Oct 2026.
const PROFILES = [
  p("7480884", "Bader Law", "BaderLawLLC", "facebook"), p("7481075", "Bader Law", "Bader Law", "youtube"),
  p("5719052", "Moburst - Growth Done Right", "moburst", "linkedin_company"), p("5489335", "Moburst | Mobile-First Digital Agency", "moburst.agency", "fb_instagram_account"),
  p("7727415", "Pay The Pyper ", "paythepyperapp", "facebook"), p("7673693", "Hyperzon by Moburst", "hyperzon", "facebook"),
  p("7638579", "My RxProfile", "MyRxProfile", "facebook", "disconnected"),
];
const MOBURST_SITE = `<footer><a href="https://www.linkedin.com/company/moburst/">in</a><a href="https:\\/\\/www.instagram.com\\/moburst.agency\\/">ig</a><a href="https://twitter.com/intent/tweet">share</a></footer>`;
const none = { assigned: new Map<string, string[]>(), removed: new Set<string>() };

describe("names", () => {
  it("compares company names exactly after normalizing", () => {
    expect(normName("Pay The Pyper ")).toBe("pay the pyper");
    expect(normName("Bader & Law, LLC")).toBe("bader and law");
    expect(sameName("Lega.bot", "LegaBot")).toBe(true);
    expect(sameName("Moburst - Growth Done Right", "Moburst")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
  it("slugs names the way the portal does, and hashes text stably", () => {
    expect(slugify("Pay The Pyper")).toBe("pay-the-pyper");
    expect(slugify("Éclair & Co")).toBe("eclair-and-co");
    expect(textHash("a")).toBe(textHash("a"));
    expect(textHash("a")).not.toBe(textHash("b"));
  });
});

describe("matchProfiles", () => {
  it("matches by Sprout's brand name", () => {
    const m = matchProfiles({ client: { id: "c", name: "Bader Law" }, profiles: PROFILES, siteLinks: [], ...none });
    expect(m.map((x) => [x.profile.id, x.by])).toEqual([["7480884", ["name"]], ["7481075", ["name"]]]);
    expect(matchProfiles({ client: { id: "c", name: "Pay The Pyper" }, profiles: PROFILES, siteLinks: [], ...none }).map((x) => x.profile.id)).toEqual(["7727415"]);
  });
  it("matches by the profiles the client's homepage links to, never by a share link", () => {
    const links = siteProfileLinks(MOBURST_SITE);
    expect(links).toEqual(["instagram:moburst.agency", "linkedin:moburst"]);
    const m = matchProfiles({ client: { id: "c", name: "Moburst" }, profiles: PROFILES, siteLinks: links, ...none });
    expect(m.map((x) => [x.profile.id, x.by])).toEqual([["5719052", ["site_link"]], ["5489335", ["site_link"]]]);
  });
  it("never takes a profile assigned to any client, one a person removed, or one Sprout no longer has active", () => {
    const assigned = new Map([["7480884", ["other-client"]]]);
    const removed = new Set(["7481075"]);
    expect(matchProfiles({ client: { id: "c", name: "Bader Law" }, profiles: PROFILES, siteLinks: [], assigned, removed })).toEqual([]);
    expect(matchProfiles({ client: { id: "c", name: "MyRxProfile" }, profiles: PROFILES, siteLinks: [profileKey("facebook", "MyRxProfile")], ...none })).toEqual([]);
  });
  it("names the platforms the assigned profiles cover", () => {
    expect(platformsOf(["fb_instagram_account", "facebook", "linkedin_company", "instagram"])).toEqual(["Instagram", "Facebook", "LinkedIn"]);
    expect(platformsOf([])).toEqual([]);
  });
});
