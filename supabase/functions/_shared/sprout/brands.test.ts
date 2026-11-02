import { describe, expect, it } from "vitest";
import { blockedFromCreation, brandName, clientWithSite, declineFor, declineReason, groupBrands, groupConflict, isBrandAccount, joinBrands, matchBrand, matchOutcome, profileBrandName, type ClientIndex, type KnownClient } from "./brands";
import type { SproutProfile } from "../lifecycle/accounts";

const p = (id: string, name: string, native: string, network: string, status = "active", groups: string[] = []): SproutProfile => ({ id, name, native_name: native, network_type: network, native_link: "", status, groups });
const inGroup = (groups: string[], profile: SproutProfile): SproutProfile => ({ ...profile, groups });
const client = (over: Partial<KnownClient> & { id: string; name: string }): KnownClient => ({ website_url: null, archived_at: null, demo_job_id: null, site_profiles: [], ...over });
const index = (clients: KnownClient[], over: Partial<ClientIndex> = {}): ClientIndex => ({ clients, assigned: new Map(), removed: new Map(), ...over });
const ids = (b: { profiles: SproutProfile[] }) => b.profiles.map((x) => x.id);

describe("groupBrands: one Sprout group is one brand", () => {
  // Sprout names a brand's profiles differently on each network (the 2 Nov dry run); its own groups keep them together.
  const GROUPS = [{ id: "11", name: "Olo" }, { id: "12", name: "Yangra" }, { id: "13", name: "Team" }];
  const listed = [
    inGroup(["11"], p("7001", "Olo - Skip the Line", "olo", "facebook")), inGroup(["11"], p("7002", "Olo App | Food Ordering", "oloapp", "fb_instagram_account")),
    inGroup(["11"], p("7003", "Olo App | Food Ordering", "oloapp", "tiktok")),
    inGroup(["12"], p("9100", "Yangra", "yangra", "facebook")), inGroup(["12"], p("9101", "Yangra | Hinduism for Modern Life", "yangra.life", "fb_instagram_account")),
    inGroup(["99"], p("9200", "DermaAngel US", "dermaangelus", "facebook")), inGroup(["99"], p("9201", "dermaangel_us", "dermaangel_us", "fb_instagram_account")),
    p("9300", "Twos", "twos", "facebook"), p("9301", "Twos", "twosapp", "tiktok"), p("9302", "Olo", "olo_loose", "twitter"),
  ];

  it("makes each group one brand, named as people know it, whatever Sprout calls its profiles", () => {
    const brands = groupBrands(listed, GROUPS);
    expect(brands.map((b) => [b.key, b.name, ids(b), b.group?.id ?? null])).toEqual([
      ["group:11", "Olo", ["7001", "7002", "7003"], "11"],
      ["group:12", "Yangra", ["9100", "9101"], "12"],
      // A group Sprout's group list does not name: the spelling most of its profiles carry.
      ["group:99", "DermaAngel US", ["9200", "9201"], "99"],
      // Profiles in no group fall back to the name rule, and never join a group by name or handle.
      ["9300", "Twos", ["9300", "9301"], null],
      ["9302", "Olo", ["9302"], null],
    ]);
  });
  it("puts a profile in two groups in both, and leaves those brands alone with a plain reason", () => {
    const shared = inGroup(["11", "13"], p("7004", "Olo", "olo.team", "linkedin_company"));
    const brands = groupBrands([...listed, shared], GROUPS);
    const olo = brands.find((b) => b.key === "group:11")!;
    const team = brands.find((b) => b.key === "group:13")!;
    expect(ids(team)).toEqual(["7004"]);
    expect(groupConflict(olo, GROUPS)).toBe("Left alone: its linkedin_company profile olo.team is in two Sprout groups (Olo and Team), so which brand it belongs to is unclear.");
    expect(groupConflict(groupBrands(listed, GROUPS)[0], GROUPS)).toBeNull();
  });
  it("leaves a group alone when its profiles are assigned to two different clients", () => {
    const [olo] = groupBrands(listed, GROUPS);
    const m = matchBrand(olo, index([client({ id: "a", name: "Olo" }), client({ id: "b", name: "Olo Ordering" })], { assigned: new Map([["7001", ["a"]], ["7002", ["b"]]]) }));
    expect(matchOutcome(m!)).toMatchObject({ decision: "two_clients", client_ids: ["a", "b"] });
  });
  it("matches a group by the group's name, and by any of its profiles' names", () => {
    const [olo] = groupBrands(listed, GROUPS);
    expect(matchBrand(olo, index([client({ id: "o", name: "Olo, Inc." })]))).toMatchObject({ by: "name", clients: [{ id: "o" }] });
    expect(matchBrand(olo, index([client({ id: "o", name: "Olo - Skip the Line" })]))).toMatchObject({ by: "name" });
  });
  it("joins a loose brand into a group by the website, and never joins two groups, even through a loose brand", () => {
    const brands = groupBrands(listed, GROUPS);
    const joined = joinBrands(brands, [["group:11", "9302"], ["9302", "group:12"]]);
    expect(joined.map((b) => [b.key, b.name, ids(b), b.members])).toEqual([
      ["group:11", "Olo", ["7001", "7002", "7003", "9302"], ["group:11", "9302"]],
      ["group:12", "Yangra", ["9100", "9101"], ["group:12"]],
      ["group:99", "DermaAngel US", ["9200", "9201"], ["group:99"]],
      ["9300", "Twos", ["9300", "9301"], ["9300"]],
    ]);
  });
});

describe("groupBrands: profiles in no group", () => {
  it("groups by the lifecycle's name rule: case, punctuation, '&' and a trailing LLC, Inc or Co", () => {
    const brands = groupBrands([
      p("30", "Pay The Pyper ", "paythepyperapp", "facebook"), p("31", "Pay the Pyper", "paythepyper", "fb_instagram_account"),
      p("40", "Bader & Law, LLC", "BaderLawLLC", "facebook"), p("41", "Bader and Law", "baderlaw", "youtube"),
      p("50", "Lega.bot", "legabot", "linkedin_company"), p("51", "LegaBot Inc", "lega.bot", "fb_instagram_account"),
    ]);
    expect(brands.map((b) => [b.key, ids(b)])).toEqual([["30", ["30", "31"]], ["40", ["40", "41"]], ["50", ["50", "51"]]]);
  });
  it("joins two groups that share a handle on another network", () => {
    const brands = groupBrands([p("7", "Olo", "olo", "linkedin_company"), p("8", "Olo - Restaurant Software", "@Olo", "fb_instagram_account"), p("9", "Someone", "someone", "facebook")]);
    expect(brands.map(ids)).toEqual([["7", "8"], ["9"]]);
    // The same network is not "another network" (an Instagram account is one whichever way Sprout types it), and a two-letter handle never joins.
    expect(groupBrands([p("1", "A", "acme", "instagram"), p("2", "B", "acme", "fb_instagram_account")]).map(ids)).toEqual([["1"], ["2"]]);
    expect(groupBrands([p("1", "A", "ab", "facebook"), p("2", "B", "ab", "twitter")]).map(ids)).toEqual([["1"], ["2"]]);
  });
  it("leaves out profiles Sprout no longer has active", () => {
    expect(groupBrands([p("1", "Olo", "olo", "facebook", "disconnected"), p("2", "Olo", "olo_ig", "fb_instagram_account")]).map(ids)).toEqual([["2"]]);
  });
  it("names the brand by the spelling most of its profiles carry, the oldest profile's on a tie", () => {
    const [b] = groupBrands([p("12", "OLO", "olo1", "facebook"), p("10", "Olo", "olo2", "twitter"), p("11", "Olo", "olo3", "tiktok")]);
    expect(b).toMatchObject({ key: "10", name: "Olo" });
    expect(groupBrands([p("9", "Yangra ", "y1", "facebook"), p("100", "YANGRA", "y2", "tiktok")])[0].name).toBe("Yangra");
  });
  it("joins brands by the pairs the website search found, and names them again", () => {
    const brands = groupBrands([p("1", "Olo", "olo", "linkedin_company"), p("2", "Olo Hospitality", "olohq", "fb_instagram_account"), p("3", "Olo Hospitality", "olohq_fb", "facebook"), p("4", "Other", "other", "facebook")]);
    const joined = joinBrands(brands, [["2", "1"]]);
    // "Olo" is the name all three share ("Olo Hospitality" begins with it).
    expect(joined.map((b) => [b.key, b.name, ids(b), b.members])).toEqual([["1", "Olo", ["1", "2", "3"], ["1", "2"]], ["4", "Other", ["4"], ["4"]]]);
  });
});

describe("matchBrand", () => {
  const [bader] = groupBrands([p("7480884", "Bader Law", "BaderLawLLC", "facebook"), p("7481075", "Bader Law", "Bader Law", "youtube")]);
  const active = client({ id: "c1", name: "Bader Law" });

  it("matches by an assigned profile first, leaving the brand to that client's accounts step", () => {
    const m = matchBrand(bader, index([active, client({ id: "c2", name: "Someone" })], { assigned: new Map([["7481075", ["c2"]]]) }));
    expect(m).toMatchObject({ by: "assigned", clients: [{ id: "c2" }] });
    expect(matchOutcome(m!).decision).toBe("matched");
  });
  it("leaves a brand alone for good when a person removed one of its profiles", () => {
    const m = matchBrand(bader, index([active], { removed: new Map([["7480884", ["c1"]]]) }));
    expect(m).toMatchObject({ by: "removed", clients: [{ id: "c1" }] });
    expect(matchOutcome(m!).decision).toBe("removed");
  });
  it("matches by the name rule, and by a profile the client's homepage links to", () => {
    expect(matchBrand(bader, index([client({ id: "c1", name: "Bader Law, LLC" })]))).toMatchObject({ by: "name" });
    const moburstClient = client({ id: "m", name: "Moburst", site_profiles: ["linkedin:moburst", "instagram:moburst.agency"] });
    // The brand's name before its tagline is the client's name.
    const [moburst] = groupBrands([p("5719052", "Moburst - Growth Done Right", "moburst", "linkedin_company")]);
    expect(matchBrand(moburst, index([moburstClient]))).toMatchObject({ by: "name", clients: [{ id: "m" }] });
    const [agency] = groupBrands([p("5489335", "Mobile-First Digital Agency", "moburst.agency", "fb_instagram_account")]);
    expect(matchBrand(agency, index([moburstClient]))).toMatchObject({ by: "site_link", clients: [{ id: "m" }] });
  });
  it("leaves an archived client's brand alone and never brings the client back", () => {
    const m = matchBrand(bader, index([client({ id: "c1", name: "Bader Law", archived_at: "2026-09-30T00:00:00Z" })]));
    expect(matchOutcome(m!)).toMatchObject({ decision: "archived" });
  });
  it("never counts a same-named demo copy as a match", () => {
    expect(matchBrand(bader, index([client({ id: "d", name: "Bader Law", demo_job_id: "job-1" })]))).toBeNull();
  });
  it("leaves a brand that matches two clients alone", () => {
    const m = matchBrand(bader, index([client({ id: "c1", name: "Bader Law" }), client({ id: "c2", name: "Bader Law Inc" })]));
    expect(matchOutcome(m!)).toMatchObject({ decision: "two_clients" });
  });
  it("matches nothing for a brand nobody has", () => {
    expect(matchBrand(bader, index([client({ id: "c9", name: "Pay The Pyper" })]))).toBeNull();
  });
});

describe("which unmatched brands become clients (section 3)", () => {
  const clients = [client({ id: "m", name: "Moburst", website_url: "https://www.moburst.com/" }), client({ id: "d", name: "Demo", website_url: "https://olo.com", demo_job_id: "j" })];
  const [olo] = groupBrands([p("1", "Olo", "olo", "linkedin_company"), p("2", "Olo", "olo", "fb_instagram_account")]);
  const [founder] = groupBrands([p("3", "Noah Glass", "noahglass", "linkedin")]);

  it("needs a brand account: a brand made only of personal LinkedIn profiles is a person", () => {
    expect(isBrandAccount(olo)).toBe(true);
    expect(isBrandAccount(founder)).toBe(false);
    expect(blockedFromCreation(founder, { posts: 5, mostLinked: "noahglass.com" }, clients)).toMatchObject({ decision: "person" });
  });
  it("needs a post in the last 90 days, else it is looked at again next run", () => {
    expect(blockedFromCreation(olo, { posts: 0, mostLinked: null }, clients)).toMatchObject({ decision: "no_posts" });
  });
  it("leaves a brand alone when the site its posts link to most is an existing client's, a subdomain included", () => {
    expect(blockedFromCreation(olo, { posts: 4, mostLinked: "moburst.com" }, clients)).toMatchObject({ decision: "client_website", client_id: "m" });
    expect(blockedFromCreation(olo, { posts: 4, mostLinked: "careers.moburst.com" }, clients)).toMatchObject({ decision: "client_website" });
    expect(clientWithSite("moburst.co", clients)).toBeNull();
  });
  it("lets a brand through when all three hold, a demo copy's website being no client's", () => {
    expect(blockedFromCreation(olo, { posts: 4, mostLinked: "olo.com" }, clients)).toBeNull();
    expect(blockedFromCreation(olo, { posts: 4, mostLinked: null }, clients)).toBeNull();
  });
});

// Live groups of 2 Nov 2026: Sprout's group label is the team's shorthand ("ewc", "RMBH"); a client is named as people know the brand.
describe("the name a new client gets", () => {
  const named = (group: string, ...names: string[]) => brandName(names.map((n, i) => p(String(100 + i), n, `h${i}`, "facebook")), { id: "1", name: group });

  it("takes each profile's brand name: before a tagline, without a legal suffix", () => {
    expect(profileBrandName("Buzznow | Live Expert Help")).toBe("Buzznow");
    expect(profileBrandName("Olo - Skip the Line")).toBe("Olo");
    expect(profileBrandName("Olo \u2013 Order Ahead")).toBe("Olo");
    expect(profileBrandName("European Wax Center (Erie)")).toBe("European Wax Center");
    expect(profileBrandName("Adaptive Sound Technologies, Inc.")).toBe("Adaptive Sound Technologies");
    expect(profileBrandName("Bader Law LLC")).toBe("Bader Law");
    expect(profileBrandName("Mobile-First Agency")).toBe("Mobile-First Agency");
  });
  it("uses the name most profiles share, never the group's label", () => {
    expect(named("ewc", "European Wax Center (Erie)", "European Wax Center").name).toBe("European Wax Center");
    expect(named("AST", "Adaptive Sound Technologies, Inc.").name).toBe("Adaptive Sound Technologies");
    expect(named("buzznow", "Buzznow", "Buzznow | Live Expert Help").name).toBe("Buzznow");
    expect(named("Global Class (Ai Degree)", "Ai Degree", "Ai Degree | AI Education").name).toBe("Ai Degree");
    expect(named("Yangra", "Yangra", "Yangra | Hinduism for Modern Life").name).toBe("Yangra");
  });
  it("counts a profile for every brand name its own name begins with", () => {
    expect(named("Olo", "Olo - Skip the Line", "Olo App | Food Ordering", "Olo App | Food Ordering").name).toBe("Olo");
    expect(named("Twos", "Twos Company", "Twos").name).toBe("Twos");
  });
  it("leaves out names that look like handles", () => {
    const derma = named("DermaAngel", "DermaAngel US", "dermaangel_us");
    expect(derma.name).toBe("DermaAngel US");
    expect(derma.why).toContain(`"dermaangel_us" looks like a handle`);
    expect(named("prepsmart", "PrepSmart Recipes", "prepsmartrecipes", "PrepSmartRecipes").name).toBe("PrepSmart Recipes");
  });
  it("takes the longest of names shared equally, and says so", () => {
    // RMBH: neither name begins the other, so they tie, and the longer is the charity's.
    const rmbh = named("RMBH", "Rebbe Meir Baal Haness US", "Rebbe Meir Baal Hanes Charity");
    expect(rmbh.name).toBe("Rebbe Meir Baal Hanes Charity");
    expect(rmbh.why).toBe(`Named "Rebbe Meir Baal Hanes Charity": the longest of the names shared by the most profiles (1 of 2 each: "Rebbe Meir Baal Haness US", "Rebbe Meir Baal Hanes Charity"); the Sprout group is "RMBH".`);
  });
  it("says which name most profiles share", () => {
    expect(named("ewc", "European Wax Center (Erie)", "European Wax Center").why).toBe(`Named "European Wax Center": the name 2 of its 2 profile names share; the Sprout group is "ewc".`);
  });
  it("falls back to the group's name only when no profile name is usable", () => {
    const only = named("Global Class (Ai Degree)", "aidegree_official");
    expect(only.name).toBe("Global Class (Ai Degree)");
    expect(only.why).toBe(`Named after its Sprout group "Global Class (Ai Degree)": no profile name is usable ("aidegree_official" looks like a handle).`);
  });
  it("names the brands groupBrands makes this way, keeping the group's own name on the group", () => {
    const [ewc] = groupBrands([inGroup(["7"], p("1", "European Wax Center (Erie)", "ewc_erie", "facebook")), inGroup(["7"], p("2", "European Wax Center", "waxcenter", "fb_instagram_account"))], [{ id: "7", name: "ewc" }]);
    expect(ewc).toMatchObject({ key: "group:7", name: "European Wax Center", group: { id: "7", name: "ewc" } });
    expect(ewc.name_reason).toMatch(/^Named "European Wax Center"/);
  });
  it("matches a client by the group's own name too", () => {
    const [ewc] = groupBrands([inGroup(["7"], p("1", "European Wax Center", "waxcenter", "facebook"))], [{ id: "7", name: "EWC" }]);
    expect(matchBrand(ewc, index([client({ id: "c", name: "ewc" })]))).toMatchObject({ by: "name", clients: [{ id: "c" }] });
  });
});

// A person's decision not to add a brand as a client is data (sprout_brand_declines), as a profile's removal is.
describe("a brand a person chose not to add", () => {
  const GROUPS = [{ id: "21", name: "Global Class (Ai Degree)" }, { id: "22", name: "RMBH" }, { id: "23", name: "Olo" }];
  const brands = groupBrands([
    inGroup(["21"], p("9500", "Ai Degree", "aidegree", "facebook")), inGroup(["21"], p("9501", "Ai Degree | AI Education", "aidegree.ai", "fb_instagram_account")),
    inGroup(["22"], p("9600", "Rebbe Meir Baal Haness US", "rmbh", "facebook")), inGroup(["22"], p("9601", "Rebbe Meir Baal Hanes Charity", "rmbhcharity", "tiktok")),
    inGroup(["23"], p("7001", "Olo", "olo", "facebook")),
    p("9700", "Loose Brand", "loose", "facebook"),
  ], GROUPS);
  const byKey = (k: string) => brands.find((b) => b.key === k)!;
  const DECLINES = [
    { id: "d1", sprout_group_id: "21", profile_ids: ["9500", "9501"], brand: "Ai Degree", declined_at: "2026-11-02T12:30:00Z", note: null },
    { id: "d2", sprout_group_id: null, profile_ids: ["9601"], brand: "Rebbe Meir Baal Hanes Charity", declined_at: "2026-11-02T12:31:00Z", note: "Team decision" },
  ];

  it("finds the decline by the brand's Sprout group, or by any one of its profiles", () => {
    expect(declineFor(byKey("group:21"), DECLINES)?.id).toBe("d1");
    expect(declineFor(byKey("group:22"), DECLINES)?.id).toBe("d2");
    expect(declineFor(byKey("group:23"), DECLINES)).toBeNull();
    expect(declineFor(byKey("9700"), DECLINES)).toBeNull();
    expect(declineFor(byKey("9700"), [{ ...DECLINES[1], profile_ids: ["9700"] }])?.id).toBe("d2");
  });
  it("says so plainly, with the day in Israel time", () => {
    expect(declineReason(DECLINES[0])).toBe("Left alone for good: a person chose not to add it as a client on Nov 2, 2026.");
    expect(declineReason({ ...DECLINES[0], declined_at: "2026-11-02T22:30:00Z" })).toBe("Left alone for good: a person chose not to add it as a client on Nov 3, 2026.");
  });
});
