import { describe, expect, it } from "vitest";
import { NAME_MIN_CHARS, listedNames, plainDisplayName, plainNames, storedNames } from "../../../functions/_shared/text/displayName";

// Copy sources, 17 Nov 2026: a mention in a post arrives as the display name
// the network shows, decorations and all. Every brand here is invented.

describe("plainDisplayName", () => {
  it("removes stars and emoji", () => {
    expect(plainDisplayName("Dana Reed ★★★★★")).toBe("Dana Reed");
    expect(plainDisplayName("✨ Harbor Wax ✨")).toBe("Harbor Wax");
    expect(plainDisplayName("Northwind Law ⚖️")).toBe("Northwind Law");
    expect(plainDisplayName("Harbor Wax™")).toBe("Harbor Wax");
  });

  it("removes every kind of decoration: dingbats, arrows, box characters, trademark marks, flags and skin tones", () => {
    expect(plainDisplayName("➤ Harbor Wax ✔")).toBe("Harbor Wax");
    expect(plainDisplayName("Harbor Wax → ← ⇒")).toBe("Harbor Wax");
    expect(plainDisplayName("▓▒░ Harbor Wax ░▒▓")).toBe("Harbor Wax");
    expect(plainDisplayName("┃ Harbor Wax ┃")).toBe("Harbor Wax");
    expect(plainDisplayName("Harbor Wax® ©")).toBe("Harbor Wax");
    expect(plainDisplayName("Harbor Wax 🇺🇸")).toBe("Harbor Wax");
    expect(plainDisplayName("Dana Reed 👋🏽")).toBe("Dana Reed");
    expect(plainDisplayName("Dana Reed 👩‍⚖️")).toBe("Dana Reed");
  });

  // A symbol that is part of a name is not decoration.
  it("keeps the symbols a name is written with: mathematical, currency and the like", () => {
    for (const name of ["A+ Tutoring", "Dollar$ave", "C++ Academy", "Twenty/20 = Vision", "€uro Lane", "£ane & Pence", "Under <30> Club", "Studio 360°", "Ca$h ¢ents", "Pro^2 Labs", "Nº1 Movers", "№ 7 Bakery", "50% Off Outlet", "Reed & Okafor", "Reed #1 Realty", "@home Stays", "Tilde~Works"]) {
      expect(plainDisplayName(name)).toBe(name);
    }
    expect(listedNames(["A+ Tutoring", "Dollar$ave", "C++ Academy", "Studio 360°"].map((name) => ({ name })))).toEqual([]);
  });

  it("removes only the decoration from a name that has both", () => {
    expect(plainDisplayName("A+ Tutoring ★★★★★")).toBe("A+ Tutoring");
    expect(plainDisplayName("⭐ Dollar$ave ⭐")).toBe("Dollar$ave");
  });

  // A name is shortened only when the short form is known to be the name.
  it("keeps the whole display name when nothing says the part before a separator is the name", () => {
    expect(plainDisplayName("Smith - Jones Law")).toBe("Smith - Jones Law");
    expect(plainDisplayName("Smith | Jones")).toBe("Smith | Jones");
    expect(plainDisplayName("Smith – Jones — Partners")).toBe("Smith – Jones — Partners");
    expect(plainDisplayName("Northwind Law - Trial Lawyers ★")).toBe("Northwind Law - Trial Lawyers");
    // A known name that is not the part before the separator changes nothing.
    expect(plainDisplayName("Smith - Jones Law", ["Jones Law", "Smith Jones Law", "Harbor Wax"])).toBe("Smith - Jones Law");
    expect(plainDisplayName("Smith - Jones Law", [null, undefined, ""])).toBe("Smith - Jones Law");
  });

  it("cuts the tagline when the part before the separator is a known name, whatever the separator", () => {
    const known = ["Northwind Law"];
    expect(plainDisplayName("Northwind Law - Trial Lawyers", known)).toBe("Northwind Law");
    expect(plainDisplayName("Northwind Law | trial lawyers", known)).toBe("Northwind Law");
    expect(plainDisplayName("Northwind Law – Trial Lawyers", known)).toBe("Northwind Law");
    expect(plainDisplayName("Northwind Law — Trial Lawyers", known)).toBe("Northwind Law");
    expect(plainDisplayName("★ Northwind Law ★ - Trial Lawyers", known)).toBe("Northwind Law");
    // Known by the name rule: case, punctuation and a trailing LLC are the same name.
    expect(plainDisplayName("NORTHWIND LAW, LLC - Trial Lawyers", known)).toBe("NORTHWIND LAW, LLC");
    // The short form has to be the known name, not hold it.
    expect(plainDisplayName("Northwind Law Riverside - Trial Lawyers", known)).toBe("Northwind Law Riverside - Trial Lawyers");
    expect(plainDisplayName("Law - Trial Lawyers", known)).toBe("Law - Trial Lawyers");
    // Only the first separator is looked at: "Northwind" alone is not the known name.
    expect(plainDisplayName("Northwind - Law - Trial Lawyers", known)).toBe("Northwind - Law - Trial Lawyers");
    // A dash inside a word is part of the name.
    expect(plainDisplayName("Reed-Okafor Partners", ["Reed"])).toBe("Reed-Okafor Partners");
  });

  it("keeps parentheses: a location in brackets is part of the name", () => {
    expect(plainDisplayName("Harbor Wax (Lakeside)", ["Harbor Wax"])).toBe("Harbor Wax (Lakeside)");
    expect(plainDisplayName("Harbor Wax (Lakeside) ★")).toBe("Harbor Wax (Lakeside)");
  });

  it("collapses spaces and trims what a removed decoration leaves behind", () => {
    expect(plainDisplayName("  Dana   Reed ·  ")).toBe("Dana Reed");
    expect(plainDisplayName("Dana Reed, ★")).toBe("Dana Reed");
    expect(plainDisplayName(null)).toBe("");
    expect(plainDisplayName(undefined)).toBe("");
  });
});

describe("listedNames", () => {
  it("lists only names that carry a decoration, each once, with its plain form", () => {
    expect(listedNames([{ name: "Northwind Law" }, { name: "Dana Reed ★★★★★" }, { name: " Dana Reed ★★★★★ " }, { name: "Harbor Wax (Lakeside)" }, { name: null }, { name: undefined }, { name: "" }]))
      .toEqual([{ name: "Dana Reed ★★★★★", plain: "Dana Reed" }]);
  });

  it("lists a name with a tagline only when its short form is known, and never one that is a name as it stands", () => {
    expect(listedNames([
      { name: "Northwind Law - Trial Lawyers", known: ["Northwind Law"] },
      { name: "Smith - Jones Law", known: ["Smith Jones Law"] },
      { name: "Harbor Wax | Smooth Skin Studio" },
    ])).toEqual([{ name: "Northwind Law - Trial Lawyers", plain: "Northwind Law" }]);
  });

  it("lists the longest first, so a longer name is replaced before a shorter one inside it", () => {
    expect(listedNames([{ name: "Harbor Wax ★" }, { name: "Harbor Wax ★ (Lakeside) ✨" }, { name: "Dana Reed ★★★★★" }]).map((n) => n.name)).toEqual(["Harbor Wax ★ (Lakeside) ✨", "Dana Reed ★★★★★", "Harbor Wax ★"]);
  });

  it("keeps the short form when one owner of the name knows it", () => {
    expect(listedNames([{ name: "Northwind Law ★ - Trial Lawyers" }, { name: "Northwind Law ★ - Trial Lawyers", known: ["Northwind Law"] }])).toEqual([{ name: "Northwind Law ★ - Trial Lawyers", plain: "Northwind Law" }]);
  });

  it("does not list a name made only of symbols, or one whose plain form is too short to search for", () => {
    expect(NAME_MIN_CHARS).toBe(3);
    expect(listedNames([{ name: "★★★★★" }, { name: "🔥🔥" }, { name: "AB ★" }, { name: "ABC ★" }])).toEqual([{ name: "ABC ★", plain: "ABC" }]);
  });

  it("keeps at most 200", () => {
    expect(listedNames(Array.from({ length: 260 }, (_, i) => ({ name: `Brand ${i} ★` })))).toHaveLength(200);
  });

  it("reads back from storage only pairs of two texts", () => {
    expect(storedNames([{ name: "Dana Reed ★", plain: "Dana Reed" }, "Dana Reed ★", { name: "x" }, { name: 3, plain: "y" }, null, { name: "", plain: "z" }])).toEqual([{ name: "Dana Reed ★", plain: "Dana Reed" }]);
    expect(storedNames("x")).toEqual([]);
    expect(storedNames(undefined)).toEqual([]);
  });
});

describe("plainNames", () => {
  const listed = listedNames([{ name: "Dana Reed ★★★★★" }, { name: "Northwind Law - Trial Lawyers", known: ["Northwind Law"] }, { name: "Harbor Wax ★" }, { name: "Harbor Wax ★ (Lakeside)" }, { name: "A+ Tutoring ★★★★★" }]);

  it("writes each listed name plainly, exactly and case-sensitively", () => {
    expect(plainNames("Congrats to Dana Reed ★★★★★ on joining Northwind Law - Trial Lawyers!", listed)).toBe("Congrats to Dana Reed on joining Northwind Law!");
    // Another case is another string: only the listed spelling is a listed name.
    expect(plainNames("congrats to dana reed ★★★★★", listed)).toBe("congrats to dana reed ★★★★★");
    expect(plainNames("Thanks, A+ Tutoring ★★★★★! 2 + 2 = 4, and A+ Tutoring agrees.", listed)).toBe("Thanks, A+ Tutoring! 2 + 2 = 4, and A+ Tutoring agrees.");
  });

  it("leaves a name with a separator alone when its short form is not known", () => {
    const whole = listedNames([{ name: "Smith - Jones Law ★" }]);
    expect(whole).toEqual([{ name: "Smith - Jones Law ★", plain: "Smith - Jones Law" }]);
    expect(plainNames("Thank you, Smith - Jones Law ★.", whole)).toBe("Thank you, Smith - Jones Law.");
  });

  it("replaces the longer name first", () => {
    expect(plainNames("Open today: Harbor Wax ★ (Lakeside).", listed)).toBe("Open today: Harbor Wax (Lakeside).");
    expect(plainNames("Open today: Harbor Wax ★.", listed)).toBe("Open today: Harbor Wax.");
  });

  it("returns text that holds none of them unchanged, as the same string", () => {
    const text = "Dana Reed joined Northwind Law ★ this week.";
    expect(plainNames(text, listed)).toBe(text);
    expect(plainNames(text, [])).toBe(text);
    // Symbols nobody listed stay: only Sprout's listed names are rewritten.
    expect(plainNames("Five stars ★★★★★ from a client", listed)).toBe("Five stars ★★★★★ from a client");
  });
});
