import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// What the Analytics page says is what the figures are, never how they are
// built, and one thing carries one label across the page.

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const page = read("pages/Analytics.tsx");
const profiles = read("components/analytics/ConnectedProfiles.tsx");
const insights = read("components/analytics/AIDeepInsights.tsx");
const all = { "Analytics.tsx": page, "ConnectedProfiles.tsx": profiles, "AIDeepInsights.tsx": insights };

describe("Analytics copy", () => {
  it("holds none of the sentences that explain how a figure is built", () => {
    for (const phrase of ["analysis run", "added up", "cover every tracked day", "not the live Sprout window"]) {
      expect(page, phrase).not.toContain(phrase);
    }
  });

  it("holds one label per thing", () => {
    for (const phrase of ["All Time", "Video Views", "Month-over-month", "Connected Profiles", "vs prev.", "prev:", "Report Date", "Eng. Rate", "Avg Sprout", "\"Previous\""]) {
      for (const [file, src] of Object.entries(all)) expect(src, `${phrase} in ${file}`).not.toContain(phrase);
    }
  });

  it("builds the period buttons from the shared labels, not 7d, 30d and 90d", () => {
    expect(page).toContain("PRESET_LABELS");
    expect(page).not.toMatch(/\{r === "all" \? "All time" : r === "custom" \? "Custom" : r\}/);
  });

  it("names the rail item after its section's title", () => {
    expect(page).not.toContain('label: "AI insights"');
    expect(page).toContain('label: "Across the reports in this window"');
    expect(insights).toContain('title="Across the reports in this window"');
    expect(page).toContain('label: "Month over month"');
    expect(page).toContain('title="Month over month"');
  });
});
