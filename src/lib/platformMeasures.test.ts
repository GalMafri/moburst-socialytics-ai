import { describe, expect, it } from "vitest";
import { reportsMeasure } from "./platformMeasures";

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
