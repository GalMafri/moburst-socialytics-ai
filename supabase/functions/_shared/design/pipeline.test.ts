import { describe, it, expect } from "vitest";
import { copyMatches, parseRead, readable } from "./pipeline";

describe("copyMatches", () => {
  it("accepts the headline set in capitals, with typographic apostrophes, over any line breaks", () => {
    expect(copyMatches(["THE NEXT LEAGUE WON’T BE MANAGED.", "IT’LL BE COMPUTED."], ["THE NEXT LEAGUE WON'T BE MANAGED.", "IT'LL BE COMPUTED."])).toBe(true);
    expect(copyMatches(["Search and AI Visibility", "Need Different Habits", "Winning teams build both."], ["Search and AI Visibility Need Different Habits", "Winning teams build both."])).toBe(true);
  });
  it("rejects a misspelled, missing or added word", () => {
    expect(copyMatches(["Results matter.", "Standards mater first."], ["Results matter.", "Standards matter first."])).toBe(false);
    expect(copyMatches(["Results matter."], ["Results matter.", "Standards matter first."])).toBe(false);
    expect(copyMatches(["Results matter.", "Standards matter first.", "Learn more"], ["Results matter.", "Standards matter first."])).toBe(false);
  });
  it("rejects a misread letter such as AI read as Al", () => {
    expect(copyMatches(["Search and Al Visibility"], ["Search and AI Visibility"])).toBe(false);
  });
});

describe("parseRead", () => {
  it("reads the lines out of the reply, and nothing out of a reply that is not JSON", () => {
    expect(parseRead('Here you go: {"lines":["One","Two"]}')).toEqual(["One", "Two"]);
    expect(parseRead("no text found")).toBeNull();
  });
  it("normalizes only what a reader would not notice", () => {
    expect(readable("  It’s  “fine” — really ")).toBe(`it's "fine" - really`);
  });
});
