import { describe, it, expect } from "vitest";
import { evidenceSentence, reasonLabel, wordReason, type EvidenceRef } from "./reasonText";

const OWN: EvidenceRef = { id: "P1", kind: "own", text: "Our playoff checklist", platform: "Instagram", format: "carousel", date: "2026-10-05", metric: "impressions", multiple: 2.7, sample: 12 };
const RIVAL: EvidenceRef = { id: "C1", kind: "competitor", text: "Captain meme", company: "BenchApp", platform: "Instagram", format: "video", date: "2026-10-14", metric: "engagement per follower", multiple: 4, thin: true };
const TREND: EvidenceRef = { id: "N5", kind: "trend", text: "Carousel education can support clicks: Publish 1 carousel weekly." };
/** A trend from a weekly theme (Trends redesign): the theme, and the example post that shows it. */
const THEME_TREND: EvidenceRef = {
  id: "N1", kind: "trend", text: "POV: you are the captain", theme: "Captain POV skits", company: "@benchpro", platform: "TikTok", format: "short_video",
  date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 5400,
};

describe("evidenceSentence", () => {
  it("puts each kind of evidence in words with its real numbers", () => {
    expect(evidenceSentence(OWN)).toBe("Your Instagram carousel from Oct 5 got 2.7x your usual impressions");
    expect(evidenceSentence(RIVAL)).toBe("BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower");
    expect(evidenceSentence({ id: "T1", kind: "topic", text: "Playoff scheduling: reminders", companies: 2 })).toBe("2 competitors posted about Playoff scheduling this week");
    expect(evidenceSentence(TREND)).toBe("Trend from the monthly report: Carousel education can support clicks");
    expect(evidenceSentence({ id: "R1", kind: "report", text: "LinkedIn drove 464 of 465 clicks. More detail." })).toBe("From the monthly report: LinkedIn drove 464 of 465 clicks");
  });

  it("words a theme's example post as inspiration, with its author, platform, format and date", () => {
    expect(evidenceSentence(THEME_TREND)).toBe('Inspired by "Captain POV skits": @benchpro\'s TikTok short video from Oct 14');
    expect(evidenceSentence({ ...THEME_TREND, format: "long_video", platform: "YouTube" })).toBe('Inspired by "Captain POV skits": @benchpro\'s YouTube long video from Oct 14');
    expect(evidenceSentence({ ...THEME_TREND, format: "pin", platform: "Pinterest" })).toContain("Pinterest pin from Oct 14");
    expect(evidenceSentence({ ...THEME_TREND, format: "carousel" })).toContain("TikTok carousel from");
  });

  it("leaves out what a theme's example doesn't have: no date, no author", () => {
    expect(evidenceSentence({ ...THEME_TREND, date: undefined })).toBe('Inspired by "Captain POV skits": @benchpro\'s TikTok short video');
    expect(evidenceSentence({ ...THEME_TREND, company: undefined })).toBe('Inspired by "Captain POV skits": TikTok short video from Oct 14');
  });
});

/** A dated moment the judge kept (moments.ts), with the client's own post on it last year. */
const MOMENT: EvidenceRef = {
  id: "M1", kind: "moment", text: "Halloween", key: "us:halloween", category: "cultural_commercial", date: "2026-10-31", link: "https://www.timeanddate.com/holidays/us/halloween",
  fit: "Costume reels are where your followers already show up.", platform: "Instagram", format: "reel", metric: "engagement", value: 23, median: 10, multiple: 2.3, sample: 8,
};
const BARE_MOMENT: EvidenceRef = { id: "M2", kind: "moment", text: "World Kindness Day", key: "global:world-kindness-day", category: "awareness_day", date: "2026-11-13", link: "https://x.test/k", fit: "Kindness is part of your team culture." };

describe("a moment's reason", () => {
  it("names the moment and its date from the evidence, then the client's own post on it last year", () => {
    expect(evidenceSentence(MOMENT)).toBe("Halloween, Oct 31. Your Instagram reel for it last year got 2.3x your usual engagement");
  });

  it("gives the competitors who posted about it, or the moment alone, when the client has no post from last year", () => {
    expect(evidenceSentence({ ...BARE_MOMENT, companies: 3 })).toBe("World Kindness Day, Nov 13. 3 competitors posted about it");
    expect(evidenceSentence({ ...BARE_MOMENT, companies: 1 })).toBe("World Kindness Day, Nov 13. A competitor posted about it");
    expect(evidenceSentence(BARE_MOMENT)).toBe("World Kindness Day, Nov 13");
  });

  it("reads as the evidence, then the judge's sentence, with no ids, and an early signal when last year's numbers are thin", () => {
    expect(reasonLabel({ type: "seasonal", evidence: [MOMENT], fit: MOMENT.fit }))
      .toBe("Halloween, Oct 31. Your Instagram reel for it last year got 2.3x your usual engagement. Costume reels are where your followers already show up.");
    expect(reasonLabel({ type: "seasonal", evidence: [{ ...MOMENT, thin: true }], fit: MOMENT.fit })).toMatch(/ Early signal\.$/);
    expect(reasonLabel({ type: "seasonal", evidence: [BARE_MOMENT], fit: "M2 fits the team." })).toBe("World Kindness Day, Nov 13.");
    expect(wordReason({ type: "seasonal", label: "Old", fit: BARE_MOMENT.fit, evidence: [BARE_MOMENT], test: false })).toBe("World Kindness Day, Nov 13. Kindness is part of your team culture.");
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
    expect(wordReason({ type: "trend", label: "Old", fit: "Captains live this every week.", evidence: [THEME_TREND] }))
      .toBe('Inspired by "Captain POV skits": @benchpro\'s TikTok short video from Oct 14. Captains live this every week.');
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
