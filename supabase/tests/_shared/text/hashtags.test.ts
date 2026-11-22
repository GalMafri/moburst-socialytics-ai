import { describe, expect, it } from "vitest";
import { hashtagList } from "../../../functions/_shared/text/hashtags";

// A post's hashtags as the one shape the calendar holds (calendar_posts.hashtags
// is text[]). QA 22 Nov 2026: regenerate-post-copy answered "#a #b" and the
// calendar crashed calling .some on it (the 18 Nov TypeError).
describe("hashtagList", () => {
  it("keeps a list, dropping empty and non-text entries", () => {
    expect(hashtagList(["#fall", " #sale ", "", null, 7])).toEqual(["#fall", "#sale", "7"]);
  });

  it("splits a string on spaces and commas, as the screens already did", () => {
    expect(hashtagList("#fall #sale")).toEqual(["#fall", "#sale"]);
    expect(hashtagList("#fall, #sale,\n#cozy")).toEqual(["#fall", "#sale", "#cozy"]);
    expect(hashtagList("  ")).toEqual([]);
  });

  it("answers no hashtags for anything else", () => {
    for (const v of [undefined, null, 3, {}, true]) expect(hashtagList(v)).toEqual([]);
  });
});

describe("hashtagList, from review", () => {
  it("splits a list entry that holds several tags, and drops repeats", () => {
    expect(hashtagList(["#a #b", "#a", "#c,#b"])).toEqual(["#a", "#b", "#c"]);
    expect(hashtagList("#a #a")).toEqual(["#a"]);
  });
});
