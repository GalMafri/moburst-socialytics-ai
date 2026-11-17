import { describe, expect, it } from "vitest";
import {
  AUTHOR_MIN_CHARS, CHAPTER_START_MAX_SECONDS, COPY_RULE, LINK_TLDS, SHARED_RUN_WORDS, SHARED_TRIGRAMS,
  borrowedFrom, chapterList, checkCopy, citesOutside, copyWords, foreignHandles, foreignLinks, outsideFromReasons, refersToProblem, sharedWording,
  type CopyCheck, type OwnFacts,
} from "../../../functions/_shared/calendar/copyChecks";
import type { EvidenceItem, OutsideSource } from "../../../functions/_shared/calendar/evidence";

// Copy sources, 17 Nov 2026: an outside post gives the planner a subject and
// nothing more, and these checks are the backstop. Every company, person and
// caption here is invented.

/** The pattern that was seen live, rebuilt: an outside explainer video with chapters, by someone who is not the client. */
const EXPLAINER: OutsideSource = {
  id: "N5", kind: "trend", author: "@ledgerlane",
  text: "New video: how a small firm closed its books in three days instead of three weeks. 0:00 Why month-end drags 1:45 The checklist we use 4:10 What to automate first. Hosted by Priya Nand. Watch the full breakdown at ledgerlane.example #accounting #monthend",
};
const RIVAL: OutsideSource = { id: "C2", kind: "competitor", author: "Brightside Wax", text: "Our summer membership is back. Unlimited waxing for one flat price every single month. Book before July ends." };
const OWN: OwnFacts = {
  hosts: ["harborwax.example"], handles: ["harborwax", "harbor.wax"],
  text: "harbor wax\nfirst wax free for new guests. book at harborwax.example or bit.ly/hw-book\nwe love our friends at @lakesidecoffee\ntap the link in our bio to book your first visit today",
  hasNotes: true,
};
const NOTHING: OwnFacts = { hosts: [], handles: [], text: "", hasNotes: false };
const check = (over: Partial<CopyCheck> = {}): CopyCheck => ({ outside: [EXPLAINER, RIVAL], own: OWN, ...over });
const EVIDENCE: EvidenceItem[] = [
  { id: "P1", kind: "own", text: "Our aftercare guide" }, { id: "R1", kind: "report", text: "Reels drove most saves" },
  { id: "C2", kind: "competitor", text: "Our summer membership is back." }, { id: "N5", kind: "trend", text: "New video: how a small firm closed its books" }, { id: "M1", kind: "moment", text: "Small Business Saturday" },
];

describe("the rule constants", () => {
  it("are the ones the plan was approved with", () => {
    expect([COPY_RULE, SHARED_RUN_WORDS, SHARED_TRIGRAMS, AUTHOR_MIN_CHARS, CHAPTER_START_MAX_SECONDS]).toEqual([1, 6, 5, 5, 59]);
    expect(LINK_TLDS).toEqual(expect.arrayContaining(["com", "io", "co", "link", "bio", "shop"]));
  });
});

describe("copyWords", () => {
  it("lowercases, drops links, handles and hashtags, removes apostrophes and reads everything else as a space", () => {
    expect(copyWords("Don't miss it: Month-End, DONE!")).toEqual(["dont", "miss", "it", "month", "end", "done"]);
    expect(copyWords("Book at https://harborwax.example/book or www.harborwax.example today")).toEqual(["book", "at", "or", "today"]);
    expect(copyWords("Thanks @lakeside.coffee! #smallbusiness #shoplocal See you soon")).toEqual(["thanks", "see", "you", "soon"]);
    expect(copyWords("It’s here")).toEqual(["its", "here"]);
    expect(copyWords("")).toEqual([]);
  });
});

describe("sharedWording", () => {
  it("measures the longest run of consecutive words both hold, and the distinct trigrams both hold", () => {
    expect(sharedWording("We closed the books in three days, not weeks.", "How a small firm closed its books in three days instead of three weeks.")).toEqual({ run: 4, trigrams: 2 });
    expect(sharedWording("Nothing in common here at all", "A completely different sentence")).toEqual({ run: 0, trigrams: 0 });
    expect(sharedWording("", "anything")).toEqual({ run: 0, trigrams: 0 });
  });

  it("does not count hashtags, handles or links as shared words", () => {
    const a = "#accounting #monthend #smallbiz #bookkeeping #cpa #finance @ledgerlane https://ledgerlane.example/watch";
    expect(sharedWording(a, a)).toEqual({ run: 0, trigrams: 0 });
  });
});

describe("borrowedFrom", () => {
  it("refuses a post that retells the outside explainer with a run of six of its words", () => {
    const copy = "Month-end does not have to drag. Here is how a small firm closed its books in three days, step by step.";
    expect(sharedWording(copy, EXPLAINER.text).run).toBeGreaterThanOrEqual(SHARED_RUN_WORDS);
    expect(borrowedFrom(copy, [EXPLAINER])).toEqual({ id: "N5", why: "shares wording with N5" });
  });

  it("passes the same subject written in new words", () => {
    const copy = "Closing the month should not take most of the next one. Three habits keep our clients' numbers ready by day three.";
    expect(sharedWording(copy, EXPLAINER.text).run).toBeLessThan(SHARED_RUN_WORDS);
    expect(borrowedFrom(copy, [EXPLAINER, RIVAL])).toBeNull();
  });

  it("refuses five shared trigrams even with no run of six", () => {
    const source: OutsideSource = { id: "N2", kind: "trend", author: "", text: "The checklist we use every month. What to automate first is payroll. Why month-end drags on for weeks." };
    const copy = "Ask yourself what to automate first. Then share the checklist we use with the team. That is why month-end drags less.";
    const shared = sharedWording(copy, source.text);
    expect(shared.run).toBeLessThan(SHARED_RUN_WORDS);
    expect(shared.trigrams).toBeGreaterThanOrEqual(SHARED_TRIGRAMS);
    expect(borrowedFrom(copy, [source])).toEqual({ id: "N2", why: "shares wording with N2" });
    // One trigram fewer passes.
    const lighter = "Ask yourself what to automate first. Then share the checklist we use with the team.";
    expect(sharedWording(lighter, source.text).trigrams).toBe(SHARED_TRIGRAMS - 1);
    expect(borrowedFrom(lighter, [source])).toBeNull();
  });

  it("names the first outside post it borrows from, cited or not", () => {
    const copy = "Unlimited waxing for one flat price every single month, starting now.";
    expect(borrowedFrom(copy, [EXPLAINER, RIVAL])).toEqual({ id: "C2", why: "shares wording with C2" });
  });

  it("refuses a post that names who posted the outside post, as whole words", () => {
    expect(borrowedFrom("Brightside Wax has a membership. Ours is better.", [RIVAL])).toEqual({ id: "C2", why: "names who posted C2" });
    expect(borrowedFrom("We watched Ledgerlane's month-end video twice.", [EXPLAINER])).toEqual({ id: "N5", why: "names who posted N5" });
    // A possessive is the name.
    expect(borrowedFrom("Have you seen Brightside Wax’s summer deal?", [RIVAL])).toEqual({ id: "C2", why: "names who posted C2" });
    // Part of another word is not the name.
    expect(borrowedFrom("Look on the brightside waxing is quick.", [RIVAL])).toBeNull();
  });

  it("does not search for an author name shorter than five characters", () => {
    const short: OutsideSource = { id: "N1", kind: "trend", author: "@olio", text: "x" };
    expect("olio".length).toBeLessThan(AUTHOR_MIN_CHARS);
    expect(borrowedFrom("We cook with olio every day.", [short])).toBeNull();
    expect(borrowedFrom("We cook with olive oil every day.", [{ ...short, author: "@olive" }])).toEqual({ id: "N1", why: "names who posted N1" });
    expect(borrowedFrom("Anything at all.", [{ ...short, author: "" }])).toBeNull();
  });

  it("does not count wording the client's own posts already carry, or a name they carry", () => {
    // The client's usual call to action, which a competitor happens to write too.
    const rival: OutsideSource = { id: "C1", kind: "competitor", author: "Harbor Wax", text: "Smooth skin all summer. Tap the link in our bio to book your first visit today!" };
    const copy = "New to waxing? Tap the link in our bio to book your first visit today.";
    expect(borrowedFrom(copy, [rival])).toEqual({ id: "C1", why: "shares wording with C1" });
    expect(borrowedFrom(copy, [rival], OWN)).toBeNull();
    // The client's own name is not an outside author's, even when a feed lists a company named alike.
    expect(borrowedFrom("Harbor Wax opens at nine.", [rival])).toEqual({ id: "C1", why: "names who posted C1" });
    expect(borrowedFrom("Harbor Wax opens at nine.", [rival], OWN)).toBeNull();
    expect(borrowedFrom("Say hi to harborwax.", [{ ...rival, author: "@harborwax" }], OWN)).toBeNull();
    // Wording that is only the outside post's is still refused with the client's facts given.
    expect(borrowedFrom("Unlimited waxing for one flat price every single month, starting now.", [RIVAL], OWN)).toEqual({ id: "C2", why: "shares wording with C2" });
  });
});

// Time codes mean chapters, not clock times: a planned video has no chapters yet, but a post may say when the doors open.
describe("chapterList", () => {
  const CHAPTERS = { why: "lists video chapter times", ids: [], kind: "chapters" };
  const none = check({ outside: [] });

  it("is a line that starts with the zero time and a label", () => {
    for (const text of ["0:00 Intro", "00:00 Intro", "0:00:00 Intro", "Our walkthrough.\n0:00 - Why month-end drags", "- 0:00 Intro", "(0:00) Intro", "• 00:00 | Welcome"]) {
      expect(chapterList(text), text).toBe(true);
      expect(checkCopy({ copy: text, evidence: [], check: none })).toEqual(CHAPTERS);
    }
  });

  it("is two or more lines that each start with a time and a label, in ascending order, the first within a minute of zero", () => {
    expect(chapterList("0:15 The hook\n1:30 The tip\n3:05 Recap")).toBe(true);
    expect(chapterList("New video!\n\n0:45 - Setup\nSome words in between\n2:10 - The close")).toBe(true);
    expect(chapterList("0:59 Start\n1:00:00 The long part")).toBe(true);
    // Not ascending, only one line, or starting after the first minute: not chapters.
    expect(chapterList("1:30 The tip\n0:15 The hook")).toBe(false);
    expect(chapterList("0:30 The tip\n0:15 The hook")).toBe(false);
    expect(chapterList("0:15 The hook")).toBe(false);
    expect(CHAPTER_START_MAX_SECONDS).toBe(59);
    expect(chapterList("1:00 The first part\n2:30 The second part")).toBe(false);
  });

  it("is, on one line, the zero time with a label and a later time with a label", () => {
    expect(chapterList("Chapters: 0:00 Intro, 1:20 The close")).toBe(true);
    expect(chapterList(EXPLAINER.text)).toBe(true);
    expect(chapterList("New video. 0:00 Why it drags 1:45 The checklist we use 4:10 What to automate")).toBe(true);
    // One zero time in a sentence, with nothing after it, is not a list.
    expect(chapterList("Chapters: 0:00 Intro")).toBe(false);
  });

  it("never takes clock times, time ranges, opening hours or an event's schedule for chapters", () => {
    const ordinary = [
      "Happy hour 4:00-6:00, live music 8:30",
      "Doors 6:30, show 7:00, afterparty 10:00.",
      "Open 9:00 to 17:30 on Saturday.",
      "9:00 AM Registration\n10:00 AM Keynote\n12:30 PM Lunch",
      "18:00 Doors\n19:30 Show\n22:00 Afterparty",
      "6:00 Doors\n7:00 Show",
      "Mon 9:00-17:00\nTue 9:00-17:00\nSat 10:00-14:00",
      "9:00 to 17:00 weekdays\n10:00 to 14:00 Saturday",
      "Open 0:00 to 24:00 every day",
      "Open 0:00-24:00",
      "From 22:00 to 00:00 we dance, then the 1:00 afterparty",
      "The sale starts at 0:00 sharp and ends 23:59 Friday",
      "Midnight (00:00) countdown, doors 22:30 sharp",
      "Call 555-0100 at 10:00 or 14:30 or 16:00",
      "Shot in 16:9, cut to 4:5. We won 3:1.",
      "See you at 10:00",
      "",
    ];
    for (const text of ordinary) {
      expect(chapterList(text), text).toBe(false);
      expect(checkCopy({ copy: text, evidence: [], check: none })).toBeNull();
    }
  });

  it("counts the call to action too", () => {
    expect(checkCopy({ copy: "Our walkthrough is live.", cta: "0:00 Intro, 2:10 The close", evidence: [], check: none })).toEqual(CHAPTERS);
    expect(checkCopy({ copy: "Our walkthrough is live.", cta: "Join us at 6:30", evidence: [], check: none })).toBeNull();
  });
});

describe("foreignLinks", () => {
  it("passes a link to the client's site, a subdomain of it, and a host its own posts show", () => {
    expect(foreignLinks("Book at https://www.harborwax.example/book or shop.harborwax.example", OWN)).toEqual([]);
    expect(foreignLinks("Book at harborwax.example.", OWN)).toEqual([]);
    expect(foreignLinks("Quick link: bit.ly/hw-book", OWN)).toEqual([]);
  });

  it("refuses another host: with a scheme, with www, or a bare domain with a known ending", () => {
    expect(foreignLinks("Watch at https://ledgerlane.example/watch?x=1.", OWN)).toEqual(["ledgerlane.example"]);
    expect(foreignLinks("Read www.Brightside-Wax.com/blog today", OWN)).toEqual(["brightside-wax.com"]);
    expect(foreignLinks("More at brightsidewax.co and brightside.shop!", OWN)).toEqual(["brightsidewax.co", "brightside.shop"]);
    expect(checkCopy({ copy: "Watch the full breakdown on tutorials.io", evidence: [], check: check({ outside: [] }) })).toEqual({ why: "links to tutorials.io, which is not the client's", ids: [], kind: "link" });
    // A host that only ends like the client's is not the client's.
    expect(foreignLinks("notharborwax.example.com", OWN)).toEqual(["notharborwax.example.com"]);
  });

  it("does not read an ordinary sentence, a number or an email address as a link", () => {
    expect(foreignLinks("We love our team. Company news soon. Version 2.5 is out. See you at 9.30.", OWN)).toEqual([]);
    expect(foreignLinks("Write to hello@gmail.com", OWN)).toEqual([]);
    expect(foreignLinks("Awww.so cute", OWN)).toEqual([]);
  });
});

describe("foreignHandles", () => {
  it("passes the client's own handle and one its own posts show", () => {
    expect(foreignHandles("Follow @HarborWax and @harbor.wax.", OWN)).toEqual([]);
    expect(foreignHandles("Coffee by @LakesideCoffee", OWN)).toEqual([]);
  });

  it("refuses an outside handle", () => {
    expect(foreignHandles("As seen on @ledgerlane and @brightside_wax", OWN)).toEqual(["ledgerlane", "brightside_wax"]);
    expect(checkCopy({ copy: "Great tips from @ledgerlane this week", evidence: [], check: check({ outside: [] }) })).toEqual({ why: "names @ledgerlane, which is not the client's", ids: [], kind: "handle" });
  });

  it("does not read an email address or a two-letter tag as a handle", () => {
    expect(foreignHandles("Write to hello@ledgerlane.example or meet us @ 9", OWN)).toEqual([]);
    expect(foreignHandles("@hq", OWN)).toEqual([]);
  });
});

describe("refersToProblem", () => {
  const WRONG = "points to something the client's evidence does not show";
  it("is fine with nothing to point to", () => {
    expect(refersToProblem(null, EVIDENCE, OWN)).toBeNull();
    expect(refersToProblem(undefined, EVIDENCE, OWN)).toBeNull();
    expect(refersToProblem({}, EVIDENCE, OWN)).toBeNull();
    expect(refersToProblem("video", EVIDENCE, OWN)).toBeNull();
  });

  it("passes a pointer that cites the client's own post or report", () => {
    expect(refersToProblem({ what: "guide", evidence_id: "P1" }, EVIDENCE, OWN)).toBeNull();
    expect(refersToProblem({ what: "page", evidence_id: "R1" }, EVIDENCE, OWN)).toBeNull();
  });

  it("refuses a pointer that cites an outside post, a moment, an unknown id or nothing", () => {
    expect(refersToProblem({ what: "video", evidence_id: "N5" }, EVIDENCE, OWN)).toBe(WRONG);
    expect(refersToProblem({ what: "video", evidence_id: "C2" }, EVIDENCE, OWN)).toBe(WRONG);
    expect(refersToProblem({ what: "event", evidence_id: "M1" }, EVIDENCE, OWN)).toBe(WRONG);
    expect(refersToProblem({ what: "video", evidence_id: "P9" }, EVIDENCE, OWN)).toBe(WRONG);
    expect(refersToProblem({ what: "video" }, EVIDENCE, OWN)).toBe(WRONG);
  });

  // Whatever of the client's own material the planner was given can be what a post points to.
  it("passes the pillars, the strategy or the voice section only when the planner was given them", () => {
    const given = { ...OWN, material: ["pillars", "voice"] };
    expect(refersToProblem({ what: "webinar", evidence_id: "pillars" }, EVIDENCE, given)).toBeNull();
    expect(refersToProblem({ what: "guide", evidence_id: "Voice" }, EVIDENCE, given)).toBeNull();
    expect(refersToProblem({ what: "page", evidence_id: "strategy" }, EVIDENCE, given)).toBe(WRONG);
    expect(refersToProblem({ what: "page", evidence_id: "strategy" }, EVIDENCE, { ...OWN, material: ["strategy"] })).toBeNull();
    expect(refersToProblem({ what: "page", evidence_id: "pillars" }, EVIDENCE, OWN)).toBe(WRONG);
    // An outside post is never the client's material, whatever was given.
    expect(refersToProblem({ what: "video", evidence_id: "N5" }, EVIDENCE, { ...OWN, material: ["pillars", "strategy", "voice"] })).toBe(WRONG);
  });

  it("passes \"notes\" only for a client that has notes in use", () => {
    expect(refersToProblem({ what: "offer", evidence_id: "notes" }, EVIDENCE, OWN)).toBeNull();
    expect(refersToProblem({ what: "offer", evidence_id: "notes" }, EVIDENCE, { ...OWN, hasNotes: false })).toBe(WRONG);
  });
});

describe("checkCopy", () => {
  it("passes a post written from the client's own material", () => {
    expect(checkCopy({
      copy: "First wax free for new guests this month. Aftercare tips are in our guide.", cta: "Book at harborwax.example",
      refersTo: { what: "guide", evidence_id: "P1" }, evidence: EVIDENCE, check: check(),
    })).toBeNull();
  });

  it("refuses the outside explainer retold, with the outside id it borrowed from", () => {
    const retold = "How a small firm closed its books in three days instead of three weeks.\n0:00 Why month-end drags\n1:45 The checklist we use\nHosted by Priya Nand.";
    expect(checkCopy({ copy: retold, evidence: EVIDENCE, check: check() })).toEqual({ why: "shares wording with N5", ids: ["N5"], kind: "borrowed" });
  });

  it("checks in order: borrowed wording, a chapter list, links, handles, then what the post points to", () => {
    const base = { evidence: EVIDENCE, check: check({ outside: [RIVAL] }) };
    const all = "Unlimited waxing for one flat price every single month.\n0:00 Intro\nSee brightside.shop and @brightside_wax";
    expect(checkCopy({ ...base, copy: all, refersTo: { what: "video", evidence_id: "N5" } })?.why).toBe("shares wording with C2");
    expect(checkCopy({ ...base, copy: "0:00 Intro\nSee brightside.shop and @brightside_wax", refersTo: { what: "video", evidence_id: "N5" } })?.why).toBe("lists video chapter times");
    expect(checkCopy({ ...base, copy: "See brightside.shop and @brightside_wax", refersTo: { what: "video", evidence_id: "N5" } })?.why).toBe("links to brightside.shop, which is not the client's");
    expect(checkCopy({ ...base, copy: "Say hi to @brightside_wax", refersTo: { what: "video", evidence_id: "N5" } })?.why).toBe("names @brightside_wax, which is not the client's");
    expect(checkCopy({ ...base, copy: "Watch our new video.", refersTo: { what: "video", evidence_id: "N5" } })).toEqual({ why: "points to something the client's evidence does not show", ids: [], kind: "pointer" });
    expect(checkCopy({ ...base, copy: "Watch our new video.", refersTo: null })).toBeNull();
  });

  it("checks against every outside post of the week, with nothing known of the client", () => {
    expect(checkCopy({ copy: "Brightside Wax again.", evidence: [], check: { outside: [EXPLAINER, RIVAL], own: NOTHING } })).toEqual({ why: "names who posted C2", ids: ["C2"], kind: "borrowed" });
  });
});

describe("stored reasons", () => {
  const trendRef = { id: "N5", kind: "trend", text: "New video: how a small firm closed its books…", company: "@ledgerlane", theme: "Month-end in days" };
  const rivalRef = { id: "C2", kind: "competitor", text: "Our summer membership is back.", company: "Brightside Wax" };
  const topicRef = { id: "T1", kind: "topic", text: "Summer memberships: three studios posted offers", companies: 3 };
  const ownRef = { id: "P1", kind: "own", text: "Our aftercare guide" };

  it("gives the outside posts a reason cites: its trend and competitor refs, with the stored excerpt and company", () => {
    expect(outsideFromReasons([{ type: "trend", evidence: [trendRef, ownRef, rivalRef, topicRef] }])).toEqual([
      { id: "N5", kind: "trend", author: "@ledgerlane", text: "New video: how a small firm closed its books…" },
      { id: "C2", kind: "competitor", author: "Brightside Wax", text: "Our summer membership is back." },
    ]);
    expect(outsideFromReasons([{ type: "performance", evidence: [ownRef] }])).toEqual([]);
    expect(outsideFromReasons([{ type: "trend", label: "An older reason with no parts" }])).toEqual([]);
    expect(outsideFromReasons(null)).toEqual([]);
    expect(outsideFromReasons("x")).toEqual([]);
    // Only the first reason is a post's reason.
    expect(outsideFromReasons([{ type: "performance", evidence: [ownRef] }, { type: "trend", evidence: [trendRef] }])).toEqual([]);
  });

  it("says whether a reason cites an outside post: a trend, a competitor post or a competitor topic", () => {
    expect(citesOutside([{ evidence: [ownRef, trendRef] }])).toBe(true);
    expect(citesOutside([{ evidence: [rivalRef] }])).toBe(true);
    expect(citesOutside([{ evidence: [topicRef] }])).toBe(true);
    expect(citesOutside([{ evidence: [ownRef, { id: "R1", kind: "report", text: "x" }, { id: "M1", kind: "moment", text: "y" }] }])).toBe(false);
    expect(citesOutside([{ type: "story", label: "One Story with each Instagram post." }])).toBe(false);
    expect(citesOutside([])).toBe(false);
    expect(citesOutside(undefined)).toBe(false);
  });
});
