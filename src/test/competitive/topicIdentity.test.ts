// A topic keeps one identity across weeks (self-serve design, 19 Oct 2026):
// the refresh prompt is given the previous windows' topics with their keys,
// a reused key is kept, and a dismissed key stays dismissed. Prompt-level
// only: no model is called. The pairs are stored examples where one theme
// got a new key the following week.

import { describe, expect, it } from "vitest";
import { knownTopics, slug, topicPrompt, topicRows, type KnownTopic } from "../../../supabase/functions/_shared/competitive/refreshFeed";

const bader: KnownTopic[] = [
  { topic_key: "attorney-personal-story-meet-the-team-spotlight", topic: "Attorney personal story / meet the team spotlight", window_start: "2026-10-03", status: "new" },
  { topic_key: "client-win-case-result-highlight", topic: "Client win / case result highlight", window_start: "2026-10-03", status: "new" },
  { topic_key: "attorney-intro-meet-the-team-profiles", topic: "Attorney intro / meet the team profiles", window_start: "2026-09-23", status: "new" },
  { topic_key: "team-staff-spotlight", topic: "Team staff spotlight", window_start: "2026-09-09", status: "new" },
  { topic_key: "labor-day-road-safety-warning", topic: "Labor Day road safety warning", window_start: "2026-09-03", status: "new" },
  { topic_key: "sports-team-partnership-activation", topic: "Sports team partnership activation", window_start: "2026-08-27", status: "dismissed" },
];

const moburst: KnownTopic[] = [
  { topic_key: "ai-s-impact-on-aso-app-discovery", topic: "AI's impact on ASO & app discovery", window_start: "2026-09-29", status: "dismissed" },
  { topic_key: "custom-product-pages-cpp-strategy", topic: "Custom product pages (CPP) strategy", window_start: "2026-09-29", status: "new" },
];

describe("topic identity across weeks", () => {
  it("offers the four previous windows' topics, one row per key", () => {
    const known = knownTopics(bader, "2026-10-10");
    expect([...new Set(known.map((k) => k.window_start))].sort()).toEqual(["2026-09-03", "2026-09-09", "2026-09-23", "2026-10-03"]);
    expect(known.map((k) => k.topic_key)).not.toContain("sports-team-partnership-activation");
  });

  it("puts the earlier topics and their keys in the prompt, and asks for a key back", () => {
    const prompt = topicPrompt("Bader Law", [], "2026-10-10", "2026-10-16", knownTopics(bader, "2026-10-10"));
    expect(prompt).toContain("attorney-personal-story-meet-the-team-spotlight: Attorney personal story / meet the team spotlight");
    expect(prompt).toContain("set \"key\" to that exact key");
    expect(prompt).toContain('"key":""');
    expect(topicPrompt("Bader Law", [], "2026-10-10", "2026-10-16", [])).not.toContain("PREVIOUS WEEKS");
  });

  it("keeps Bader's meet-the-team theme on one key (stored as two: attorney-spotlight-meet-the-team, attorney-personal-story-meet-the-team-spotlight)", () => {
    const known = knownTopics(bader, "2026-10-10");
    const rows = topicRows([{ topic: "Attorney spotlight / meet the team", key: "attorney-personal-story-meet-the-team-spotlight" }], known, new Set());
    expect(rows[0].topic_key).toBe("attorney-personal-story-meet-the-team-spotlight");
    // Without the reused key, the wording alone made a second identity for the same theme.
    expect(slug("Attorney spotlight / meet the team")).toBe("attorney-spotlight-meet-the-team");
  });

  it("keeps Moburst's AI discovery theme on one key and keeps it dismissed (stored as ai-s-impact-on-app-discovery-search)", () => {
    const known = knownTopics(moburst, "2026-10-02");
    const dismissed = new Set(moburst.filter((k) => k.status === "dismissed").map((k) => k.topic_key));
    const rows = topicRows([
      { topic: "AI's impact on app discovery & search", key: "ai-s-impact-on-aso-app-discovery" },
      { topic: "Apple Ads strategy and advanced tactics", key: "" },
    ], known, dismissed);
    expect(rows.map((r) => [r.topic_key, r.dismissed])).toEqual([
      ["ai-s-impact-on-aso-app-discovery", true],
      ["apple-ads-strategy-and-advanced-tactics", false],
    ]);
  });

  it("never trusts a key that was not offered, and keeps one topic per key in a window", () => {
    const known = knownTopics(moburst, "2026-10-02");
    const rows = topicRows([
      { topic: "Black Friday prep", key: "invented-key" },
      { topic: "CPP strategy", key: "custom-product-pages-cpp-strategy" },
      { topic: "Custom product pages", key: "custom-product-pages-cpp-strategy" },
    ], known, new Set());
    expect(rows.map((r) => r.topic_key)).toEqual(["black-friday-prep", "custom-product-pages-cpp-strategy"]);
  });
});
