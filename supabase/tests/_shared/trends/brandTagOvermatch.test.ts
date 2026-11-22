// QA 22 Nov 2026 (P52-01): tagNamesBrand treats any hashtag that merely contains a 4+ letter brand name as the brand's own.
import { describe, it, expect } from "vitest";
import { namesBrand, tagNamesBrand } from "../../../functions/_shared/trends/profile";
import { parseRewrite } from "../../../functions/_shared/trends/coverage";

describe("P52-01 brand-name check on hashtags", () => {
  it("does not read an unrelated word that starts with the brand name as the brand", () => {
    // The phrase rule already says so (profile.ts:209: "Calm" is not found in "calming").
    expect(namesBrand("calming music", "Calm")).toBe(false);
    expect(tagNamesBrand("#calmingmusic", "Calm")).toBe(false);
    expect(tagNamesBrand("#novascotia", "Nova")).toBe(false);
  });
  it("still knows the brand's own tags", () => {
    expect(tagNamesBrand("#baderlaw", "Bader Law")).toBe(true);
    expect(tagNamesBrand("#moburstlife", "Moburst")).toBe(true);
    expect(tagNamesBrand("#teammoburst", "Moburst")).toBe(true);
    expect(tagNamesBrand("#CalmApp", "Calm")).toBe(true);
    expect(tagNamesBrand("#calm", "Calm")).toBe(true);
    expect(tagNamesBrand("#ibm", "IBM")).toBe(true);
    expect(tagNamesBrand("#ibmcloud", "IBM")).toBe(false);
  });
  it("lets the Instagram coverage rewrite keep an on-topic tag", () => {
    const got = parseRewrite(JSON.stringify({ searches: ["#calmingmusic", "#sleepsounds"] }), { platform: "instagram", brand: "Calm" });
    expect(got).toEqual({ value: ["#calmingmusic", "#sleepsounds"] });
  });
});
