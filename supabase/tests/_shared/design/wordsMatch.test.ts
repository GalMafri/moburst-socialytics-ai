import { describe, expect, it } from "vitest";
import { copyMatches, wordsMatch } from "../../../functions/_shared/design/pipeline";

// A design may carry labels beyond its headline (17 Nov 2026): the planned
// visual's list items, labels and numbers. The words read back are then
// compared word by word: the headline's words in order, and with the labels'
// words the same words, each as often. A reader writes a list as it sees it,
// with its markers and punctuation, and none of that is a word.
describe("wordsMatch", () => {
  const headline = ["Four signs.", "One shop."];
  const labels = ["Fair quotes", "Clean bays", "Same-day parts", "A written warranty"];

  it("is copyMatches, to the letter, for a design without labels", () => {
    const cases: Array<[string[], string[]]> = [
      [["THE NEXT LEAGUE WON’T BE MANAGED.", "IT’LL BE COMPUTED."], ["THE NEXT LEAGUE WON'T BE MANAGED.", "IT'LL BE COMPUTED."]],
      [["Search and AI Visibility", "Need Different Habits", "Winning teams build both."], ["Search and AI Visibility Need Different Habits", "Winning teams build both."]],
      [["Results matter.", "Standards mater first."], ["Results matter.", "Standards matter first."]],
      [["Results matter."], ["Results matter.", "Standards matter first."]],
      [["Results matter.", "Standards matter first.", "Learn more"], ["Results matter.", "Standards matter first."]],
      [["Your patch, your rules \u{1F499}", "How do you patch?"], ["Your patch, your rules \u{1FA75}", "How do you patch?"]],
      // Without labels punctuation and signs still count, as they always have.
      [["Wax Center"], ["Wax Center®"]],
      [["Plan: build"], ["Plan build"]],
      [["1. Plan"], ["Plan"]],
      [["Plan and build"], ["Plan & build"]],
      [[], ["Anything"]],
      [[], []],
    ];
    for (const [read, want] of cases) {
      for (const none of [undefined, null, [], ["", "  "], ["\u{1F499}"], ["→", "•"]]) {
        expect(wordsMatch(read, want, none as never), JSON.stringify([read, want, none])).toBe(copyMatches(read, want));
      }
    }
  });

  it("takes the headline and every label, however the reader breaks the lines", () => {
    expect(wordsMatch(["Four signs.", "One shop.", ...labels], headline, labels)).toBe(true);
    expect(wordsMatch(["FOUR SIGNS. ONE SHOP.", "Fair quotes", "Clean bays", "Same-day", "parts", "A written warranty"], headline, labels)).toBe(true);
  });

  it("takes the labels in any order, before, after or between the headline's lines", () => {
    expect(wordsMatch(["Four signs.", "One shop.", "A written warranty", "Same-day parts", "Clean bays", "Fair quotes"], headline, labels)).toBe(true);
    expect(wordsMatch(["Clean bays", "Fair quotes", "Four signs.", "One shop.", "Same-day parts", "A written warranty"], headline, labels)).toBe(true);
    // A Story's second line is its call to action, at the foot: the labels sit between the two lines.
    expect(wordsMatch(["Four signs.", "Fair quotes", "Clean bays", "Same-day parts", "A written warranty", "One shop."], headline, labels)).toBe(true);
  });

  describe("a correct list design, read the way a reader writes a list", () => {
    const head = ["Three steps"];
    const steps = ["Plan", "Build", "Ship"];
    it("passes with numbered list markers", () => {
      expect(wordsMatch(["Three steps", "1. Plan", "2. Build", "3. Ship"], head, steps)).toBe(true);
      expect(wordsMatch(["Three steps", "1) Plan", "2) Build", "3) Ship"], head, steps)).toBe(true);
      expect(wordsMatch(["Three steps", "a. Plan", "b. Build", "C) Ship"], head, steps)).toBe(true);
    });
    it("passes with bullets and check marks", () => {
      expect(wordsMatch(["Three steps", "• Plan", "• Build", "• Ship"], head, steps)).toBe(true);
      expect(wordsMatch(["Three steps", "✓ Plan", "✔️ Build", "✅ Ship"], head, steps)).toBe(true);
      expect(wordsMatch(["Three steps", "- Plan", "– Build", "* Ship"], head, steps)).toBe(true);
    });
    it("passes with arrows and colons between or after the labels", () => {
      expect(wordsMatch(["Three steps", "Plan → Build → Ship"], head, steps)).toBe(true);
      expect(wordsMatch(["Three steps", "Plan:", "Build:", "Ship."], head, steps)).toBe(true);
      expect(wordsMatch(["Three steps:", "Plan | Build | Ship"], head, steps)).toBe(true);
    });
    it("passes two labels of several lines read row by row", () => {
      // Two columns, each label on two rows: the reader goes across the rows.
      expect(wordsMatch(["Which one", "November January", "winner rerun"], ["Which one"], ["November winner", "January rerun"])).toBe(true);
    });
    it("passes & read as and, and and read as &", () => {
      expect(wordsMatch(["Three steps", "Plan and build", "Ship"], head, ["Plan & build", "Ship"])).toBe(true);
      expect(wordsMatch(["Three steps", "Plan & build", "Ship"], head, ["Plan and build", "Ship"])).toBe(true);
    });
    it("passes a percent sign set apart from its number, or left out", () => {
      expect(wordsMatch(["Three steps", "45 % faster", "Ship"], head, ["45% faster", "Ship"])).toBe(true);
      expect(wordsMatch(["Three steps", "45% faster", "Ship"], head, ["45 % faster", "Ship"])).toBe(true);
    });
    it("keeps a number or letter the labels themselves hold, at the head of a line too", () => {
      const numbered = ["1 Elbow", "2 Knee"];
      expect(wordsMatch(["Top picks", "1. Elbow", "2. Knee"], ["Top picks"], numbered)).toBe(true);
      expect(wordsMatch(["Top picks", "1 Elbow", "2 Knee"], ["Top picks"], numbered)).toBe(true);
      expect(wordsMatch(["Top picks", "1. Elbow", "3. Knee"], ["Top picks"], numbered)).toBe(false);
      expect(wordsMatch(["Top picks", "Elbow", "Knee"], ["Top picks"], numbered)).toBe(false);
    });
  });

  it("fails a missing label word, an added word, a misspelled word and a missing duplicate", () => {
    // A missing label word.
    expect(wordsMatch(["Four signs.", "One shop.", "Fair quotes", "Clean bays", "Same-day parts", "A warranty"], headline, labels)).toBe(false);
    expect(wordsMatch(["Four signs.", "One shop.", "Fair quotes", "Clean bays", "Same-day parts"], headline, labels)).toBe(false);
    // An added word.
    expect(wordsMatch(["Four signs.", "One shop.", ...labels, "Book now"], headline, labels)).toBe(false);
    expect(wordsMatch(["Four signs.", "One shop.", "Fair quotes", "Fair quotes", "Clean bays", "Same-day parts", "A written warranty"], headline, labels)).toBe(false);
    // A misspelled word.
    expect(wordsMatch(["Four signs.", "One shop.", "Fair quotes", "Clean bays", "Same-day parts", "A writen warranty"], headline, labels)).toBe(false);
    expect(wordsMatch(["Four signs.", "One stop.", ...labels], headline, labels)).toBe(false);
    // A missing duplicate: the word is on the design once where it belongs twice.
    expect(wordsMatch(["Which one", "Yes", "No"], ["Which one"], ["Yes", "Yes", "No"])).toBe(false);
    expect(wordsMatch(["Which one", "Yes", "Yes", "No"], ["Which one"], ["Yes", "Yes", "No"])).toBe(true);
    expect(wordsMatch(["Four signs.", "One shop.", "Fair quotes"], ["Four signs.", "One shop."], ["One shop.", "Fair quotes"])).toBe(false);
    expect(wordsMatch(["Four signs.", "One shop.", "One shop.", "Fair quotes"], ["Four signs.", "One shop."], ["One shop.", "Fair quotes"])).toBe(true);
  });

  it("fails a headline whose words are out of order, and a design with the labels and no headline", () => {
    expect(wordsMatch(["One shop.", "Four signs.", ...labels], headline, labels)).toBe(false);
    expect(wordsMatch(labels, headline, labels)).toBe(false);
    expect(wordsMatch(["Four signs.", "One shop."], headline, labels)).toBe(false);
  });

  it("reads past case, quote style, dashes, spacing and pictographs, and keeps an apostrophe inside a word", () => {
    expect(wordsMatch(["IT’S HERE", "“NOVEMBER WINNER”", "January   rerun \u{1F499}"], ["It's here"], ['"November winner"', "January rerun"])).toBe(true);
    expect(wordsMatch(["Its here", "November winner"], ["It's here"], ["November winner"])).toBe(false);
  });
});
