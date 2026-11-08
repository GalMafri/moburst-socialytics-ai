// @vitest-environment node
// RivalIQ matching compares full hostnames (spec: docs/superpowers/specs/
// 2026-11-08-onboarding-profile-pages-and-no-n8n-design.md, section B): a
// client whose website is a subdomain of its own (Uproar on
// uproar.moburst.com) is never matched to the parent site's company.
import { describe, expect, it } from "vitest";
import { matchingClientCompanies, type RivalIqCompany } from "./rivaliqLandscape";

describe("matchingClientCompanies", () => {
  const moburst: RivalIqCompany = { id: 1, name: "Moburst", url: "https://moburst.com" };
  const uproar: RivalIqCompany = { id: 2, name: "Uproar", url: "https://uproar.moburst.com" };

  it("never takes the parent site's company for a client on a subdomain of its own", () => {
    expect(matchingClientCompanies([moburst], "Uproar by Moburst", "https://uproar.moburst.com/")).toEqual([]);
    expect(matchingClientCompanies([moburst, uproar], "Uproar by Moburst", "https://uproar.moburst.com/")).toEqual([uproar]);
  });
  it("matches the same host with or without www", () => {
    expect(matchingClientCompanies([moburst, uproar], "Moburst", "https://www.moburst.com/")).toEqual([moburst]);
  });
});
