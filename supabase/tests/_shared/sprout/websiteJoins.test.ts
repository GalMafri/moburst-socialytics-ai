// @vitest-environment node
// Two brands that link the same social profile are one company, whatever case the page wrote the handle in
// (siteProfileLinks lists a link once, as written; links are compared lower-cased, siteLinks.ts).
import { describe, expect, it } from "vitest";
import { websiteJoins } from "../../../functions/_shared/sprout/website";
import { siteProfileLinks } from "../../../functions/_shared/lifecycle/accounts";

const brand = (key: string, native: string) => ({ key, profiles: [{ id: key, name: key, network_type: "facebook", native_name: native } as never] });

describe("websiteJoins", () => {
  it("joins a brand whose profile the page links with capitals in the handle", () => {
    const site_profiles = siteProfileLinks(`<a href="https://www.facebook.com/BaderLawLLC">Facebook</a>`);
    expect(site_profiles).toEqual(["facebook:BaderLawLLC"]);
    const pairs = websiteJoins([{ key: "a", website: "https://example.com", site_profiles }], [brand("a", "x"), brand("b", "baderlawllc")]);
    expect(pairs).toEqual([["a", "b"]]);
  });

  it("joins a brand whose native name has capitals, for a page that wrote the handle in lower case", () => {
    const site_profiles = siteProfileLinks(`<a href="https://www.facebook.com/baderlawllc">Facebook</a>`);
    expect(websiteJoins([{ key: "a", website: "https://example.com", site_profiles }], [brand("a", "x"), brand("b", "BaderLawLLC")])).toEqual([["a", "b"]]);
  });

  it("joins nothing for a profile the page does not link", () => {
    const site_profiles = siteProfileLinks(`<a href="https://www.facebook.com/Other">Facebook</a>`);
    expect(websiteJoins([{ key: "a", website: "https://example.com", site_profiles }], [brand("a", "x"), brand("b", "baderlawllc")])).toEqual([]);
  });
});
