import { describe, expect, it } from "vitest";
import { isSharedPlatform, PLATFORM_KINDS, registrableDomain, SHARED_PLATFORMS, sharedPlatformKind, siteKeyOf } from "./domains";
import { PUBLIC_SUFFIX_SOURCE } from "./publicSuffixes";

describe("registrableDomain (the Public Suffix List's ICANN section)", () => {
  it("names the list it uses", () => {
    expect(PUBLIC_SUFFIX_SOURCE).toMatch(/^Mozilla Public Suffix List, ICANN section, from psl \d/);
  });
  it("finds the domain a company registered, under a one-label or a two-label suffix", () => {
    expect(registrableDomain("app.olo.com")).toBe("olo.com");
    expect(registrableDomain("WWW.Olo.com.")).toBe("olo.com");
    expect(registrableDomain("olo.com")).toBe("olo.com");
    expect(registrableDomain("shop.olo.co.uk")).toBe("olo.co.uk");
    expect(registrableDomain("a.b.example.com.au")).toBe("example.com.au");
    // Not a naive last-two-labels cut: "co.uk" is a suffix, "olo.co" is not.
    expect(registrableDomain("go.olo.co")).toBe("olo.co");
  });
  it("follows wildcard and exception rules", () => {
    expect(registrableDomain("shop.brand.kawasaki.jp")).toBe("shop.brand.kawasaki.jp");
    expect(registrableDomain("www.city.kawasaki.jp")).toBe("city.kawasaki.jp");
    expect(registrableDomain("a.b.ck")).toBe("a.b.ck");
    expect(registrableDomain("www.ck")).toBe("www.ck");
  });
  it("finds internationalized suffixes in their ASCII form, as hostnames arrive", () => {
    expect(registrableDomain(new URL("https://www.marca.公司.cn").hostname)).toBe("marca.xn--55qx5d.cn");
  });
  it("answers null for a suffix itself, an address, or nothing", () => {
    expect(registrableDomain("co.uk")).toBeNull();
    expect(registrableDomain("com")).toBeNull();
    expect(registrableDomain("192.168.0.1")).toBeNull();
    expect(registrableDomain("")).toBeNull();
  });
});

describe("shared platforms", () => {
  it("is one documented list of registrable domains, each with its kind", () => {
    for (const [domain, kind] of Object.entries(SHARED_PLATFORMS)) {
      expect(registrableDomain(domain), domain).toBe(domain);
      expect(PLATFORM_KINDS, domain).toContain(kind);
    }
  });
  it("covers stores, link shorteners, podcast hosts, press-release sites and site builders, at any subdomain", () => {
    for (const [host, kind] of [
      ["apps.apple.com", "store"], ["podcasts.apple.com", "store"], ["play.google.com", "store"], ["olo.myshopify.com", "store"],
      ["bit.ly", "shortener"], ["lnkd.in", "shortener"], ["t.co", "shortener"], ["olo.onelink.me", "shortener"],
      ["anchor.fm", "podcast"], ["www.buzzsprout.com", "podcast"],
      ["www.einpresswire.com", "press"], ["www.prnewswire.com", "press"],
      ["olo.wixsite.com", "builder"], ["linktr.ee", "link_in_bio"], ["www.instagram.com", "social"],
    ] as const) {
      expect(sharedPlatformKind(host), host).toBe(kind);
      expect(isSharedPlatform(`https://${host}/x`), host).toBe(true);
    }
    expect(isSharedPlatform("app.olo.com")).toBe(false);
  });
  it("keys a site by its registrable domain, or by its whole host on a shared platform", () => {
    expect(siteKeyOf("https://app.olo.com/order")).toBe("olo.com");
    expect(siteKeyOf("www.moburst.com")).toBe("moburst.com");
    expect(siteKeyOf("https://olo.wixsite.com/site")).toBe("olo.wixsite.com");
    expect(siteKeyOf("not a site")).toBeNull();
  });
});
