// P27-04 (a)(b): the copy checks refused a planned post's own, ordinary copy (QA 22 Nov 2026).
// (c) "00:00 Happy New Year" at a line start is left as it is: copyChecks.test.ts holds "00:00 Intro"
// alone as a chapter list on purpose, and the two lines cannot be told apart by their shape.
import { describe, expect, it } from "vitest";
import { checkCopy, type OwnFacts } from "../../../functions/_shared/calendar/copyChecks";

// A client with no own posts or notes yet (new, or strategy-only): nothing to exempt.
const own: OwnFacts = { hosts: ["acme.com"], handles: ["acme"], text: "", hasNotes: false };

describe("P27 copy checks refuse ordinary copy", () => {
  it("P27-04a: a stock 6-word CTA shared with a competitor's caption is not borrowed wording", () => {
    const outside = [{ id: "C1", kind: "competitor" as const, author: "Northwind", text: "Our new spring range just landed! Which one is your favorite? Let us know in the comments." }];
    const r = checkCopy({ copy: "Three ways to plan a calmer week with Acme. Which will you try first? Let us know in the comments.", evidence: [], check: { outside, own } });
    expect(r).toBeNull(); // actual: { why: "shares wording with C1", kind: "borrowed" }
  });

  it("P27-04b: a competitor whose name is a common word does not refuse every post using that word", () => {
    const outside = [{ id: "C1", kind: "competitor" as const, author: "Target", text: "Holiday deals start now." }];
    const r = checkCopy({ copy: "Know your target audience before you write a single ad.", evidence: [], check: { outside, own } });
    expect(r).toBeNull(); // actual: { why: "names who posted C1", kind: "borrowed" }
  });

  it("still refuses a post that names a capitalized competitor, or copies its own wording around a stock call to action", () => {
    const outside = [{ id: "C1", kind: "competitor" as const, author: "Target", text: "Holiday deals start now on every winter coat we sell. Let us know in the comments." }];
    expect(checkCopy({ copy: "Target has deals, ours are better.", evidence: [], check: { outside, own } })).toMatchObject({ why: "names who posted C1" });
    expect(checkCopy({ copy: "Holiday deals start now on every winter coat. Let us know in the comments.", evidence: [], check: { outside, own } })).toMatchObject({ why: "shares wording with C1" });
  });
});
