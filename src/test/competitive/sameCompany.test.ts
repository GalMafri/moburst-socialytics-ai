import { describe, expect, it } from "vitest";
import { sameCompany } from "@/lib/competitiveChanges";

describe("sameCompany", () => {
  it("does not call a competitor the client just because one name contains the other", () => {
    // The old test was `a.includes(b) || b.includes(a)`, which moved a
    // competitor's posts into the client's own row and inflated its share.
    expect(sameCompany("Bader Law", "Bader")).toBe(false);
    expect(sameCompany("Grow Your Content", "Grow")).toBe(false);
    expect(sameCompany("TopDog Law", "Dog Law")).toBe(false);
  });

  it("still matches one company written two ways", () => {
    // Legal suffixes and punctuation are noise, and RivalIQ carries them
    // inconsistently against the client name typed in Client Setup.
    expect(sameCompany("Bader Law, LLC", "Bader Law")).toBe(true);
    expect(sameCompany("moburst ltd", "Moburst")).toBe(true);
    expect(sameCompany("Reyes Law Group", "Reyes Law")).toBe(true);
  });

  it("errs towards leaving a competitor a competitor", () => {
    // Anything it cannot resolve stays separate, which costs a row in the
    // table; the other direction loses the client's own posts.
    expect(sameCompany("Morgan & Morgan P.A.", "Morgan and Morgan")).toBe(false);
    expect(sameCompany("TopDog Law", "Bader Law")).toBe(false);
    expect(sameCompany("", "Bader Law")).toBe(false);
  });
});
