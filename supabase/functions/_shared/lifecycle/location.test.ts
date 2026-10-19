import { describe, expect, it } from "vitest";
import { countryCode, domainCountry, htmlLanguage, replacesLocation, resolveLocation, schemaAddresses, textAddresses, zoneCountry, zoneOf } from "./location";

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
