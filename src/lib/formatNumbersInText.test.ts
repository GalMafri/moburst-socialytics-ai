import { describe, expect, it } from "vitest";
import { formatNumbersInText } from "./display";

describe("long numbers in report text", () => {
  it("groups a long number wherever a sentence puts it", () => {
    expect(formatNumbersInText("video views climbed to 1581992, making it the clearest engine")).toBe("video views climbed to 1,581,992, making it the clearest engine");
    expect(formatNumbersInText("one post delivered 220048 impressions.")).toBe("one post delivered 220,048 impressions.");
    expect(formatNumbersInText("(12345)")).toBe("(12,345)");
  });

  it("leaves years, grouped numbers, decimals, handles, hashtags, dates, times and links alone", () => {
    for (const t of ["Q4 2026, then 2027.", "1,581,992 views", "3.14159 rate", "12345.6", "@user12345", "#tag20261", "2026-09-30", "10:00:00", "post-12345", "https://x.com/i/status/18347846872174432", "Sep 1, 2026 to Sep 30, 2026"]) {
      expect(formatNumbersInText(t)).toBe(t);
    }
  });
});
