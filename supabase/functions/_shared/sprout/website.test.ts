// @vitest-environment node
import { describe, expect, it } from "vitest";
import { confirmingFact, domainLabel, linkedDomains, postLinks, searchWebsite, siteNameOf, webReader, websiteJoins, type SiteReader } from "./website";
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

describe("the facts that confirm a website", () => {
  it("reads a homepage's og:site_name and a domain's own name", () => {
    expect(siteNameOf(`<meta content="Pay The Pyper" property="og:site_name">`)).toBe("Pay The Pyper");
    expect(siteNameOf(`<meta property='og:site_name' content='Olo &amp; Co'/>`)).toBe("Olo & Co");
    expect(siteNameOf("<title>x</title>")).toBeNull();
    expect(domainLabel("www.paythepyper.com")).toBe("paythepyper");
    expect(domainLabel("shop.olo.co.uk")).toBe("olo");
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
      { key: "2", website: "https://olo.com/", site_profiles: [] },
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
