import { describe, expect, it } from "vitest";
import { briefFromStrategyDoc, isGenericPillars, trimBrief } from "./pillars";
import { fakeDb } from "../lifecycle/fakeDb";

describe("briefFromStrategyDoc", () => {
  it("takes a text document's own words, without a model call", async () => {
    const db = fakeDb();
    db.uploads.set("brand-books/acme/strategy.md", "# Acme strategy\n\nAcme makes   rec league scheduling simple for captains across North America.\n\n\n\nVoice: confident, direct.");
    // No AI key: a text document never needs one.
    expect(await briefFromStrategyDoc(db, "acme/strategy.md", null)).toEqual({ text: "# Acme strategy\n\nAcme makes rec league scheduling simple for captains across North America.\n\nVoice: confident, direct.", via: "text" });
  });
  it("answers null for a document it cannot read here, and needs the AI connection for a PDF", async () => {
    const db = fakeDb();
    db.uploads.set("brand-books/acme/strategy.docx", "PK");
    expect(await briefFromStrategyDoc(db, "acme/strategy.docx", null)).toBeNull();
    expect(await briefFromStrategyDoc(db, "acme/missing.pdf", null)).toBeNull();
    db.uploads.set("brand-books/acme/strategy.pdf", "%PDF-1.7");
    await expect(briefFromStrategyDoc(db, "acme/strategy.pdf", null)).rejects.toThrow(/not configured/);
  });
});

describe("trimBrief", () => {
  it("cuts a long brief at the last paragraph that fits", () => {
    const text = `${"First paragraph sentence. ".repeat(10).trim()}\n\n${"Second paragraph sentence. ".repeat(10).trim()}`;
    const cut = trimBrief(text, 400);
    expect(cut).toBe("First paragraph sentence. ".repeat(10).trim());
    expect(trimBrief("Short.", 400)).toBe("Short.");
  });
});

describe("isGenericPillars", () => {
  it("counts the five generic pillars with no descriptions as none", () => {
    expect(isGenericPillars(["Thought Leadership", "Product Education", "Client Wins", "Industry Trends", "Team Culture"].map((name) => ({ name, description: "" })))).toBe(true);
    expect(isGenericPillars([{ name: "Thought Leadership", description: "Our CEO's takes" }, { name: "Product Education" }, { name: "Client Wins" }, { name: "Industry Trends" }, { name: "Team Culture" }])).toBe(false);
    expect(isGenericPillars([])).toBe(true);
  });
});
