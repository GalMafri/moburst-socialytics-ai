import { describe, expect, it } from "vitest";
import { linksTo, siteLinkSet } from "../../../functions/_shared/lifecycle/siteLinks";
import { matchProfiles, platformsOf, profileKey, siteProfileLinks, type SproutProfile } from "../../../functions/_shared/lifecycle/accounts";
import { normName, sameName, slugify, textHash } from "../../../functions/_shared/lifecycle/names";

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

describe("a homepage's profile links keep each handle's own case", () => {
  const ID = "UCtyXEjQ6RqDX7mNn1Zb3k9A";
  const SITE = `<a href="https://www.youtube.com/channel/${ID}">YouTube</a><a href="https://www.facebook.com/BaderLawLLC">Facebook</a>`;
  it("lists each link once, as written, so a channel id stays a real id", () => {
    const links = siteProfileLinks(SITE);
    expect(links).toEqual([`facebook:BaderLawLLC`, `youtube:${ID}`]);
  });
  it("lists a handle once however many ways the page writes it, in the case that has capitals", () => {
    const links = siteProfileLinks(`<a href="https://www.facebook.com/baderlawllc">a</a><a href="https://www.facebook.com/BaderLawLLC">b</a><a href="https://www.facebook.com/baderlawllc">c</a>`);
    expect(links).toEqual(["facebook:BaderLawLLC"]);
  });
  it("still matches a Sprout profile whatever the case of the link or of its native name", () => {
    const links = siteProfileLinks(SITE);
    const m = matchProfiles({ client: { id: "c", name: "Someone" }, profiles: [p("1", "BL", "baderlawllc", "facebook"), p("2", "BL2", "BaderLawLLC", "facebook")], siteLinks: links, ...none });
    expect(m.map((x) => x.profile.id)).toEqual(["1", "2"]);
    const cased = matchProfiles({ client: { id: "c", name: "Someone" }, profiles: [p("1", "BL", "baderlawllc", "facebook")], siteLinks: ["facebook:BaderLawLLC"], ...none });
    expect(cased.map((x) => x.profile.id)).toEqual(["1"]);
  });
});

describe("comparing site links", () => {
  it("is case-insensitive on both sides, and tolerates no list", () => {
    const set = siteLinkSet(["facebook:BaderLawLLC", "instagram:moburst.agency"]);
    expect(linksTo(set, "facebook:baderlawllc")).toBe(true);
    expect(linksTo(set, "Instagram:Moburst.Agency")).toBe(true);
    expect(linksTo(set, "facebook:other")).toBe(false);
    expect(siteLinkSet(undefined).size).toBe(0);
  });
});
