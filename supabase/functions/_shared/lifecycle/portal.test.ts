import { describe, expect, it } from "vitest";
import { portalLinks, type PortalClient } from "./portal";

const c = (id: string, name: string, slug: string | null, over: Partial<PortalClient> = {}): PortalClient => ({ id, name, company_slug: slug, hub_company_name: null, field_sources: {}, ...over });

describe("portalLinks", () => {
  it("links a portal slug that matches no client to the client whose name gives that slug", () => {
    expect(portalLinks([c("ptp", "Pay The Pyper", null)], ["pay-the-pyper"], "Pay The Pyper")).toEqual([
      { client_id: "ptp", fields: { company_slug: "pay-the-pyper", hub_company_name: "Pay The Pyper" }, matched_by: "slug" },
    ]);
  });
  it("links by the organization name when the portal's slug is written differently", () => {
    const links = portalLinks([c("ptp", "Pay The Pyper", "pay-the-pyper", { field_sources: { company_slug: { by: "lifecycle" } } })], ["paythepyper"], "Pay the Pyper");
    expect(links).toEqual([{ client_id: "ptp", fields: { company_slug: "paythepyper", hub_company_name: "Pay the Pyper" }, matched_by: "organization" }]);
  });
  it("never moves a slug a person set, and never guesses between two clients", () => {
    expect(portalLinks([c("a", "Pay The Pyper", "ptp-custom", { field_sources: { company_slug: { by: "person" } } })], ["paythepyper"], "Pay The Pyper")).toEqual([]);
    expect(portalLinks([c("a", "Acme", null), c("b", "ACME", null)], ["acme"], null)).toEqual([]);
  });
  it("only names the hub company of a client that has none, for a user with one company", () => {
    expect(portalLinks([c("b", "Bader Law", "bader-law")], ["bader-law"], "Bader Law LLC")).toEqual([{ client_id: "b", fields: { hub_company_name: "Bader Law LLC" }, matched_by: "existing" }]);
    expect(portalLinks([c("b", "Bader Law", "bader-law", { hub_company_name: "Bader Law" })], ["bader-law"], "Bader Law LLC")).toEqual([]);
    expect(portalLinks([c("b", "Bader Law", "bader-law"), c("m", "Moburst", "moburst")], ["bader-law", "moburst"], "Moburst")).toEqual([]);
  });
});
