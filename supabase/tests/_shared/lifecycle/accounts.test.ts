import { describe, expect, it } from "vitest";
import { linksTo, siteLinkSet } from "../../../functions/_shared/lifecycle/siteLinks";
import { matchProfiles, ONE_PER_NETWORK_RULE, OWN_RULE_SINCE, ownPerNetwork, parkedReason, parkingNetwork, platformsOf, profileKey, siteProfileLinks, type OwnRow, type SproutProfile } from "../../../functions/_shared/lifecycle/accounts";
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

// Copy sources, 17 Nov 2026: one own account per network, decided by exact
// facts in a fixed order, and never by a guess. Every brand below is
// invented: a national brand, "Harbor Wax", and a local franchise that shares
// its name.
describe("ownPerNetwork", () => {
  const r = (id: string, name: string, native: string, network: string, active = true, parked_at: string | null = null): OwnRow => ({ id, name, native_name: native, network_type: network, is_active: active, parked_at });
  const own = (rows: OwnRow[], over: Partial<Parameters<typeof ownPerNetwork>[0]> = {}) => ownPerNetwork({ clientName: "Harbor Wax", rows, publicProfiles: [], ...over });
  // When the rule parked an account: written on the account's own row.
  const T1 = "2026-11-18T09:00:00.000Z";
  const T2 = "2026-11-19T09:00:00.000Z";
  /** Assigned to the client before the rule began, and after it. */
  const BEFORE = "2026-09-01T10:00:00.000Z";
  const AFTER = "2026-12-01T10:00:00.000Z";
  const NOTHING = { keep: [] as string[], park: [] as string[], picks: [], open: [] };

  it("has a version, for the accounts step's key, and a moment it began", () => {
    expect(ONE_PER_NETWORK_RULE).toBe(1);
    expect(OWN_RULE_SINCE).toBe("2026-11-17T21:00:00.000Z");
    expect(Date.parse(BEFORE)).toBeLessThan(Date.parse(OWN_RULE_SINCE));
    expect(Date.parse(AFTER)).toBeGreaterThan(Date.parse(OWN_RULE_SINCE));
  });

  it("keeps a client with one account per network as it is, and records nothing", () => {
    const out = own([r("20", "Harbor Wax", "harborwax", "fb_instagram_account"), r("21", "Harbor Wax - Smooth Skin Studio", "harborwax", "facebook"), r("22", "Anything", "hw", "tiktok")]);
    expect(out).toEqual({ keep: ["20", "21", "22"], park: [], picks: [], open: [] });
  });

  it("name: keeps the account whose whole name is the client's name, whatever its age", () => {
    const out = own([r("10", "Harbor Wax (Lakeside)", "harborwax_lakeside", "fb_instagram_account"), r("20", "Harbor Wax", "harborwax", "instagram")]);
    expect(out.keep).toEqual(["20"]);
    expect(out.park).toEqual(["10"]);
    expect(out.picks).toEqual([{ network: "instagram", kept: "20", dropped: ["10"], by: "name", why: 'Kept "Harbor Wax" (harborwax) on Instagram: its name is the client\'s name. Parked: "Harbor Wax (Lakeside)" (harborwax_lakeside).' }]);
    expect(out.open).toEqual([]);
    // Case, punctuation and a trailing LLC are the same name (names.ts).
    expect(own([r("10", "Harbor Wax Lakeside", "a", "facebook"), r("20", "HARBOR WAX, LLC", "b", "facebook")]).picks[0]).toMatchObject({ kept: "20", by: "name" });
  });

  it("public_profile: keeps the account whose handle is the client's public profile on that platform, and never by a removed one", () => {
    const rows = [r("10", "Harbor Wax Lakeside", "harborwax_lakeside", "fb_instagram_account"), r("20", "Smooth Skin Studio by HW", "HW_Official", "fb_instagram_account")];
    const out = own(rows, { publicProfiles: [{ platform: "instagram", handle: "@hw_official", source: "website" }] });
    expect(out.picks[0]).toMatchObject({ kept: "20", dropped: ["10"], by: "public_profile" });
    expect(out.picks[0].why).toBe('Kept "Smooth Skin Studio by HW" (HW_Official) on Instagram: its handle is the client\'s public profile there. Parked: "Harbor Wax Lakeside" (harborwax_lakeside).');
    // A profile a person removed, or one on another platform, decides nothing: with no other fact, nothing is parked.
    expect(own(rows, { publicProfiles: [{ platform: "instagram", handle: "hw_official", source: "removed" }] })).toMatchObject({ park: [], picks: [] });
    expect(own(rows, { publicProfiles: [{ platform: "facebook", handle: "hw_official", source: "website" }] })).toMatchObject({ park: [], picks: [] });
  });

  it("handle: keeps the account whose handle is the one the client's settled account on another network has", () => {
    const out = own([
      r("10", "Lakeside Waxing Studio", "harborwax_lakeside", "fb_instagram_account"), r("20", "Smooth Skin Studio", "harbor.wax", "fb_instagram_account"),
      // The client's only TikTok account settles first, and its handle is the anchor.
      r("30", "HW", "@HarborWax", "tiktok"),
    ]);
    expect(out.keep.sort()).toEqual(["20", "30"]);
    expect(out.picks).toEqual([expect.objectContaining({ network: "instagram", kept: "20", dropped: ["10"], by: "handle" })]);
    expect(out.picks[0].why).toContain("its handle is the one the client's account on another network has");
    // A network no exact fact settled is no anchor: two open networks do not vouch for each other, and nothing is parked on either.
    const both = own([r("10", "Lakeside Waxing", "same", "facebook"), r("20", "Smooth Studio", "other", "facebook"), r("11", "Lakeside Waxing", "other", "tiktok"), r("21", "Smooth Studio", "same", "tiktok")]);
    expect(both.park).toEqual([]);
    expect(both.picks).toEqual([]);
    expect(both.open.map((o) => o.network)).toEqual(["facebook", "tiktok"]);
  });

  it("name_cut: keeps the one account whose name before its tagline is the client's name", () => {
    const out = own([r("10", "Lakeside Waxing by HW", "lakesidewaxing", "facebook"), r("20", "Harbor Wax ★ - Smooth Skin Studio", "hwstudio", "facebook")]);
    expect(out.picks[0]).toMatchObject({ kept: "20", dropped: ["10"], by: "name_cut" });
    expect(out.picks[0].why).toContain("its name before its tagline is the client's name");
    expect(own([r("10", "Harbor Wax (Lakeside)", "a", "facebook"), r("20", "Harbor Wax | Smooth Skin", "b", "facebook")]).picks[0]).toMatchObject({ kept: "20", by: "name_cut" });
    // A part in brackets is no tagline: it names another place, and decides nothing.
    expect(own([r("10", "Lakeside Waxing", "a", "facebook"), r("20", "Harbor Wax (Downtown)", "b", "facebook")])).toMatchObject({ park: [], picks: [] });
    // A real name with a dash in it is not the client's name with a tagline.
    expect(own([r("10", "Harbor - Wax Partners", "a", "facebook"), r("20", "Lakeside Waxing", "b", "facebook")], { clientName: "Harbor" }).picks[0]).toMatchObject({ kept: "10", by: "name_cut" });
    expect(own([r("10", "Harbor - Wax Partners", "a", "facebook"), r("20", "Lakeside Waxing", "b", "facebook")])).toMatchObject({ park: [], picks: [] });
  });

  // "The oldest" or "the smallest id" is a guess, and a wrong guess switches off an account a client publishes to.
  it("parks nothing when no exact fact decides: every account stays in use and the choice is recorded as open", () => {
    const out = own([r("100", "Studio One", "one", "youtube"), r("99", "Studio Two", "two", "youtube"), r("1000", "Studio Three", "three", "youtube")]);
    expect(out.keep).toEqual(["99", "100", "1000"]);
    expect(out.park).toEqual([]);
    expect(out.picks).toEqual([]);
    expect(out.open).toEqual([{ network: "youtube", accounts: ["99", "100", "1000"], why: '"Studio Two" (two), "Studio One" (one), "Studio Three" (three) stay in use on YouTube: no exact fact says which one is the brand\'s own.' }]);
    expect(own([r("10", "Lakeside Waxing", "a", "facebook"), r("20", "Smooth Studio", "b", "facebook")]).open[0].why).toBe('"Lakeside Waxing" (a) and "Smooth Studio" (b) stay in use on Facebook: no exact fact says which one is the brand\'s own.');
  });

  it("parks nothing when a fact narrows the accounts to two and no other fact tells those two apart", () => {
    // Two accounts carry the client's name: neither is parked, and neither is the third, which no fact chose against one account.
    const byName = own([r("10", "Another Studio", "another", "facebook"), r("30", "Harbor Wax", "hw_a", "facebook"), r("40", "Harbor Wax", "hw_b", "facebook")]);
    expect(byName).toMatchObject({ keep: ["10", "30", "40"], park: [], picks: [] });
    expect(byName.open).toHaveLength(1);
    // Two names shorten to the client's name: the handle of the only TikTok account tells them apart, and then both others are parked.
    const cut = own([r("10", "Harbor Wax | Lakeside", "hw_lakeside", "facebook"), r("20", "Harbor Wax - Studio", "harborwax", "facebook"), r("5", "Unrelated", "unrelated", "facebook"), r("30", "x", "harborwax", "tiktok")]);
    expect(cut.picks[0]).toMatchObject({ kept: "20", dropped: ["5", "10"], by: "handle" });
    // With no anchor, nothing tells those two apart: nothing is parked.
    const noAnchor = own([r("10", "Harbor Wax | Lakeside", "hw_lakeside", "facebook"), r("20", "Harbor Wax - Studio", "harborwax", "facebook"), r("5", "Unrelated", "unrelated", "facebook")]);
    expect(noAnchor).toMatchObject({ park: [], picks: [] });
  });

  // A brand has a company page and its people's profiles together.
  it("leaves personal LinkedIn profiles out altogether: beside a company page, and beside each other", () => {
    expect(parkingNetwork("linkedin")).toBeNull();
    expect(parkingNetwork("linkedin_company")).toBe("linkedin");
    expect(parkingNetwork("fb_instagram_account")).toBe("instagram");
    expect(parkingNetwork("instagram")).toBe("instagram");
    expect(parkingNetwork("")).toBeNull();
    expect(own([r("5", "Dana Reed", "dana-reed", "linkedin"), r("50", "Harbor Wax", "harbor-wax", "linkedin_company")])).toEqual({ ...NOTHING, keep: ["50"] });
    expect(own([r("5", "Harbor Wax", "harbor-wax-person", "linkedin"), r("6", "Dana Reed", "dana-reed", "linkedin")])).toEqual(NOTHING);
    // Two company pages are two accounts on one network.
    expect(own([r("50", "Harbor Wax", "harbor-wax", "linkedin_company"), r("51", "Harbor Wax (Lakeside)", "hw-lakeside", "linkedin_company"), r("5", "Dana Reed", "dana-reed", "linkedin")]).picks).toEqual([expect.objectContaining({ network: "linkedin", kept: "50", dropped: ["51"], by: "name" })]);
    // An Instagram account is one network whichever way Sprout types it.
    expect(own([r("1", "Harbor Wax", "a", "instagram"), r("2", "Other", "b", "fb_instagram_account")]).picks[0]).toMatchObject({ network: "instagram", kept: "1" });
  });

  // From the day the rule began, nothing but a person adds a second account on a network.
  it("never parks an account a person added after the rule began, and never parks another because of it", () => {
    // The newcomer carries the client's exact name; the account the client had all along does not. Neither is parked.
    const out = own([{ ...r("10", "Harbor Wax Official Page", "hw_page", "facebook"), assigned_at: BEFORE }, { ...r("90", "Harbor Wax", "harborwax", "facebook"), assigned_at: AFTER }]);
    expect(out.park).toEqual([]);
    expect(out.picks).toEqual([]);
    expect(out.keep.sort()).toEqual(["10", "90"]);
    expect(out.open).toEqual([{ network: "facebook", accounts: ["10", "90"], why: '"Harbor Wax Official Page" (hw_page) and "Harbor Wax" (harborwax) stay in use on Facebook: a person added one of them after the client was set up.' }]);
    // Two accounts from before the rule are still sorted out; the one added later stays beside the one that is kept.
    const three = own([{ ...r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook"), assigned_at: BEFORE }, { ...r("20", "Harbor Wax", "harborwax", "facebook"), assigned_at: BEFORE }, { ...r("90", "Harbor Wax Outlet", "hw_outlet", "facebook"), assigned_at: AFTER }]);
    expect(three.park).toEqual(["10"]);
    expect(three.keep.sort()).toEqual(["20", "90"]);
    expect(three.open.map((o) => o.accounts)).toEqual([["20", "90"]]);
    // An account with no assignment time is older than the column's use: the client's all along.
    expect(own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook"), r("20", "Harbor Wax", "harborwax", "facebook")]).park).toEqual(["10"]);
    // Two accounts both added later are both a person's: nothing is parked.
    expect(own([{ ...r("90", "Harbor Wax", "a", "facebook"), assigned_at: AFTER }, { ...r("91", "Harbor Wax (Lakeside)", "b", "facebook"), assigned_at: AFTER }])).toMatchObject({ park: [], picks: [] });
  });

  it("brings a parked account back when the kept one is gone, and says so", () => {
    // The kept account was switched off by a person (inactive, never parked by the rule): the parked one is the only candidate.
    const out = own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", false, T1), r("20", "Harbor Wax", "harborwax", "facebook", false)]);
    expect(out.keep).toEqual(["10"]);
    expect(out.park).toEqual([]);
    expect(out.picks).toEqual([{ network: "facebook", kept: "10", dropped: [], by: "only", why: 'Kept "Harbor Wax (Lakeside)" (hw_lakeside) on Facebook: it is the client\'s only account there now.' }]);
    // The same when the kept account's row no longer exists.
    expect(own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", false, T1)]).keep).toEqual(["10"]);
    // Not when a person has since added another account there: that one is in use, and the parked one stays parked.
    const taken = own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", false, T1), { ...r("90", "Harbor Wax New", "hw_new", "facebook"), assigned_at: AFTER }]);
    expect(taken).toEqual({ keep: ["90"], park: [], picks: [], open: [] });
  });

  it("never brings back an account a person switched off or removed: only a row the rule parked is a candidate", () => {
    const out = own([r("10", "Harbor Wax", "harborwax", "facebook", false), r("20", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook")]);
    expect(out).toEqual({ ...NOTHING, keep: ["20"] });
    expect(own([r("10", "Harbor Wax", "harborwax", "facebook", false)])).toEqual(NOTHING);
    // A parked row a person then removed from the client stays out, though its record is still on it.
    expect(own([{ ...r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", false, T1), removed: true }])).toEqual(NOTHING);
  });

  it("keeps a parked account at rest: the same rows give the same answer on every run, with nothing else to remember", () => {
    const rows = [r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", false, T1), r("20", "Harbor Wax", "harborwax", "facebook")];
    const out = own(rows);
    expect(out.keep).toEqual(["20"]);
    expect(out.park).toEqual(["10"]);
    expect(out.picks[0]).toMatchObject({ kept: "20", dropped: ["10"], by: "name" });
    expect(own(rows)).toEqual(out);
    // Facts that no longer decide leave a parked account parked and the other in use: open changes nothing.
    const undecided = own([r("10", "Lakeside Waxing", "a", "facebook", false, T1), r("20", "Smooth Studio", "b", "facebook")]);
    expect(undecided).toEqual({ keep: ["20"], park: [], picks: [], open: [] });
  });

  it("person: a parked account a person switched back on wins, and goes on winning while its row says so", () => {
    // The rule had parked the Lakeside account; a person added it back, so it is active with its record still on it.
    const switched = own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", true, T1), r("20", "Harbor Wax", "harborwax", "facebook", true)]);
    expect(switched.picks[0]).toMatchObject({ kept: "10", dropped: ["20"], by: "person" });
    expect(switched.picks[0].why).toBe('Kept "Harbor Wax (Lakeside)" (hw_lakeside) on Facebook: a person switched it back on. Parked: "Harbor Wax" (harborwax).');
    // The next run: the other account is the parked one now, and the person's choice stands though its name says otherwise.
    const next = own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", true, T1), r("20", "Harbor Wax", "harborwax", "facebook", false, T2)]);
    expect(next.picks[0]).toMatchObject({ kept: "10", dropped: ["20"], by: "person" });
    // A person adding the other one back is the newer choice: of two switched back on, the one parked last was switched on last.
    const back = own([r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", true, T1), r("20", "Harbor Wax", "harborwax", "facebook", true, T2)]);
    expect(back.picks[0]).toMatchObject({ kept: "20", dropped: ["10"], by: "person" });
    // A choice whose account is switched off again decides nothing: the account the rule parked is the only candidate left.
    const gone = own([{ ...r("10", "Harbor Wax (Lakeside)", "hw_lakeside", "facebook", false, T1), removed: true }, r("20", "Harbor Wax", "harborwax", "facebook", false, T2)]);
    expect(gone.picks[0]).toMatchObject({ kept: "20", by: "only" });
  });

  it("writes on a parked row, in plain words, which account is the brand's own", () => {
    expect(parkedReason("facebook", { name: "Harbor Wax" })).toBe('The brand\'s own Facebook account is "Harbor Wax".');
    expect(parkedReason("twitter", { name: "Harbor Wax" })).toBe('The brand\'s own X account is "Harbor Wax".');
  });
});
