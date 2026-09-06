import { describe, expect, it } from "vitest";
import { groupSentences, reflowParagraph, splitSentences } from "@/lib/prose";

const EXEC_SUMMARY =
  "Period analyzed: 2026-08-01 to 2026-08-31 (30 days), 177 posts. Bader Law published 31 posts " +
  "(7.2/week) across Facebook (11; 35%), Instagram (8; 26%), YouTube (7; 23%), TikTok (5; 16%). " +
  "Versus July, Bader's total posts fell 42.6% (54→31), engagement fell 35.6% (320→206), and " +
  "estimated impressions fell 25.4% (21,589→16,115), while engagement rate per post improved " +
  "+14.3% (0.00135→0.00154). Confirmed competitors outpaced Bader on scale and/or cadence: TopDog " +
  "Law had 682,533 followers (+0.3% MoM) and 39 posts. The largest performance gap is " +
  "reach/impressions scale (e.g. TopDog reach 11.77M vs Bader reach 133.6K) and repeatable formats.";

describe("splitSentences", () => {
  it("splits on sentence ends", () => {
    expect(splitSentences("One thing happened. Another followed. A third closed it.")).toEqual([
      "One thing happened.",
      "Another followed.",
      "A third closed it.",
    ]);
  });

  it("keeps decimals and ratios whole", () => {
    expect(splitSentences("Rate moved 0.00135 to 0.00154 this month.")).toEqual([
      "Rate moved 0.00135 to 0.00154 this month.",
    ]);
  });

  it("does not break on abbreviations", () => {
    expect(splitSentences("Formats win, e.g. TopDog reels. Bader posts less.")).toEqual([
      "Formats win, e.g. TopDog reels.",
      "Bader posts less.",
    ]);
    expect(splitSentences("Compare vs. Bader across the set.")).toHaveLength(1);
    expect(splitSentences("Reach in the U.S. Market share held.")).toEqual([
      "Reach in the U.S. Market share held.",
    ]);
  });

  it("does not break mid-clock or mid-percentage", () => {
    expect(splitSentences("Posting peaks at 18:00 UTC (17/31 posts; 55%) every week.")).toHaveLength(1);
  });

  it("loses no characters", () => {
    const joined = splitSentences(EXEC_SUMMARY).join(" ");
    expect(joined.replace(/\s+/g, " ")).toBe(EXEC_SUMMARY.replace(/\s+/g, " "));
  });
});

describe("groupSentences", () => {
  it("gathers sentences up to the target length", () => {
    const groups = groupSentences(["a".repeat(200) + ".", "b".repeat(200) + ".", "c".repeat(200) + "."], 260);
    expect(groups).toHaveLength(2);
  });

  it("appends a short remainder rather than stranding it", () => {
    const groups = groupSentences(["a".repeat(300) + ".", "Short tail."], 260);
    expect(groups).toHaveLength(1);
    expect(groups[0].endsWith("Short tail.")).toBe(true);
  });
});

describe("reflowParagraph", () => {
  it("leaves short paragraphs untouched", () => {
    expect(reflowParagraph("A brief note about the month.")).toEqual(["A brief note about the month."]);
  });

  it("leaves a long paragraph with too few sentences untouched", () => {
    const oneSentence = "The " + "very ".repeat(120) + "long clause runs on without a full stop";
    expect(reflowParagraph(oneSentence)).toEqual([oneSentence]);
  });

  it("breaks a long summary into several blocks and keeps every word", () => {
    const blocks = reflowParagraph(EXEC_SUMMARY);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.join(" ").replace(/\s+/g, " ")).toBe(EXEC_SUMMARY.replace(/\s+/g, " "));
  });
});
