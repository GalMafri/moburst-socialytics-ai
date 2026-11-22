// @vitest-environment node
// P34-01 (QA 22 Nov 2026): the same pictograph with and without its emoji variation selector
// (U+FE0F) compares differently, so a correct design fails the words check.
import { describe, expect, it } from "vitest";
import { copyMatches, readable } from "../../../functions/_shared/design/pipeline";
import { wordsOnly } from "../../../functions/_shared/design/words";

describe("P34-01 headline pictograph with or without U+FE0F", () => {
  it("a headline planned with a bare heart (kept by wordsOnly) matches the reader's emoji heart", () => {
    // options.ts keeps what wordsOnly keeps: the bare U+2764 survives into the headline.
    const headline = [wordsOnly("I ❤ Mondays")];
    // The reader names the drawn heart the usual way, with U+FE0F.
    expect(copyMatches(["I ❤️ Mondays"], headline)).toBe(true);
  });
  it("readable() treats the two spellings of one check mark alike", () => {
    expect(readable("✔ Free delivery")).toBe(readable("✔️ Free delivery"));
  });
  it("a subdivision flag leaves no invisible tag letters in the headline", () => {
    // England's flag: U+1F3F4, tag letters U+E0067.., U+E007F. The reader cannot echo invisible tags.
    const flag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    expect(copyMatches(["Go England"], [wordsOnly(`Go England ${flag}`)])).toBe(true);
  });
});
