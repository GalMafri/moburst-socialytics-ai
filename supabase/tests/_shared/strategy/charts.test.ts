// @vitest-environment node
// The deck's charts as SVG from fixed numbers, in the deck's tokens (the brand
// in #E5C53D, the others white at 25%), against a stored snapshot.
import { describe, expect, it } from "vitest";
import { GOLD, MUTED, mixChart, short, startChart } from "../../../functions/_shared/strategy/charts";

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

  // Moburst's deck of 8 Nov 2026 cut five long pillar names to "Moburst -
  // Service Spotlig…" and set them edge to edge.
  it("wraps a long pillar name onto more lines within its column, never cutting it, and keeps the chart's shape", () => {
    const measure = (text: string, size: number) => text.length * 0.55 * size;
    const names = ["Moburst - Service Spotlight & Company Impact", "Innovation in Execution - AI & Technology", "Victory Vault - Case Studies & Wins", "Visionary Voices - Thought Leadership", "Inside Moburst - Culture & Careers"];
    const c = mixChart(names.map((name, i) => ({ name, current: [23, 18, 10, 41, 5][i], planned: [20, 20, 20, 35, 5][i] })), 2, measure);
    expect(c.svg).not.toContain("…");
    expect(c.svg).toContain(`width="1292" height="156"`);
    const column = 1292 / names.length;
    const labels = [...c.svg.matchAll(/<text[^>]*font-weight="500"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    expect(labels.join(" ").split(" ").filter(Boolean)).toEqual(names.join(" ").split(" "));
    expect(labels.every((l) => measure(l, 20) <= column - 16)).toBe(true);
    expect(labels.length).toBeGreaterThan(names.length);
    // The largest share's bar reaches the top of the bars' room, so the bars keep their height when the names take more lines.
    const bars = [...c.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="36" height="([\d.]+)"/g)].map((m) => ({ y: Number(m[1]), h: Number(m[2]) }));
    const tallest = bars.reduce((a, b) => (b.h > a.h ? b : a));
    expect(tallest.y).toBe(32);
    expect(tallest.h).toBeGreaterThan((41 / 100) * 88);
  });

  it("writes figures short", () => {
    expect([short(4.666), short(42), short(12_400), short(1_250_000)]).toEqual(["4.7", "42", "12.4K", "1.3M"]);
  });
});
