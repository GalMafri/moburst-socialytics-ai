// QA 22 Nov 2026 (P52-03): the one hashtag rule has no room for combining marks (\p{M}), so Devanagari and other Indic tags are refused or turned into other words.
import { describe, it, expect } from "vitest";
import { asHashtag, HASHTAG, hashtagText } from "../../../functions/_shared/trends/hashtag";
import { hashtagCounts } from "../../../functions/_shared/trends/profile";

describe("P52-03 hashtags in scripts with vowel signs", () => {
  it("accepts a real Hindi tag", () => {
    expect(HASHTAG.test("#हिंदी")).toBe(true);
  });
  it("keeps the typed tag's word", () => {
    expect(hashtagText("#हिंदी")).toBe("हिंदी");
    expect(asHashtag("हिंदी")).toBe("#हिंदी");
  });
  it("counts the whole tag in the evidence", () => {
    expect(hashtagCounts(["#हिंदी post"])).toEqual({ "#हिंदी": 1 });
  });
});
