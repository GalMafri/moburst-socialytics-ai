import { describe, expect, it } from "vitest";
import { domainStem, summarizeLandscapes } from "../../../supabase/functions/_shared/competitive/rivaliqLandscape";

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
