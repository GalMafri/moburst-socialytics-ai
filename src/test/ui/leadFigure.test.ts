import { describe, expect, it } from "vitest";
import { leadFigure } from "@/components/ui/prose";

describe("leadFigure", () => {
  it("skips the period a summary opens on and takes the first real figure", () => {
    expect(
      leadFigure("2026-07-01 to 2026-07-31 (30 days), 226 posts across 4 firms + client."),
    ).toEqual({ value: "30", unit: "days" });
  });

  it("keeps a unit word but not a preposition", () => {
    // "total" describes the count; "followers" names it.
    expect(leadFigure("Bader Law is at 14,853 total followers (+0.14% vs prior period).")).toEqual({
      value: "14,853",
      unit: "followers",
    });
    expect(leadFigure("Improved to 0.00922 from 0.00275.")).toEqual({ value: "0.00922", unit: "" });
  });

  it("keeps a percentage whole", () => {
    expect(leadFigure("Engagement rose 235% over the period.")).toEqual({ value: "235%", unit: "" });
  });

  it("ignores a bare year", () => {
    expect(leadFigure("Since 2024 the field has grown to 47 firms.")).toEqual({ value: "47", unit: "firms" });
  });

  it("is null when a passage carries no figure", () => {
    expect(leadFigure("Community and leadership content is what works here.")).toBeNull();
  });
});
