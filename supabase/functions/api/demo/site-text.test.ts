import { describe, it, expect } from "vitest";
import { cleanSiteText } from "./site-text";

describe("cleanSiteText", () => {
  it("drops navigation, images, counters and repeats, and keeps the sentences", () => {
    const raw = "[My Wishlist](https://x.com/#swym-wishlist) 0\n\n[Skip to content](https://x.com/#main)\n\n![](https://x.com/logo.png)\n\n# Luxury Bedding, Sheets & Comforters Online\n\n[Shop](https://x.com/shop) [Sale](https://x.com/sale)\n\nThe internet's favorite sheets, made in family-owned mills and backed by a 365-day warranty.\n\nThe internet's favorite sheets, made in family-owned mills and backed by a 365-day warranty.\n\n- [Bundles & Savings](https://x.com/b)\n\nOur Luxe Sateen set has a [buttery feel](https://x.com/luxe) that gets softer with every wash.\n\nLoading blog feed\n";
    expect(cleanSiteText(raw).split("\n")).toEqual([
      "Luxury Bedding, Sheets & Comforters Online",
      "The internet's favorite sheets, made in family-owned mills and backed by a 365-day warranty.",
      "Our Luxe Sateen set has a buttery feel that gets softer with every wash.",
    ]);
  });
  it("returns an empty string for a page that is only chrome", () => {
    expect(cleanSiteText("[Home](/)\n[Shop](/shop)\n![](/a.png)\n0")).toBe("");
  });
});
