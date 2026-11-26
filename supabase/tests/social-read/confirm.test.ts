// @vitest-environment node
// Whether a profile is the brand's own before it is read (plan of 25 Nov
// 2026, section 4): a person's or RivalIQ's profile is confirmed; otherwise
// it links the brand's site, or its name matches and the site links it.
import { describe, expect, it } from "vitest";
import { confirmedWithoutRead, confirmProfile, linksSite, nameMatches, siteHost } from "../../functions/social-read/confirm";
import type { ProfileRecord } from "../../functions/social-read/readers/types";

const rec = (o: Partial<ProfileRecord> = {}): ProfileRecord => ({ found: true, private: false, page: true, name: null, links: [], bio: "", followers: 10, ...o });
const brand = { name: "Poliform USA (Varenna)", website: "https://www.poliform.it/" };

describe("confirmProfile", () => {
  it("confirms a person's and RivalIQ's profile with no read", () => {
    expect(confirmedWithoutRead("manual")).toEqual({ confirmed: true, reason: "entered_by_person" });
    expect(confirmedWithoutRead("person")).toEqual({ confirmed: true, reason: "entered_by_person" });
    expect(confirmedWithoutRead("rivaliq")).toEqual({ confirmed: true, reason: "tracked_in_rivaliq" });
    expect(confirmedWithoutRead("auto")).toBeNull();
    expect(confirmProfile({ source: "manual", foundOnSite: false, brand, handle: "x", record: null }).confirmed).toBe(true);
  });

  it("confirms a profile that links the brand's site, or the same name under another country's domain", () => {
    expect(confirmProfile({ source: "auto", foundOnSite: false, brand, handle: "poliform_official", record: rec({ links: ["https://poliform.it/en"] }) })).toEqual({ confirmed: true, reason: "links_brand_site" });
    expect(confirmProfile({ source: "auto", foundOnSite: false, brand, handle: "poliform_official", record: rec({ links: ["https://www.poliform.com"] }) }).reason).toBe("links_brand_site");
    expect(confirmProfile({ source: "auto", foundOnSite: false, brand, handle: "p", record: rec({ bio: "Visit shop.poliform.it today" }) }).reason).toBe("links_brand_site");
  });

  it("confirms a profile the site links when its name matches the brand, and not otherwise", () => {
    expect(confirmProfile({ source: "auto", foundOnSite: true, brand, handle: "poliformspa", record: rec({ name: "Poliform" }) })).toEqual({ confirmed: true, reason: "name_and_site_link" });
    expect(confirmProfile({ source: "auto", foundOnSite: true, brand, handle: "cpeacock19", record: rec({ name: "Chris P" }) })).toEqual({ confirmed: false, reason: "name_differs" });
    expect(confirmProfile({ source: "auto", foundOnSite: false, brand, handle: "poliform", record: rec({ name: "Poliform" }) })).toEqual({ confirmed: false, reason: "no_link_to_brand" });
  });

  it("never confirms a missing, private or personal profile", () => {
    expect(confirmProfile({ source: "auto", foundOnSite: true, brand, handle: "x", record: null }).reason).toBe("profile_not_found");
    expect(confirmProfile({ source: "auto", foundOnSite: true, brand, handle: "x", record: rec({ private: true, links: ["https://poliform.it"] }) }).reason).toBe("private");
    // The Facebook profile of a person named like the brand (Christopher Peacock, 23 Nov 2026): not a page.
    expect(confirmProfile({ source: "auto", foundOnSite: true, brand: { name: "Christopher Peacock", website: "https://www.christopherpeacock.com/" }, handle: "christopher.peacock.73", record: rec({ page: false }) }).reason).toBe("not_a_page");
  });
});

describe("helpers", () => {
  it("siteHost drops www and accepts a bare domain", () => {
    expect(siteHost("https://www.Brand.com/about")).toBe("brand.com");
    expect(siteHost("brand.co.uk")).toBe("brand.co.uk");
    expect(siteHost("")).toBe("");
  });
  it("linksSite needs the brand's host, a subdomain of it, or its name under another suffix", () => {
    expect(linksSite(rec({ links: ["https://acme.co.uk"] }), "https://www.acme.com")).toBe(false); // "acme" is under 5 letters: too common to match on
    expect(linksSite(rec({ links: ["https://poliform.co.uk"] }), "https://www.poliform.it")).toBe(true);
    expect(linksSite(rec({ links: ["https://linktr.ee/poliform"] }), "https://www.poliform.it")).toBe(false);
    expect(linksSite(rec({ links: ["https://poliform.it"] }), null)).toBe(false);
  });
  it("nameMatches ignores legal words, spaces and punctuation", () => {
    expect(nameMatches("Bader Law, PLLC", "Bader Law", "baderlaw")).toBe(true);
    expect(nameMatches("Pay The Pyper", null, "paythepyper")).toBe(true);
    expect(nameMatches("Acme", "Acme Widgets Official", "acmewidgets")).toBe(true);
    expect(nameMatches("Acme Widgets", "Bob", "bob123")).toBe(false);
  });
});
