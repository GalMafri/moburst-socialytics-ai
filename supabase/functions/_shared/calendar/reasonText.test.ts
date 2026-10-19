import { describe, it, expect } from "vitest";
import { evidenceSentence, reasonLabel, wordReason, type EvidenceRef } from "./reasonText";

const OWN: EvidenceRef = { id: "P1", kind: "own", text: "Our playoff checklist", platform: "Instagram", format: "carousel", date: "2026-10-05", metric: "impressions", multiple: 2.7, sample: 12 };
const RIVAL: EvidenceRef = { id: "C1", kind: "competitor", text: "Captain meme", company: "BenchApp", platform: "Instagram", format: "video", date: "2026-10-14", metric: "engagement per follower", multiple: 4, thin: true };
const TREND: EvidenceRef = { id: "N5", kind: "trend", text: "Carousel education can support clicks: Publish 1 carousel weekly." };

describe("evidenceSentence", () => {
  it("puts each kind of evidence in words with its real numbers", () => {
    expect(evidenceSentence(OWN)).toBe("Your Instagram carousel from Oct 5 got 2.7x your usual impressions");
    expect(evidenceSentence(RIVAL)).toBe("BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower");
    expect(evidenceSentence({ id: "T1", kind: "topic", text: "Playoff scheduling: reminders", companies: 2 })).toBe("2 competitors posted about Playoff scheduling this week");
    expect(evidenceSentence(TREND)).toBe("Trend from the monthly report: Carousel education can support clicks");
    expect(evidenceSentence({ id: "R1", kind: "report", text: "LinkedIn drove 464 of 465 clicks. More detail." })).toBe("From the monthly report: LinkedIn drove 464 of 465 clicks");
  });
});

describe("reasonLabel", () => {
  it("adds the test mark, the fit and the early-signal note", () => {
    expect(reasonLabel({ type: "competitor", evidence: [RIVAL], fit: "Captains live this every week. Another note.", test: true }))
      .toBe("Test: BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower. Captains live this every week. Early signal.");
  });

  it("falls back to the moment, then to the pillars", () => {
    expect(reasonLabel({ type: "seasonal", moment: "Halloween on Oct 31" })).toBe("Halloween on Oct 31.");
    expect(reasonLabel({ type: "seasonal" })).toBe("A dated moment this week.");
    expect(reasonLabel({ type: "performance", fit: "Fits the team." })).toBe("Planned from your content pillars. Fits the team.");
  });
});

describe("wordReason", () => {
  it("words a week plan's reason from its parts, whatever label it was saved with", () => {
    expect(wordReason({ type: "trend", label: "Old long label with N5 in it.", fit: "Pairs a hook with share asks, which R4 found works.", evidence: [TREND] }))
      .toBe("Trend from the monthly report: Carousel education can support clicks.");
    expect(wordReason({ type: "test", label: "Old", evidence: [OWN] })).toBe("Test: Your Instagram carousel from Oct 5 got 2.7x your usual impressions.");
    expect(wordReason({ type: "seasonal", label: "Old", moment: "Halloween on Oct 31", fit: "Fits the team.", test: false })).toBe("Halloween on Oct 31. Fits the team.");
  });

  it("shows the saved label for reasons that don't carry their parts", () => {
    expect(wordReason({ type: "idea", label: "From the competitor feed" })).toBe("From the competitor feed");
    // A seasonal reason from before the parts were kept: its label is all there is.
    expect(wordReason({ type: "seasonal", label: "Halloween on Oct 31. Fits the team.", fit: "Fits the team." })).toBe("Halloween on Oct 31. Fits the team.");
    expect(wordReason(null)).toBe("");
  });
});
