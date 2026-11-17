import { describe, expect, it } from "vitest";
import { REPLAN_NOTE, followedAt, planRules, replanWhy, type ReplanPlan, type ReplanPost } from "../../../functions/_shared/calendar/replan";
import { COPY_RULE } from "../../../functions/_shared/calendar/copyChecks";

// Copy sources, 17 Nov 2026: which upcoming posts the app writes again by
// itself. Every company below is invented.

const READY = "2026-11-10T07:20:00.000Z";
const plan = (over: Partial<ReplanPlan> = {}): ReplanPlan => ({ ready_at: READY, evidence: { rules: COPY_RULE }, revisions: [], ...over });
const old = (over: Partial<ReplanPlan> = {}): ReplanPlan => plan({ evidence: { }, ...over });
const post = (copy: string, kinds: string[] = ["own"]): ReplanPost => ({ copy, reasons: [{ type: "performance", evidence: kinds.map((kind, i) => ({ id: `X${i + 1}`, kind, text: "x" })) }] });

describe("planRules", () => {
  it("is the version a plan carries, and 0 for a plan that carries none", () => {
    expect(planRules(plan())).toBe(COPY_RULE);
    expect(planRules(plan({ evidence: { rules: 3 } }))).toBe(3);
    expect(planRules(plan({ evidence: {} }))).toBe(0);
    expect(planRules(plan({ evidence: null }))).toBe(0);
    expect(planRules(plan({ evidence: { rules: "soon" } }))).toBe(0);
    expect(planRules(plan({ evidence: { rules: -1 } }))).toBe(0);
  });
});

describe("followedAt", () => {
  it("is when the plan was made ready", () => {
    expect(followedAt(plan())).toBe(Date.parse(READY));
    expect(followedAt(plan({ ready_at: null }))).toBe(0);
  });

  it("is a later finished replan, and never a revision of another scope", () => {
    const replanned = "2026-11-12T09:00:00.000Z";
    expect(followedAt(plan({ revisions: [{ scope: "replan", done_at: replanned, rewritten: 3 }] }))).toBe(Date.parse(replanned));
    // A replan that had nothing left to rewrite still looked at the week.
    expect(followedAt(plan({ revisions: [{ scope: "replan", done_at: replanned, rewritten: 0 }] }))).toBe(Date.parse(replanned));
    expect(followedAt(plan({ revisions: [{ scope: "empty", done_at: replanned }, { scope: "untouched", done_at: replanned, by: "u1" }] }))).toBe(Date.parse(READY));
    // One that closed because the week was over rewrote nothing, and one with no date counts for nothing.
    expect(followedAt(plan({ revisions: [{ scope: "replan", done_at: replanned, expired: true }, { scope: "replan" }, null] }))).toBe(Date.parse(READY));
    expect(followedAt(plan({ revisions: "not a list" }))).toBe(Date.parse(READY));
  });
});

describe("replanWhy", () => {
  const none = { ownDroppedAt: null };

  it("accounts: an own account was parked after the plan last followed the client's accounts", () => {
    expect(replanWhy(post("Our aftercare guide."), plan(), { ownDroppedAt: "2026-11-11T08:00:00.000Z" })).toBe("accounts");
    // Whatever the post was written from, and under the current rules too.
    expect(replanWhy(post("Our aftercare guide.", ["report"]), plan(), { ownDroppedAt: "2026-11-11T08:00:00.000Z" })).toBe("accounts");
    // Parked before the plan was written: the plan already followed it.
    expect(replanWhy(post("Our aftercare guide."), plan(), { ownDroppedAt: "2026-11-09T08:00:00.000Z" })).toBeNull();
    // Re-planned since: followed.
    expect(replanWhy(post("Our aftercare guide."), plan({ revisions: [{ scope: "replan", done_at: "2026-11-11T09:00:00.000Z" }] }), { ownDroppedAt: "2026-11-11T08:00:00.000Z" })).toBeNull();
    expect(replanWhy(post("Our aftercare guide."), plan(), { ownDroppedAt: "not a date" })).toBeNull();
  });

  it("outside: a plan from before the copy rules whose post cites a trend, a competitor's post or a topic", () => {
    for (const kind of ["trend", "competitor", "topic"]) expect(replanWhy(post("Any copy.", ["own", kind]), old(), none)).toBe("outside");
    // The same post under the current rules was checked when it was written.
    expect(replanWhy(post("Any copy.", ["trend"]), plan(), none)).toBeNull();
  });

  it("chapters: a plan from before the copy rules whose copy carries a list of video chapters", () => {
    expect(replanWhy(post("0:00 Intro\n1:20 The close"), old(), none)).toBe("chapters");
    expect(replanWhy(post("Chapters: 0:00 Intro, 1:20 The close"), old(), none)).toBe("chapters");
    expect(replanWhy(post("0:00 Intro"), plan(), none)).toBeNull();
  });

  // The same definition as the copy check: clock times are ordinary copy, and no reason to write a post again.
  it("never re-plans a post for its clock times, time ranges or opening hours", () => {
    for (const copy of ["Happy hour 4:00-6:00, live music 8:30", "Doors 6:30, show 7:00, afterparty 10:00", "Open 9:00 to 17:30.", "18:00 Doors\n19:30 Show\n22:00 Afterparty", "9:00 AM Registration\n10:00 AM Keynote"]) {
      expect(replanWhy(post(copy), old(), none), copy).toBeNull();
    }
  });

  it("is null for a post written from the client's own material", () => {
    expect(replanWhy(post("Our aftercare guide.", ["own", "report", "moment"]), old(), none)).toBeNull();
    expect(replanWhy({ copy: null, reasons: null }, old(), none)).toBeNull();
    expect(replanWhy({ copy: "A post someone added", reasons: [{ type: "performance", label: "Added by the team" }] }, old(), none)).toBeNull();
  });

  it("says accounts first, then outside, then chapters", () => {
    expect(replanWhy(post("0:00 Intro", ["trend"]), old(), { ownDroppedAt: "2026-11-11T08:00:00.000Z" })).toBe("accounts");
    expect(replanWhy(post("0:00 Intro", ["trend"]), old(), none)).toBe("outside");
    expect(replanWhy(post("0:00 Intro", ["own"]), old(), none)).toBe("chapters");
  });
});

describe("the note a replan carries", () => {
  it("is in plain words: people see it on the week while it is rewritten", () => {
    expect(REPLAN_NOTE).toBe("Write these posts again from the client's own material.");
  });
});
