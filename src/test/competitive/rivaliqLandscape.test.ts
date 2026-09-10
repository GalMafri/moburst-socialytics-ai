import { describe, expect, it } from "vitest";
import { bestLandscapeMatch, domainStem, summarizeLandscapes } from "../../../supabase/functions/_shared/competitive/rivaliqLandscape";

const landscape = (over: any) => ({
  id: over.id ?? 1,
  name: over.name ?? "TIER 1 Competitors",
  focusCompanyId: over.focusCompanyId ?? 10,
  companies: over.companies ?? [],
});

describe("domainStem", () => {
  it("reduces a URL or a bare domain to the same stem", () => {
    expect(domainStem("https://www.Moburst.com/about")).toBe("moburst");
    expect(domainStem("Moburst.com")).toBe("moburst");
    expect(domainStem("https://baderlaw.com/")).toBe("baderlaw");
    expect(domainStem("montlick.co.uk")).toBe("montlick");
  });
  it("is empty for something that is not a domain", () => {
    expect(domainStem("Bader Law")).toBe("");
    expect(domainStem("")).toBe("");
    expect(domainStem(null)).toBe("");
  });
});

describe("summarizeLandscapes", () => {
  it("matches on the focus company's website when the names differ", () => {
    // The live failure: client "Moburst" (Moburst.com), focus company "Moburst Ltd."
    const out = summarizeLandscapes(
      [landscape({ companies: [{ id: 10, name: "Moburst Ltd.", url: "https://moburst.com/" }] })],
      "Moburst",
      "Moburst.com",
    );
    expect(out[0].is_match).toBe(true);
    expect(out[0].match_reason).toBe("focus company");
  });

  it("matches when the focus company is stored as a bare domain", () => {
    const out = summarizeLandscapes(
      [landscape({ companies: [{ id: 10, name: "mbrst", url: "https://www.moburst.com" }] })],
      "Moburst",
      "Moburst.com",
    );
    expect(out[0].is_match).toBe(true);
    expect(out[0].match_reason).toBe("website");
  });

  it("still claims a landscape where the client is tracked but is not the focus", () => {
    const out = summarizeLandscapes(
      [landscape({ focusCompanyId: 99, companies: [{ id: 99, name: "Rival Co", url: "https://rival.com" }, { id: 10, name: "Moburst", url: "https://moburst.com" }] })],
      "Moburst",
      "Moburst.com",
    );
    expect(out[0].is_match).toBe(true);
    expect(out[0].match_reason).toBe("client is in the set");
  });

  it("does not claim someone else's landscape", () => {
    const out = summarizeLandscapes(
      [landscape({ companies: [{ id: 10, name: "Bader Law", url: "https://baderlaw.com/" }] })],
      "Moburst",
      "Moburst.com",
    );
    expect(out[0].is_match).toBe(false);
    expect(out[0].match_reason).toBeNull();
  });

  it("puts the client's own landscapes first", () => {
    const out = summarizeLandscapes(
      [
        landscape({ id: 1, name: "Z others", companies: [{ id: 10, name: "Bader Law", url: "https://baderlaw.com" }] }),
        landscape({ id: 2, name: "A ours", companies: [{ id: 10, name: "Moburst", url: "https://moburst.com" }] }),
      ],
      "Moburst",
      "Moburst.com",
    );
    expect(out[0].id).toBe("2");
  });
});

describe("domainStem on modern TLDs", () => {
  it("keeps the name, not the suffix, when the TLD is longer than three characters", () => {
    // A length test used to stop at .agency and return it as the stem, so
    // every company on that TLD compared equal to every other.
    expect(domainStem("https://someshop.agency")).toBe("someshop");
    expect(domainStem("another.agency")).toBe("another");
    expect(domainStem("someshop.agency")).not.toBe(domainStem("another.agency"));
  });

  it("still strips a country-code pair", () => {
    expect(domainStem("https://www.example.co.uk/about")).toBe("example");
    expect(domainStem("example.com.au")).toBe("example");
  });

  it("still handles the ordinary case", () => {
    expect(domainStem("https://moburst.com")).toBe("moburst");
  });
});

type Summary = { id: string; is_match: boolean; match_reason: string | null };

describe("bestLandscapeMatch", () => {
  it("prefers a landscape the client is the focus of over one that merely tracks them", () => {
    // Taking the first match meant a competitor's landscape could win purely
    // on ordering, and the weekly feed would then report on somebody else.
    const picked = bestLandscapeMatch<Summary>([
      { id: "a", is_match: true, match_reason: "client is in the set" },
      { id: "b", is_match: true, match_reason: "focus company" },
    ]);
    expect(picked?.id).toBe("b");
  });

  it("falls back to the weak match when it is the only one", () => {
    const picked = bestLandscapeMatch<Summary>([{ id: "a", is_match: true, match_reason: "client is in the set" }]);
    expect(picked?.id).toBe("a");
  });

  it("returns nothing when nothing matches", () => {
    expect(bestLandscapeMatch<Summary>([{ id: "a", is_match: false, match_reason: null }])).toBeUndefined();
  });
});
