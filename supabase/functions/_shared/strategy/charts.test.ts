// @vitest-environment node
// The deck's charts as SVG from fixed numbers, in the deck's tokens (the brand
// in #E5C53D, the others white at 25%), against a stored snapshot.
import { describe, expect, it } from "vitest";
import { GOLD, MUTED, mixChart, short, startChart } from "./charts";

describe("the deck's charts", () => {
  it("draws the brand against its competitors, the brand in gold", () => {
    const c = startChart({
      platform: "Instagram",
      posts: [{ name: "Acme", value: 2.4, brand: true }, { name: "BenchApp", value: 4.67, brand: false }, { name: "TeamSnap", value: 1, brand: false }],
      engagement: [{ name: "Acme", value: 42, brand: true }, { name: "BenchApp", value: 18, brand: false }],
    });
    expect(c.width).toBe(686);
    expect(c.svg).toContain(`fill="${GOLD}"`);
    expect(c.svg).toContain(`fill="${MUTED}"`);
    expect(c.svg).toMatchSnapshot();
  });

  it("draws the pillar mix, last 8 weeks against planned, and planned alone with no calendar posts", () => {
    expect(mixChart([{ name: "Beer League Truths", current: 50, planned: 60 }, { name: "Captain Life", current: 50, planned: 40 }]).svg).toMatchSnapshot();
    const alone = mixChart([{ name: "Captain Life", current: null, planned: 100 }]).svg;
    expect(alone).not.toContain("Last 8 weeks");
    expect(alone).toContain("100%");
  });

  it("writes figures short", () => {
    expect([short(4.666), short(42), short(12_400), short(1_250_000)]).toEqual(["4.7", "42", "12.4K", "1.3M"]);
  });
});
