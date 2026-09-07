import { describe, expect, it } from "vitest";
import { displayCompanyName, nameWasDerived } from "../lib/companyName";

describe("displayCompanyName", () => {
  it("leaves a real name exactly as it was typed", () => {
    for (const name of ["Bader Law", "Morgan & Morgan P.A.", "TopDog Law", "LegaBot", "1X2 Network"]) {
      expect(displayCompanyName(name)).toBe(name);
    }
  });

  it("turns the domains RivalIQ stores as names back into names", () => {
    expect(displayCompanyName("reyeslaw.com")).toBe("Reyes Law");
    expect(displayCompanyName("cruzfirm.com")).toBe("Cruz Firm");
    expect(displayCompanyName("housecallpro.com")).toBe("Housecall Pro");
    expect(displayCompanyName("attorneykennugent.com/")).toBe("Attorney Kennugent");
  });

  it("copes with the shapes a pasted URL arrives in", () => {
    expect(displayCompanyName("https://www.acres.com/")).toBe("Acres");
    expect(displayCompanyName("montlick.co.uk")).toBe("Montlick");
    expect(displayCompanyName("field-pulse.com")).toBe("Field Pulse");
  });

  it("does not split a stem that is only a business word", () => {
    // "colaw" is a name, not "co law".
    expect(displayCompanyName("colaw.com")).toBe("Colaw");
  });

  it("says when it had to rebuild the name", () => {
    expect(nameWasDerived("reyeslaw.com")).toBe(true);
    expect(nameWasDerived("Bader Law")).toBe(false);
    expect(nameWasDerived("")).toBe(false);
  });
});

describe("nameifyDomains", () => {
  it("names the competitors an analysis refers to by domain", async () => {
    const { nameifyDomains } = await import("../lib/companyName");
    expect(
      nameifyDomains("Morgan & Morgan spikes at 20:00 UTC, and reyeslaw.com centers 15:00–16:00 UTC."),
    ).toBe("Morgan & Morgan spikes at 20:00 UTC, and Reyes Law centers 15:00–16:00 UTC.");
  });

  it("leaves a passage with no domains alone", async () => {
    const { nameifyDomains } = await import("../lib/companyName");
    const s = "Bader posted 54 times in-period (12.6 posts/week).";
    expect(nameifyDomains(s)).toBe(s);
  });

  it("leaves a domain it cannot improve exactly as written", async () => {
    const { nameifyDomains } = await import("../lib/companyName");
    // Nothing to split and nothing to strip beyond the TLD: "Montlick" already
    // reads as the name, so the sentence keeps whichever the analysis used.
    expect(nameifyDomains("Traffic from montlick.com rose.")).toBe("Traffic from Montlick rose.");
  });
});
