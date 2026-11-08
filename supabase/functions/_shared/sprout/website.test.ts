// @vitest-environment node
import { describe, expect, it } from "vitest";
import { confirmingFact, domainLabel, linkedDomains, MAX_NAME_SEARCHES, nameLabels, nameQueries, postLinks, searchWebsite, searchWebsiteByName, siteNameOf, statedWebsite, webReader, websiteJoins, type SiteReader } from "./website";
import { groupBrands } from "./brands";
import type { SproutProfile } from "../lifecycle/accounts";

const p = (id: string, name: string, native: string, network: string): SproutProfile => ({ id, name, native_name: native, network_type: network, native_link: "", status: "active" });
const OLO = groupBrands([p("1", "Olo", "olo", "linkedin_company"), p("2", "Olo", "olo.hq", "fb_instagram_account")])[0];
const PTP = groupBrands([p("3", "Pay The Pyper ", "paythepyperapp", "facebook")])[0];
const post = (text: string) => ({ text });

/** A reader over fixed answers: redirects by URL, homepages by host. */
function reader(redirects: Record<string, string> = {}, pages: Record<string, string> = {}): SiteReader & { resolved: string[]; read: string[] } {
  const r = {
    resolved: [] as string[],
    read: [] as string[],
    async resolve(url: string) { r.resolved.push(url); return redirects[url] ?? url; },
    async homepage(url: string) {
      r.read.push(url);
      const host = new URL(url).hostname;
      return host in pages ? { html: pages[host], url: `https://www.${host}/` } : null;
    },
  };
  return r;
}

describe("the links in a brand's posts", () => {
  it("finds every link, with or without a scheme, and drops trailing punctuation", () => {
    expect(postLinks("Order at https://www.olo.com/demo. Or www.olo.com/blog, (see https://bit.ly/x)!")).toEqual(["https://www.olo.com/demo", "https://www.olo.com/blog", "https://bit.ly/x"]);
    expect(postLinks("")).toEqual([]);
  });
  it("counts the domains most-linked first, after their redirects, without social or app store links", async () => {
    const posts = [
      post("Demo https://bit.ly/olo1 and https://www.instagram.com/olo"), post("https://olo.com/a https://apps.apple.com/app/olo"),
      post("https://lnkd.in/abc"), post("https://bit.ly/olo1"), post("https://partner.example/case-study"),
    ];
    const r = reader({ "https://bit.ly/olo1": "https://www.olo.com/demo", "https://lnkd.in/abc": "https://www.linkedin.com/company/olo" });
    expect(await linkedDomains(posts, r)).toEqual([{ domain: "olo.com", links: 3 }, { domain: "partner.example", links: 1 }]);
    // Each distinct link is followed once.
    expect(r.resolved.filter((u) => u === "https://bit.ly/olo1")).toHaveLength(1);
  });
  it("drops a shortened link whose redirect could not be followed", async () => {
    const r: SiteReader = { resolve: async () => null, homepage: async () => null };
    expect(await linkedDomains([post("https://bit.ly/gone https://olo.com")], r)).toEqual([{ domain: "olo.com", links: 1 }]);
  });
});

describe("judging the registrable domain (the 2 Nov dry run: app.olo.com 7 times, nothing confirmed)", () => {
  const OLO_GROUP = { ...groupBrands([{ ...p("7001", "Olo - Skip the Line", "olo", "facebook"), groups: ["11"] }, { ...p("7002", "Olo App | Food Ordering", "oloapp", "fb_instagram_account"), groups: ["11"] }], [{ id: "11", name: "Olo" }])[0] };
  it("counts each landing host (without www) on its own, and never a shared platform", async () => {
    const posts = [
      ...Array.from({ length: 7 }, (_, i) => post(`Order at https://app.olo.com/r/${i}`)), post("https://www.olo.com"),
      post("https://www.einpresswire.com/article/1 https://podcasts.apple.com/podcast/olo https://anchor.fm/olo https://olo.myshopify.com https://linktr.ee/olo"),
      post("https://bit.ly/press"),
    ];
    const r = reader({ "https://bit.ly/press": "https://www.prnewswire.com/news/olo" });
    expect(await linkedDomains(posts, r)).toEqual([{ domain: "app.olo.com", links: 7 }, { domain: "olo.com", links: 1 }]);
    // Shared platforms are never followed, only link shorteners are.
    expect(r.resolved.some((u) => /einpresswire|apple|anchor|myshopify|linktr/.test(u))).toBe(false);
  });
  it("tries the full host's homepage first, then the registrable domain's, and confirms it by the brand's own name", async () => {
    const r = reader({}, { "olo.com": "<p>Olo</p>" });
    const out = await searchWebsite(OLO_GROUP, Array.from({ length: 7 }, () => post("https://app.olo.com/order")), r);
    expect(r.read).toEqual(["https://app.olo.com", "https://olo.com"]);
    expect(out).toMatchObject({ website: "https://www.olo.com", confirmed_by: "domain_name", most_linked: "app.olo.com" });
  });
  it("counts shop.olo.com as shop.olo.com and tries it before olo.com", async () => {
    expect(await linkedDomains([post("https://shop.olo.com/a https://www.olo.com/b https://shop.olo.com/c")], reader())).toEqual([{ domain: "shop.olo.com", links: 2 }, { domain: "olo.com", links: 1 }]);
    const fallback = reader({}, { "olo.com": "<p>Olo</p>" });
    const out = await searchWebsite(OLO_GROUP, [post("https://shop.olo.com/x")], fallback);
    expect(fallback.read).toEqual(["https://shop.olo.com", "https://olo.com"]);
    expect(out.tried).toEqual([{ domain: "shop.olo.com", read: false, fact: null }, { domain: "olo.com", read: true, fact: "domain_name" }]);
    expect(out).toMatchObject({ website: "https://www.olo.com", confirmed_by: "domain_name" });
  });
  it("never takes a brand's own subdomain for the site on its name alone, even when the subdomain answers", async () => {
    // app.olo.com and shop.olo.com answer, and only the registered name (olo) matches: the registrable domain is the site.
    const r = reader({}, { "app.olo.com": "<p>Order</p>", "shop.olo.com": "<p>Shop</p>", "olo.com": "<p>Olo</p>" });
    const out = await searchWebsite(OLO_GROUP, [post("https://app.olo.com/a https://app.olo.com/b https://shop.olo.com/c")], r);
    expect(r.read).toEqual(["https://app.olo.com", "https://olo.com"]);
    expect(out.tried).toEqual([{ domain: "app.olo.com", read: true, fact: null }, { domain: "olo.com", read: true, fact: "domain_name" }]);
    expect(out).toMatchObject({ website: "https://www.olo.com", confirmed_by: "domain_name" });
  });
  it("confirms a subdomain as itself by a fact from its own page: a link to a profile or its site name", async () => {
    const uproar = groupBrands([p("21", "Uproar", "uproar", "linkedin_company")])[0];
    const linked = reader({}, { "uproar.moburst.com": `<a href="https://www.linkedin.com/company/uproar/">in</a>`, "moburst.com": "<p>Moburst</p>" });
    expect(await searchWebsite(uproar, [post("https://uproar.moburst.com/x")], linked)).toMatchObject({ website: "https://www.uproar.moburst.com", confirmed_by: "profile_link" });
    expect(linked.read).toEqual(["https://uproar.moburst.com"]);
    const named = reader({}, { "app.example.com": `<meta property="og:site_name" content="Uproar">` });
    expect(await searchWebsite(uproar, [post("https://app.example.com/x")], named)).toMatchObject({ website: "https://www.app.example.com", confirmed_by: "site_name" });
  });
  it("searches by name the same way: the host first, then its registrable domain", async () => {
    const link = `<a href="https://www.instagram.com/oloapp/">ig</a>`;
    const r = reader({}, { "olo.com": link });
    const engine = { search: async () => ["https://shop.olo.com/menu"] };
    const out = await searchWebsiteByName(OLO_GROUP, engine, r);
    expect(r.read).toEqual(["https://shop.olo.com", "https://olo.com"]);
    expect(out).toMatchObject({ website: "https://www.olo.com", confirmed_by: "profile_link" });
  });
  it("states a LinkedIn page's website with its subdomain and path, and ignores a social profile or a non-web address", () => {
    expect(statedWebsite({ website: "https://uproar.moburst.com/" } as never)).toBe("https://uproar.moburst.com/");
    expect(statedWebsite({ website: "https://www.moburst.com/services/organic/podcast-booking/" } as never)).toBe("https://www.moburst.com/services/organic/podcast-booking/");
    expect(statedWebsite({ website: "https://www.moburst.com/podcast/?utm_source=linkedin&x=1#top" } as never)).toBe("https://www.moburst.com/podcast/");
    expect(statedWebsite({ website: "https://uproar.moburst.com?utm_source=linkedin" } as never)).toBe("https://uproar.moburst.com/");
    expect(statedWebsite({ website: "https://www.instagram.com/olo.hq" } as never)).toBeNull();
    expect(statedWebsite({ website: "https://linktr.ee/olo" } as never)).toBeNull();
    expect(statedWebsite({ website: "mailto:hi@olo.com" } as never)).toBeNull();
    expect(statedWebsite({ website: "" } as never)).toBeNull();
    expect(statedWebsite({ website: null } as never)).toBeNull();
    expect(statedWebsite(null)).toBeNull();
  });
  it("names a domain by its registrable label", () => {
    expect(domainLabel("app.olo.com")).toBe("olo");
    expect(domainLabel("shop.olo.co.uk")).toBe("olo");
  });
  it("compares the label with every name in the brand, without spaces and punctuation, dropping a leading or trailing app, the, official or us", () => {
    const labels = nameLabels(["Olo App | Food Ordering", "Olo - Skip the Line", "DermaAngel US", "dermaangel_us", "The Official Twos", "Bader & Law", "European Wax Center (Erie)"]);
    for (const l of ["olo", "oloapp", "dermaangel", "dermaangelus", "twos", "officialtwos", "baderlaw", "baderandlaw", "europeanwaxcenter"]) expect(labels, l).toContain(l);
    for (const l of ["food", "skip", "skiptheline", "app", "us", "erie"]) expect(labels, l).not.toContain(l);
    const brand = (name: string) => ({ name, profiles: [] });
    expect(confirmingFact(brand("DermaAngel US"), "dermaangel.com", null)).toBe("domain_name");
    expect(confirmingFact(brand("Olo Dining"), "olo.com", null)).toBeNull();
    // The Sprout group's own name is one of the brand's names too.
    expect(confirmingFact({ name: "European Wax Center", profiles: [], group: { id: "7", name: "EWC" } }, "ewc.com", null)).toBe("domain_name");
  });
});

describe("the facts that confirm a website", () => {
  it("reads a homepage's og:site_name and a domain's own name", () => {
    expect(siteNameOf(`<meta content="Pay The Pyper" property="og:site_name">`)).toBe("Pay The Pyper");
    expect(siteNameOf(`<meta property='og:site_name' content='Olo &amp; Co'/>`)).toBe("Olo & Co");
    expect(siteNameOf("<title>x</title>")).toBeNull();
    expect(domainLabel("www.paythepyper.com")).toBe("paythepyper");
    expect(domainLabel("olo.myshopify.com")).toBe("myshopify");
  });
  it("accepts a homepage that links to one of the brand's profiles", () => {
    expect(confirmingFact(OLO, "olo-dining.com", `<a href="https://www.linkedin.com/company/olo/">in</a>`)).toBe("profile_link");
  });
  it("accepts a domain whose name is the brand name without spaces, with no page needed", () => {
    expect(confirmingFact(PTP, "paythepyper.com", null)).toBe("domain_name");
  });
  it("accepts a homepage whose og:site_name is the brand name", () => {
    expect(confirmingFact(PTP, "ptp.app", `<meta property="og:site_name" content="Pay the Pyper">`)).toBe("site_name");
  });
  it("rejects a domain with none of the three", () => {
    expect(confirmingFact(OLO, "partner.example", `<meta property="og:site_name" content="Partner"><a href="https://www.linkedin.com/company/partner/">in</a>`)).toBeNull();
    expect(confirmingFact(OLO, "partner.example", null)).toBeNull();
  });
});

describe("searchWebsite", () => {
  it("tries the most-linked domains, up to three, and keeps the first one a fact confirms", async () => {
    const posts = [post("https://a.example https://a.example https://a.example"), post("https://b.example https://b.example"), post("https://c.example"), post("https://olo.com")];
    const r = reader({}, { "a.example": "<p>no</p>", "b.example": "<p>no</p>", "c.example": "<p>no</p>", "olo.com": "<p>Olo</p>" });
    const out = await searchWebsite(OLO, posts, r);
    expect(out.website).toBeNull();
    expect(out.tried.map((t) => t.domain)).toEqual(["a.example", "b.example", "c.example"]);
    expect(r.read).toHaveLength(3);
    const found = await searchWebsite(OLO, [post("https://olo.com/x https://olo.com/y"), post("https://a.example")], reader({}, { "olo.com": `<a href="https://instagram.com/olo.hq">ig</a>` }));
    expect(found).toMatchObject({ website: "https://www.olo.com", confirmed_by: "profile_link", most_linked: "olo.com", site_profiles: ["instagram:olo.hq"] });
  });
  it("finds nothing for a brand whose posts link nowhere", async () => {
    expect(await searchWebsite(OLO, [post("Happy Friday")], reader())).toMatchObject({ website: null, most_linked: null, tried: [] });
  });
});

describe("the website join", () => {
  const brands = groupBrands([p("1", "Olo", "olo", "linkedin_company"), p("2", "Olo Hospitality", "olohq", "fb_instagram_account"), p("3", "Other", "other", "facebook"), p("4", "Olo Events", "oloevents", "tiktok")]);
  it("joins brands that confirm the same website, and a brand whose website links to another's profiles", () => {
    const pairs = websiteJoins([
      { key: "1", website: "https://www.olo.com", site_profiles: ["tiktok:oloevents"] },
      { key: "2", website: "https://app.olo.com/", site_profiles: [] },
      { key: "3", website: "https://other.example", site_profiles: [] },
    ], brands);
    expect(pairs).toEqual([["1", "2"], ["1", "4"]]);
  });
});

describe("webReader", () => {
  it("follows redirects itself, and never into a private address", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url === "https://bit.ly/olo1") return new Response(null, { status: 301, headers: { location: "https://olo.com/demo" } });
      if (url === "https://olo.com/demo") return new Response(null, { status: 302, headers: { location: "/en/demo" } });
      if (url === "https://bit.ly/inside") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      return new Response("<html>Olo</html>", { status: 200 });
    }) as typeof fetch;
    const r = webReader({ fetchImpl });
    expect(await r.resolve("https://bit.ly/olo1")).toBe("https://olo.com/en/demo");
    expect(await r.resolve("https://bit.ly/inside")).toBeNull();
    expect(calls).not.toContain("http://169.254.169.254/latest");
    expect(await r.homepage("https://olo.com")).toEqual({ html: "<html>Olo</html>", url: "https://olo.com" });
  });
  it("answers null for a homepage that does not answer", async () => {
    const r = webReader({ fetchImpl: (async () => new Response("no", { status: 503 })) as typeof fetch });
    expect(await r.homepage("https://olo.com")).toBeNull();
    const down = webReader({ fetchImpl: (async () => { throw new Error("down"); }) as typeof fetch });
    expect(await down.resolve("https://olo.com")).toBeNull();
  });
});

describe("the website searched by name (onboarding from social profiles, section 4)", () => {
  const engine = (answers: Record<string, string[]>) => {
    const asked: string[] = [];
    return { asked, async search(q: string) { asked.push(q); return answers[q] ?? []; } };
  };
  it("searches the name and each distinct handle, at most three searches", () => {
    expect(nameQueries("Olo", ["olo", "olo.hq", "olo_eats", "olo-four"])).toEqual(["Olo", "olo.hq", "olo_eats"]);
    expect(nameQueries("Olo", ["Olo"]).length).toBeLessThanOrEqual(MAX_NAME_SEARCHES);
  });
  it("counts a searched domain only when its homepage links to one of the client's own profiles; a name match alone does not", async () => {
    const e = engine({ Olo: ["https://www.instagram.com/olo", "https://olo.co/", "https://www.olo.com/about"] });
    const r = reader({}, { "olo.co": "<title>Olo</title><meta property=\"og:site_name\" content=\"Olo\">", "olo.com": `<a href="https://www.linkedin.com/company/olo/">in</a>` });
    expect(await searchWebsiteByName(OLO, e, r)).toMatchObject({ website: "https://www.olo.com", confirmed_by: "profile_link", queries: ["Olo"] });
    expect(r.read).toEqual(["https://olo.co", "https://olo.com"]);
  });
  it("drops shared platforms and the domains the post search already tried, and reads three new domains at most", async () => {
    // The handle "olo" is the name again: it is not searched twice.
    const e = engine({ Olo: ["https://a.example", "https://b.example", "https://linktr.ee/olo"], "olo.hq": ["https://c.example", "https://d.example", "https://e.example"] });
    const r = reader({}, {});
    const out = await searchWebsiteByName(OLO, e, r, { skip: ["a.example"] });
    expect(out).toMatchObject({ website: null, confirmed_by: null, queries: ["Olo", "olo.hq"] });
    expect(r.read).toEqual(["https://b.example", "https://c.example", "https://d.example"]);
  });
});
