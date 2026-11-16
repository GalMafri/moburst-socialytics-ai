import { describe, expect, it } from "vitest";
import { coverageLine, networksCovered, reportsMeasure } from "./platformMeasures";

describe("the measures each network reports", () => {
  it("leaves out what a network never measures, under every name Sprout and the reports use", () => {
    for (const ig of ["Instagram", "fb_instagram_account", "instagram"]) expect(reportsMeasure(ig, "link_clicks")).toBe(false);
    expect(reportsMeasure("TikTok", "link_clicks")).toBe(false);
    expect(reportsMeasure("YouTube", "impressions")).toBe(false);
    expect(reportsMeasure("youtube", "link_clicks")).toBe(false);
  });

  it("keeps every measure a network reports, including a real zero", () => {
    for (const m of ["impressions", "reactions", "link_clicks", "video_views", "comments", "shares"]) {
      expect(reportsMeasure("Facebook", m)).toBe(true);
      expect(reportsMeasure("linkedin_company", m)).toBe(true);
      expect(reportsMeasure("X", m)).toBe(true);
    }
    for (const m of ["impressions", "reactions", "video_views", "comments", "shares"]) {
      expect(reportsMeasure("Instagram", m)).toBe(true);
      expect(reportsMeasure("TikTok", m)).toBe(true);
    }
    for (const m of ["reactions", "video_views", "comments", "shares"]) expect(reportsMeasure("YouTube", m)).toBe(true);
  });

  it("shows a measure for a network or measure it does not know", () => {
    expect(reportsMeasure("Threads", "link_clicks")).toBe(true);
    expect(reportsMeasure(null, "impressions")).toBe(true);
    expect(reportsMeasure("Instagram", "saves")).toBe(true);
  });
});

describe("the networks a headline total covers", () => {
  it("names only the networks that report the measure", () => {
    expect(networksCovered(["facebook", "youtube"], "impressions")).toEqual(["Facebook"]);
    expect(networksCovered(["fb_instagram_account", "linkedin_company", "tiktok"], "link_clicks")).toEqual(["LinkedIn"]);
    expect(networksCovered(["facebook", "facebook", "instagram"], "reactions")).toEqual(["Facebook", "Instagram"]);
  });

  it("says nothing when every network reports the measure", () => {
    expect(coverageLine(["facebook", "linkedin_company"], "impressions")).toBeNull();
    expect(coverageLine([], "impressions")).toBeNull();
  });

  it("words the line a tile shows when a network does not report", () => {
    expect(coverageLine(["facebook", "youtube"], "impressions")).toBe("Facebook only");
    expect(coverageLine(["facebook", "linkedin_company", "instagram"], "link_clicks")).toBe("Facebook and LinkedIn only");
    expect(coverageLine(["facebook", "linkedin_company", "x", "instagram"], "link_clicks")).toBe("Facebook, LinkedIn and X only");
    // No network reports it: the tile says "No data" itself, so there is no coverage to name.
    expect(coverageLine(["youtube"], "impressions")).toBeNull();
  });
});
