import { describe, expect, it } from "vitest";
import { hubCompanyMatch, portalLinks, type PortalClient } from "../../../functions/_shared/lifecycle/portal";
import { clientsForCompany } from "../../../functions/_shared/auth/session";

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

// 26 Nov 2026 (Lital): Socialytics is opened from moburst.ai (companies by slug) and tools.moburst (companies by the
// Hub's name), which label companies differently. 16 of 18 clients had no Hub company name, so a client user from
// tools.moburst was given no client. The sign-in now links the client of that name once, as moburst.ai links by slug.
describe("hubCompanyMatch", () => {
  it("finds the one client named like the Hub company, or whose name gives the same slug", () => {
    expect(hubCompanyMatch([c("b", "Bader Law", "bader-law"), c("m", "Moburst", "moburst")], "bader law")).toBe("b");
    expect(hubCompanyMatch([c("p", "Pay The Pyper", "pay-the-pyper")], "Pay-The-Pyper")).toBe("p");
    expect(hubCompanyMatch([c("e", "European Wax Center", "european-wax-center")], "european-wax-center")).toBe("e");
  });
  it("never takes a client that has a Hub company name, one a person set, or guesses between two", () => {
    expect(hubCompanyMatch([c("b", "Bader Law", "bader-law", { hub_company_name: "Bader Law LLC" })], "Bader Law")).toBeNull();
    expect(hubCompanyMatch([c("b", "Bader Law", "bader-law", { field_sources: { hub_company_name: { by: "person" } } })], "Bader Law")).toBeNull();
    expect(hubCompanyMatch([c("a", "Acme", "acme"), c("b", "ACME", "acme-2")], "Acme")).toBeNull();
    expect(hubCompanyMatch([c("b", "Bader Law", "bader-law")], "")).toBeNull();
    expect(hubCompanyMatch([c("b", "Bader Law", "bader-law")], "Morgan and Morgan")).toBeNull();
  });
});

describe("a tools.moburst client user's companies", () => {
  // deno-lint-ignore no-explicit-any
  function db(rows: any[]) {
    const writes: Array<{ p_client: string; p_fields: Record<string, unknown> }> = [];
    return {
      writes,
      from: () => {
        // deno-lint-ignore no-explicit-any
        const q: any = { select: () => q, is: () => q, not: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok) };
        return q;
      },
      rpc: async (_name: string, args: { p_client: string; p_fields: Record<string, unknown> }) => {
        writes.push(args);
        return { data: { written: Object.keys(args.p_fields), skipped: [] }, error: null };
      },
    };
  }

  it("links the client of that name once, and saves the Hub company name on it", async () => {
    const d = db([{ id: "b", name: "Bader Law", company_slug: "bader-law", hub_company_name: null, field_sources: {} }]);
    expect(await clientsForCompany(d as never, "Bader Law")).toEqual(["b"]);
    expect(d.writes).toEqual([{ p_client: "b", p_fields: { hub_company_name: "Bader Law" }, p_by: "portal" }]);
  });

  it("keeps the saved match and writes nothing when a client already carries the name", async () => {
    const d = db([{ id: "b", name: "Bader Law", company_slug: "bader-law", hub_company_name: "bader law", field_sources: {} }]);
    expect(await clientsForCompany(d as never, "Bader Law")).toEqual(["b"]);
    expect(d.writes).toEqual([]);
  });

  it("gives no client, and the sign-in still goes on, when nothing fits", async () => {
    const d = db([{ id: "b", name: "Bader Law", company_slug: "bader-law", hub_company_name: null, field_sources: {} }]);
    expect(await clientsForCompany(d as never, "Unknown Co")).toEqual([]);
  });
});
