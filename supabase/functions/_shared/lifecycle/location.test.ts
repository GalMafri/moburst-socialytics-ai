import { describe, expect, it } from "vitest";
import { cityZone, countryCode, domainCountry, followersZone, htmlLanguage, regionsFor, replacesLocation, resolveLocation, resolveSocialLocation, schemaAddresses, SOURCE_RANK, textAddresses, zoneCountry, zoneOf } from "./location";

const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
// Bader Law's site lists its Georgia offices as schema.org LegalService locations.
const BADER = `<html lang="en">${ld({ "@context": "https://schema.org", "@graph": ["Carrollton", "Smyrna", "Atlanta", "Norcross"].map((city) => ({ "@type": "LegalService", address: { "@type": "PostalAddress", addressLocality: city, addressRegion: "GA", addressCountry: "US" } })) })}<body>Call us</body></html>`;
// Moburst's footer lists its offices as street addresses.
const MOBURST = `<html lang="en-US"><body><main>We grow apps</main><footer>
  <p>New York: 1250 Broadway, New York, NY 10001</p><p>232 Madison Ave, New York, NY 10016</p>
  <p>San Francisco: 535 Mission St, San Francisco, CA 94105</p><p>11 Ha'Barzel St, Tel Aviv, Israel</p></footer></body></html>`;

describe("addresses in the page", () => {
  it("reads schema.org addresses and votes on the zone", () => {
    expect(schemaAddresses(BADER)).toHaveLength(4);
    expect(resolveLocation(BADER, { website: "https://www.baderlaw.com/" })).toMatchObject({ timezone: "America/New_York", source: "schema.org", country: "US", region: "GA", agreeing: 4 });
  });
  it("reads a footer address when there is no schema.org one, the zone most addresses share winning", () => {
    expect(resolveLocation(MOBURST, { website: "moburst.com" })).toMatchObject({ timezone: "America/New_York", source: "page_footer", country: "US", region: "NY" });
  });
  it("needs a ZIP or a street number: a city named in a sentence is not an address", () => {
    expect(textAddresses("We love working with brands in Austin, Texas and Denver, CO.")).toEqual([]);
    expect(textAddresses("Visit us at Suite 4, Austin, TX 78701 today")).toHaveLength(1);
  });
  it("reads Atlanta, Georgia as the US state, never the country", () => {
    expect(textAddresses("Office: 12 Peachtree St, Atlanta, Georgia")).toEqual([]);
    expect(zoneOf({ region: "Georgia", country: "United States" })).toEqual({ zone: "America/New_York", country: "US" });
  });
  it("uses a single-zone country without a region, and a province where the country spans zones", () => {
    expect(zoneOf({ country: "Israel" })).toEqual({ zone: "Asia/Jerusalem", country: "IL" });
    expect(zoneOf({ region: "BC", country: "Canada" })).toEqual({ zone: "America/Vancouver", country: "CA" });
    expect(zoneOf({ country: "Canada" })).toBeNull();
    expect(zoneOf({ region: "AZ" })).toEqual({ zone: "America/Phoenix", country: "US" });
  });
});

describe("the order of sources", () => {
  const BARE = `<html lang="en-US"><body>Pay your captain nothing.</body></html>`;
  it("takes the headquarters the brand read gives when the page has no address", () => {
    expect(resolveLocation(BARE, { headquarters: { city: "Denver", region: "Colorado", country: "US" }, website: "paythepyper.com" }))
      .toMatchObject({ timezone: "America/Denver", source: "site_read", region: "Colorado" });
  });
  it("falls back to the country's main zone, from the page's language tag or the country domain", () => {
    expect(resolveLocation(BARE, { website: "paythepyper.com" })).toMatchObject({ timezone: "America/New_York", source: "country", country: "US" });
    expect(resolveLocation("<html><body>Hallo</body></html>", { website: "https://beispiel.de" })).toMatchObject({ timezone: "Europe/Berlin", source: "country", country: "DE" });
    expect(resolveLocation("<html><body>hi</body></html>", { website: "https://lega.bot" })).toMatchObject({ timezone: null, source: null });
  });
  it("never lets a weaker source replace a stronger one on the same website", () => {
    expect(replacesLocation({ source: "schema.org", website: "baderlaw.com" }, { source: "site_read", website: "baderlaw.com" })).toBe(false);
    expect(replacesLocation({ source: "site_read", website: "baderlaw.com" }, { source: "schema.org", website: "baderlaw.com" })).toBe(true);
    expect(replacesLocation({ source: "schema.org", website: "old.com" }, { source: "country", website: "new.com" })).toBe(true);
    expect(replacesLocation(null, { source: null, website: "x.com" })).toBe(false);
  });
});

describe("sources from the client's profiles and posts (onboarding from social profiles, section 3)", () => {
  const NONE = { profileAddresses: [], postTexts: [] };
  it("ranks a Google Business Profile address with schema.org, post addresses with page text, followers below where posts say the business is", () => {
    expect(SOURCE_RANK.profile_address).toBe(SOURCE_RANK["schema.org"]);
    expect(SOURCE_RANK.post_text).toBe(SOURCE_RANK.page_text);
    expect(SOURCE_RANK.post_read).toBe(SOURCE_RANK.site_read);
    expect(SOURCE_RANK.followers).toBeGreaterThan(SOURCE_RANK.post_read);
    expect(SOURCE_RANK.country).toBeGreaterThan(SOURCE_RANK.followers);
    expect(SOURCE_RANK.agency).toBeGreaterThan(SOURCE_RANK.country);
  });
  it("lets every real source replace the agency's zone, and never the other way round", () => {
    for (const source of ["schema.org", "profile_address", "post_text", "post_read", "followers", "country"] as const) {
      expect(replacesLocation({ source: "agency", website: null }, { source, website: null })).toBe(true);
      expect(replacesLocation({ source, website: null }, { source: "agency", website: null })).toBe(false);
    }
    expect(replacesLocation({ source: "agency", website: null }, { source: "page_footer", website: "olo.com" })).toBe(true);
  });
  it("takes a profile's address first, then addresses in posts (ZIP or street number required), then where the posts say the business is", () => {
    const followers = { zone: "America/Los_Angeles", country: "US", city: "Los Angeles", share: 0.7 };
    expect(resolveSocialLocation({ profileAddresses: [{ locality: "Austin", region: "TX", country: "US" }], postTexts: ["Visit 12 Main Street, Denver, CO 80202"], followers }))
      .toMatchObject({ timezone: "America/Chicago", source: "profile_address", country: "US", locality: "Austin" });
    expect(resolveSocialLocation({ profileAddresses: [], postTexts: ["Grand opening at 12 Main Street, Denver, CO 80202!", "Love Austin, Texas"], followers }))
      .toMatchObject({ timezone: "America/Denver", source: "post_text" });
    expect(resolveSocialLocation({ profileAddresses: [], postTexts: ["We love brands in Austin, Texas"], stated: { city: "Tel Aviv", region: null, country: "Israel" }, followers }))
      .toMatchObject({ timezone: "Asia/Jerusalem", source: "post_read", country: "IL" });
  });
  it("uses followers only when the profiles and posts state no location, and never over a stated country", () => {
    const followers = { zone: "America/Los_Angeles", country: "US", city: "Los Angeles", share: 0.6 };
    expect(resolveSocialLocation({ ...NONE, followers, countries: ["US"] })).toMatchObject({ timezone: "America/Los_Angeles", source: "followers", locality: "Los Angeles" });
    // The posts say the United States, with no state: its main zone, never the followers' city.
    expect(resolveSocialLocation({ ...NONE, stated: { city: null, region: null, country: "United States" }, followers })).toMatchObject({ timezone: "America/New_York", source: "country" });
    // Nothing stated and no city holding half the followers: the top follower country's main zone.
    expect(resolveSocialLocation({ ...NONE, followers: null, countries: ["GB"] })).toMatchObject({ timezone: "Europe/London", source: "country", country: "GB" });
  });
  it("leaves the time zone empty below every source, never UTC", () => {
    expect(resolveSocialLocation(NONE)).toMatchObject({ timezone: null, source: null });
  });
  it("lets a profile address replace page text, and never lets followers replace an address", () => {
    expect(replacesLocation({ source: "page_text", website: "olo.com" }, { source: "profile_address", website: null })).toBe(true);
    expect(replacesLocation({ source: "post_text", website: null }, { source: "followers", website: null })).toBe(false);
    expect(replacesLocation({ source: "page_footer", website: "olo.com" }, { source: "followers", website: null })).toBe(false);
    expect(replacesLocation({ source: "followers", website: null }, { source: "followers", website: null })).toBe(true);
  });
  it("keeps the site's words on a tie between the site and the posts, and a site found later replaces only what ranks lower", () => {
    expect(replacesLocation({ source: "page_text", website: "olo.com" }, { source: "post_text", website: null })).toBe(false);
    expect(replacesLocation({ source: "post_text", website: null }, { source: "page_text", website: "olo.com" })).toBe(true);
    expect(replacesLocation({ source: "profile_address", website: null }, { source: "page_text", website: "olo.com" })).toBe(false);
    expect(replacesLocation({ source: "followers", website: null }, { source: "site_read", website: "olo.com" })).toBe(true);
  });
});

describe("where the followers are", () => {
  it("reads a city as Sprout's networks write one", () => {
    expect(cityZone("Los Angeles, California, United States")).toEqual({ zone: "America/Los_Angeles", country: "US", city: "Los Angeles" });
    expect(cityZone("Austin, TX")).toEqual({ zone: "America/Chicago", country: "US", city: "Austin" });
    expect(cityZone("Tel Aviv, Israel")).toEqual({ zone: "Asia/Jerusalem", country: "IL", city: "Tel Aviv" });
    expect(cityZone("Springfield")).toBeNull();
  });
  it("takes the zone that holds half or more of the followers with a known city", () => {
    expect(followersZone([{ name: "Austin, TX", count: 30 }, { name: "Dallas, Texas, United States", count: 25 }, { name: "London, United Kingdom", count: 40 }, { name: "Nowhere", count: 900 }]))
      .toEqual({ zone: "America/Chicago", country: "US", city: "Austin", share: 0.58 });
    expect(followersZone([{ name: "Austin, TX", count: 30 }, { name: "London, United Kingdom", count: 40 }, { name: "Tel Aviv, Israel", count: 30 }])).toBeNull();
    expect(followersZone([])).toBeNull();
  });
  it("lists the business's country, then each country with 20% or more of followers, else the top one", () => {
    expect(regionsFor("US", [{ country: "GB", share: 0.5 }, { country: "US", share: 0.3 }, { country: "IL", share: 0.1 }])).toEqual(["US", "GB"]);
    expect(regionsFor(null, [{ country: "GB", share: 0.15 }, { country: "IL", share: 0.1 }])).toEqual(["GB"]);
    expect(regionsFor(null, [])).toEqual([]);
  });
});

describe("country helpers", () => {
  it("reads codes, names and aliases", () => {
    expect(countryCode("USA")).toBe("US");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("uk")).toBe("GB");
    expect(countryCode("Narnia")).toBeNull();
  });
  it("knows a zone's country and a page's language", () => {
    expect(zoneCountry("America/New_York")).toBe("US");
    expect(zoneCountry("Asia/Jerusalem")).toBe("IL");
    expect(htmlLanguage('<html lang="en-GB">')).toEqual({ language: "en", country: "GB" });
    expect(domainCountry("https://shop.co.uk")).toBe("GB");
    expect(domainCountry("https://betterbee.ai")).toBeNull();
  });
});
