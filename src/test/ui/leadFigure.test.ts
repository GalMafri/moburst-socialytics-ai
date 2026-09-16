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

describe("leadFigure on scientific notation", () => {
  it("reads the whole number rather than the mantissa", () => {
    // Seen live on a client report: "Scale: 6.83e5 followers makes TopDog Law
    // the reach leader" was rendered as the headline figure "6.83".
    expect(leadFigure("6.83e5 followers makes TopDog Law the reach leader.")).toEqual({
      value: "683,000",
      unit: "followers",
    });
  });

  it("handles a negative exponent without inventing a figure", () => {
    expect(leadFigure("1.2e-2 of the field.")).toEqual({ value: "0.012", unit: "" });
  });

  it("leaves ordinary numbers alone", () => {
    expect(leadFigure("167 posts puts Morgan & Morgan P.A. at the highest output.")).toEqual({
      value: "167",
      unit: "posts",
    });
  });
});
