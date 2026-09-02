import { describe, it, expect } from "vitest";
import {
  companyToHandles,
  summarizeLandscapes,
} from "../../../supabase/functions/_shared/competitive/rivaliqLandscape";

const bader = {
  id: 1916178, name: "Bader Law", url: "https://baderlaw.com/",
  twitter: { handle: "baderscottlaw", url: "https://twitter.com/baderscottlaw" },
  instagram: { handle: "baderlawllc", url: "https://instagram.com/baderlawllc" },
  tikTok: { handle: "baderlawllc", url: "https://www.tiktok.com/baderlawllc" },
  youTube: { url: "https://www.youtube.com/channel/UCdoYEfeglHyYbIhOgQYK2Eg", nativeId: "UCdoYEfeglHyYbIhOgQYK2Eg" },
};
const montlick = { id: 1955974, name: "Montlick", url: "https://www.montlick.com/", facebook: { handle: "montlicklaw", url: "https://facebook.com/1" } };

describe("companyToHandles", () => {
  it("maps RivalIQ social objects to app platforms, twitter→x, youtube→channel id", () => {
    const h = companyToHandles(bader);
    expect(h).toContainEqual({ platform: "x", handle: "baderscottlaw", profile_url: "https://twitter.com/baderscottlaw" });
    expect(h).toContainEqual({ platform: "tiktok", handle: "baderlawllc", profile_url: "https://www.tiktok.com/baderlawllc" });
    expect(h.find((x) => x.platform === "youtube")?.handle).toBe("UCdoYEfeglHyYbIhOgQYK2Eg");
    expect(h.find((x) => x.platform === "facebook")).toBeUndefined();
  });
});

describe("summarizeLandscapes", () => {
  const landscapes = [
    { id: 612909, name: "Subliy", focusCompanyId: 1, companies: [{ id: 1, name: "Jobber" }] },
    { id: 587596, name: "TIER 1 Competitors", focusCompanyId: 1916178, companies: [bader, montlick] },
  ];

  it("matches a client through the focus company, not the landscape name", () => {
    const out = summarizeLandscapes(landscapes, "Bader Law");
    expect(out[0].id).toBe("587596");
    expect(out[0].is_match).toBe(true);
    expect(out[0].focus_company).toBe("Bader Law");
    expect(out[1].is_match).toBe(false);
  });

  it("marks the focus company and carries handles per company", () => {
    const tier1 = summarizeLandscapes(landscapes, "Bader Law")[0];
    expect(tier1.companies.find((c) => c.name === "Bader Law")?.is_focus).toBe(true);
    expect(tier1.companies.find((c) => c.name === "Montlick")?.handles).toEqual([
      { platform: "facebook", handle: "montlicklaw", profile_url: "https://facebook.com/1" },
    ]);
  });
});
